# Case Study: Issue #1263 - Solution Summary Attachment Options

## Issue Summary

**Issue URL**: https://github.com/link-assistant/hive-mind/issues/1263

**Title**: Support for `--attach-solution-summary` and `--auto-attach-solution-summary`

**Labels**: enhancement, documentation

## Problem Statement

When AI solvers (`claude`, `agent`, `codex`, `opencode`) complete their work, they produce a JSON output containing a `result` field with a summary of the work done. Currently, this summary is only visible in the logs but is not automatically posted as a comment to the GitHub issue or pull request.

### Current Behavior

The issue shows an example of the JSON output:

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 142812,
  "duration_api_ms": 162175,
  "num_turns": 29,
  "result": "## Summary\n\nI have completed a thorough verification...",
  ...
}
```

The `result` field contains markdown-formatted summary text that would be valuable for users to see directly on the PR/issue.

### Evidence from PR #1247

Looking at the comments on PR #1247:

- https://github.com/link-assistant/hive-mind/pull/1247#issuecomment-3892084893 - Work session started
- https://github.com/link-assistant/hive-mind/pull/1247#issuecomment-3892100883 - Logs attached but no summary

The screenshot in the issue shows that sometimes users get no visible feedback about what the AI actually accomplished.

## Proposed Solution

Add two new CLI options:

### 1. `--attach-solution-summary`

- Explicit option to always attach the solution summary as a PR/issue comment
- Extracts the `result` field from the AI tool's JSON output
- Converts it to markdown and posts it under a "## Solution summary" header
- Disabled by default to not break existing flows

### 2. `--auto-attach-solution-summary`

- Automatic mode that only posts a summary if the AI didn't create any comments itself
- Detects whether comments were created during the session by the AI
- If no comments were created, posts the solution summary automatically
- Disabled by default to not break existing flows

## Technical Analysis

### Current Code Flow

1. **AI Tool Execution** (`claude.lib.mjs`, `agent.lib.mjs`, `codex.lib.mjs`, `opencode.lib.mjs`)
   - Executes the AI tool with `--print` and `--output-format json` (or equivalent)
   - Parses JSON output to extract `type: "result"` entries
   - Captures `result` field content (the summary text)
   - Returns this in the `toolResult` object

2. **Results Processing** (`solve.results.lib.mjs`)
   - `verifyResults()` function checks for created PRs and comments
   - `attachLogToGitHub()` uploads logs to GitHub as gist/comment
   - Already has infrastructure for posting to PRs/issues

3. **Option Definitions** (`solve.config.lib.mjs`)
   - `SOLVE_OPTION_DEFINITIONS` contains all CLI options
   - `createYargsConfig()` registers options with yargs

### Key Code Locations

| File                        | Purpose                                     |
| --------------------------- | ------------------------------------------- |
| `src/solve.config.lib.mjs`  | Add new option definitions                  |
| `src/solve.mjs`             | Main orchestration, pass options to modules |
| `src/claude.lib.mjs`        | Extract result summary from Claude output   |
| `src/agent.lib.mjs`         | Extract result summary from agent output    |
| `src/codex.lib.mjs`         | Extract result summary from Codex output    |
| `src/opencode.lib.mjs`      | Extract result summary from OpenCode output |
| `src/solve.results.lib.mjs` | Post summary comment to GitHub              |
| `src/github.lib.mjs`        | GitHub API utilities (comment posting)      |

### Result Field Extraction

The `result` field is already being parsed in `claude.lib.mjs`:

```javascript
if (data.type === 'result') {
  if (data.subtype === 'success' && data.total_cost_usd !== undefined) {
    anthropicTotalCostUSD = data.total_cost_usd;
  }
  // ... error handling
}
```

We need to also extract and return `data.result` when `data.type === 'result'` and `data.subtype === 'success'`.

### Comment Detection for Auto Mode

For `--auto-attach-solution-summary`, we need to detect if the AI created any comments. This can be done by:

1. **Pre-session**: Record the latest comment timestamp/ID on the issue/PR
2. **Post-session**: Check if new comments exist from the current user
3. **Decision**: Only post summary if no new comments were created

The `verifyResults()` function in `solve.results.lib.mjs` already queries comments:

```javascript
const allCommentsResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments --paginate`;
const newCommentsByUser = allComments.filter(comment => comment.user.login === currentUser && new Date(comment.created_at) > referenceTime);
```

## Related Industry Solutions

### GitHub Actions PR Summarizers

- [PR Summarizing using AI](https://github.com/marketplace/actions/pr-summarizing-using-ai)
- [CodeRabbit AI PR Reviewer](https://github.com/coderabbitai/ai-pr-reviewer)

These actions automatically post AI-generated summaries as PR comments.

### OpenAI Codex CLI

- [Codex CLI features](https://developers.openai.com/codex/cli/features/)
- Supports `--attempts` for best-of-N runs
- `exec` subcommand pipes results back to stdout

### Claude Code CLI

- [CLI reference](https://code.claude.com/docs/en/cli-reference)
- `--output-format json` for structured output
- `--print` mode for automation

## Implementation Approach

### Phase 1: Add CLI Options (solve.config.lib.mjs)

```javascript
'attach-solution-summary': {
  type: 'boolean',
  description: 'Attach the AI solution summary as a comment to the PR/issue after completion',
  default: false,
},
'auto-attach-solution-summary': {
  type: 'boolean',
  description: 'Automatically attach solution summary only if AI did not create any comments during the session',
  default: false,
},
```

### Phase 2: Extract Result Summary (tool libs)

Modify each tool's execution function to return `resultSummary`:

```javascript
return {
  success,
  sessionId,
  // ... existing fields
  resultSummary: extractedResultText, // NEW
};
```

### Phase 3: Post Summary (solve.results.lib.mjs)

Add new function `attachSolutionSummary()`:

```javascript
export async function attachSolutionSummary({ resultSummary, prNumber, issueNumber, owner, repo, $, log }) {
  const targetNumber = prNumber || issueNumber;
  const targetType = prNumber ? 'pr' : 'issue';

  const comment = `## Solution summary\n\n${resultSummary}`;

  await $`gh ${targetType} comment ${targetNumber} --repo ${owner}/${repo} --body ${comment}`;
}
```

### Phase 4: Orchestrate in solve.mjs

After tool execution and before `verifyResults()`:

```javascript
// Handle solution summary attachment
if (argv.attachSolutionSummary && toolResult.resultSummary) {
  await attachSolutionSummary({...});
} else if (argv.autoAttachSolutionSummary && toolResult.resultSummary) {
  // Check if AI created comments during session
  const aiCreatedComments = await checkForAiComments(referenceTime, owner, repo, prNumber || issueNumber);
  if (!aiCreatedComments) {
    await attachSolutionSummary({...});
  }
}
```

## Testing Plan

1. **Unit Tests**: Test result summary extraction from mock JSON output
2. **Integration Tests**: Test comment posting with mocked GitHub API
3. **Manual Tests**:
   - Run with `--attach-solution-summary` and verify comment posted
   - Run with `--auto-attach-solution-summary` when AI posts comment (should not duplicate)
   - Run with `--auto-attach-solution-summary` when AI doesn't post (should post summary)

## Backward Compatibility

- Both options default to `false` - existing behavior unchanged
- No breaking changes to existing API
- Optional feature that can be enabled per-run or in config

## Future Enhancements

1. **Customizable summary header**: Allow users to customize "## Solution summary"
2. **Summary truncation**: Handle very long summaries gracefully
3. **Summary formatting**: Apply consistent markdown formatting
4. **Collapse large summaries**: Use `<details>` tag for long summaries

## References

- Issue #1263: https://github.com/link-assistant/hive-mind/issues/1263
- PR #1247 (example): https://github.com/link-assistant/hive-mind/pull/1247
- Claude Code CLI: https://code.claude.com/docs/en/cli-reference
- Codex CLI: https://developers.openai.com/codex/cli/
- GitHub PR Summarizers: https://github.com/marketplace/actions/pr-summarizing-using-ai
