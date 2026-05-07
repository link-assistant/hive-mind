# Case Study: Issue #1162 - `--tool agent` does not update Pull Request description and title

## Summary

When using `--tool agent` mode with external AI models (like Grok Code), the pull request title and description remain in their initial WIP (Work In Progress) placeholder state even after the solution is successfully implemented.

## Timeline of Events

Based on the solution draft log from PR bpmbpm/rdf-grapher#132:

| Timestamp (UTC) | Event                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------ |
| 14:58:48        | solve.mjs v1.9.0 started with `--tool agent` flag                                          |
| 14:58:55        | Fork mode enabled for konard/bpmbpm-rdf-grapher                                            |
| 14:59:02        | Repository cloned and upstream set                                                         |
| 14:59:04        | Branch `issue-131-85b8eb98862d` created                                                    |
| 14:59:04        | CLAUDE.md file created and committed                                                       |
| 14:59:05        | Branch pushed to remote                                                                    |
| 14:59:09        | **Draft PR #132 created with title `[WIP] TestAg1a`**                                      |
| 14:59:09        | **PR body set to WIP placeholder template**                                                |
| 14:59:19        | Agent (Grok Code) execution started                                                        |
| 14:59:26        | Agent read issue #131 details                                                              |
| 14:59:40        | Agent made code change (button label update)                                               |
| 15:00:00        | Agent committed and pushed changes                                                         |
| 15:00:22        | **Agent finished - did NOT update PR title/description**                                   |
| 15:00:22        | solve.mjs cleanup: reverted CLAUDE.md commit                                               |
| 15:00:24        | **solve.mjs finalization: converted draft to ready, but did NOT update title/description** |
| 15:00:26        | PR #132 marked ready for review (still with [WIP] title)                                   |

## Root Cause Analysis

### Primary Root Cause: Agent Did Not Follow Instructions

The agent (Grok Code Fast 1) received clear instructions in the system prompt:

```
- When you update existing pr ${prNumber}, use gh pr edit to modify title and description.
- When you finalize the pull request:
   follow style from merged prs for code, title, and description,
   ...
```

However, the agent only:

1. Made the code change
2. Committed and pushed
3. Reported success

The agent **did not execute `gh pr edit`** to update the PR title or description.

### Secondary Root Cause: No Fallback in solve.mjs

The `verifyResults` function in `solve.results.lib.mjs` performs post-processing after the agent completes:

1. ✅ Checks if PR body has issue linking keywords → adds "Fixes #X" if missing
2. ✅ Converts draft PR to ready for review
3. ❌ Does NOT remove `[WIP]` prefix from title
4. ❌ Does NOT update PR description from placeholder

The solve.mjs tool assumes the agent will update the PR title/description, but provides no fallback mechanism.

## Evidence

### Initial PR State (created by solve.mjs)

```
Title: [WIP] TestAg1a
Body:
## 🤖 AI-Powered Solution Draft

This pull request is being automatically generated to solve issue bpmbpm/rdf-grapher#131.

### 📋 Issue Reference
Fixes bpmbpm/rdf-grapher#131

### 🚧 Status
**Work in Progress** - The AI assistant is currently analyzing and implementing the solution draft.

### 📝 Implementation Details
_Details will be added as the solution draft is developed..._

---
*This PR was created automatically by the AI issue solver*
```

### Final PR State (after agent finished)

```
Title: [WIP] TestAg1a  ← STILL WIP!
Body: (unchanged from placeholder)  ← STILL PLACEHOLDER!
```

### Agent's Final Message

```
The issue has been successfully resolved. I changed the button label from
"Визуализировать" to "Отобразить" in the file `ver7so/index.html` as requested.
The change has been committed and pushed to the branch `issue-131-85b8eb98862d`,
updating the existing pull request #132.
```

The agent claimed success but did not update the PR metadata.

## Impact

1. **User confusion**: The PR looks incomplete/in-progress even though work is done
2. **Reviewers may skip**: PRs with [WIP] prefix are typically ignored by reviewers
3. **Missing context**: The description doesn't explain what was actually changed
4. **Issue linking broken**: While "Fixes #X" was eventually added, the description still says "Details will be added..."

## Implemented Solution

The solution follows a two-pronged approach:

### 1. Gentle Prompt Guidance (agent, opencode, codex prompts)

Replaced forcing language (`IMPORTANT`, `MUST`) with gentle, factual suggestions:

- Added to the "finalize the pull request" checklist: "check that pull request title and description are updated"
- No forcing words - just a factual suggestion as part of the existing checklist
- Only applied to agent/opencode/codex prompts (not claude - it's obvious for Claude models)

### 2. `--auto-restart-on-non-updated-pull-request-description` Option

New CLI option that:

1. After agent execution, detects if PR title/description still contains auto-generated placeholder content
2. If placeholders found, auto-restarts the tool with a short factual hint:
   - "Pull request title and description were not updated."
   - "Pull request title was not updated."
   - "Pull request description was not updated."
3. The hint uses neutral, fact-stating language (no forcing words like IMPORTANT/MUST)
4. Runs one restart iteration (disabled on restart to prevent infinite loops)
5. If placeholders still present after restart, falls back to the existing cleanup logic

### Key Design Decisions

- **No forcing in prompts**: Per reviewer feedback, forcing language (`IMPORTANT`, `MUST`) is counterproductive. Simple suggestions work better.
- **Claude excluded**: Claude models handle PR title/description updates naturally, so no additional prompt guidance needed.
- **Auto-restart is opt-in**: The `--auto-restart-on-non-updated-pull-request-description` flag is `false` by default.
- **Factual hints only**: The restart hint states facts ("title was not updated") rather than commands ("you MUST update").
- **Existing fallback preserved**: When auto-restart is not enabled, the existing [WIP] removal and placeholder replacement logic in `verifyResults` still works.

## Files Modified

| File                             | Changes                                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/solve.config.lib.mjs`       | Added `--auto-restart-on-non-updated-pull-request-description` option                                                                        |
| `src/solve.results.lib.mjs`      | Added `hasPRTitlePlaceholder`, `hasPRBodyPlaceholder`, `buildPRNotUpdatedHint` exports; updated `verifyResults` to return placeholder status |
| `src/solve.mjs`                  | Added auto-restart logic after `verifyResults` when placeholders detected                                                                    |
| `src/agent.prompts.lib.mjs`      | Replaced forcing language with gentle suggestion                                                                                             |
| `src/opencode.prompts.lib.mjs`   | Replaced forcing language with gentle suggestion                                                                                             |
| `src/codex.prompts.lib.mjs`      | Replaced forcing language with gentle suggestion                                                                                             |
| `tests/test-pr-finalization.mjs` | Added tests for new functions and hint language verification                                                                                 |

## Reproduction Steps

1. Create a simple issue in a repository
2. Run solve with `--tool agent` flag
3. Observe that PR is created with [WIP] prefix
4. Wait for agent to complete the task
5. Check PR title/description - still contains WIP and placeholder

### With fix:

6. Run solve with `--tool agent --auto-restart-on-non-updated-pull-request-description`
7. If agent doesn't update, tool auto-restarts with hint
8. Agent gets another chance to update title/description

## Related Issues

- This is the first reported instance of this behavior
- May affect all `--tool agent` executions with non-Claude models

## Attachments

- [Full solution draft log](./solution-draft-log.txt) (952KB)
- Original issue: https://github.com/link-assistant/hive-mind/issues/1162
- Example affected PR: https://github.com/bpmbpm/rdf-grapher/pull/132
