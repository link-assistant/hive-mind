# Case Study: Issue #1162 - `--tool agent` does not update Pull Request description and title

## Summary

When using `--tool agent` mode with external AI models (like Grok Code), the pull request title and description remain in their initial WIP (Work In Progress) placeholder state even after the solution is successfully implemented.

## Timeline of Events

Based on the solution draft log from PR bpmbpm/rdf-grapher#132:

| Timestamp (UTC) | Event |
|-----------------|-------|
| 14:58:48 | solve.mjs v1.9.0 started with `--tool agent` flag |
| 14:58:55 | Fork mode enabled for konard/bpmbpm-rdf-grapher |
| 14:59:02 | Repository cloned and upstream set |
| 14:59:04 | Branch `issue-131-85b8eb98862d` created |
| 14:59:04 | CLAUDE.md file created and committed |
| 14:59:05 | Branch pushed to remote |
| 14:59:09 | **Draft PR #132 created with title `[WIP] TestAg1a`** |
| 14:59:09 | **PR body set to WIP placeholder template** |
| 14:59:19 | Agent (Grok Code) execution started |
| 14:59:26 | Agent read issue #131 details |
| 14:59:40 | Agent made code change (button label update) |
| 15:00:00 | Agent committed and pushed changes |
| 15:00:22 | **Agent finished - did NOT update PR title/description** |
| 15:00:22 | solve.mjs cleanup: reverted CLAUDE.md commit |
| 15:00:24 | **solve.mjs finalization: converted draft to ready, but did NOT update title/description** |
| 15:00:26 | PR #132 marked ready for review (still with [WIP] title) |

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

## Proposed Solutions

### Solution 1: Add Fallback in solve.mjs (Recommended)

Modify `verifyResults` in `solve.results.lib.mjs` to:
1. Remove `[WIP]` prefix from title after agent finishes
2. Update PR description with a summary of changes (if still contains placeholder)

**Pros:**
- Works regardless of agent behavior
- Consistent experience across different AI models
- Minimal change required

**Cons:**
- Centralized logic, agent doesn't control final output
- May overwrite intentional WIP status

### Solution 2: Stronger Instructions in Agent Prompts

Add more explicit and mandatory instructions to the agent system prompt:

```
CRITICAL: Before finishing, you MUST:
1. Run: gh pr edit ${prNumber} --title "Updated title describing the change"
2. Run: gh pr edit ${prNumber} --body "$(cat <<'EOF'
Updated description here...
EOF
)"
```

**Pros:**
- Agent retains full control
- Customized descriptions per task

**Cons:**
- Dependent on agent following instructions
- Different models may have varying compliance

### Solution 3: Hybrid Approach (Best)

1. Improve agent instructions to emphasize PR update requirement
2. Add fallback in solve.mjs to detect and fix incomplete PR metadata
3. Log a warning when fallback is triggered for monitoring

## Files Involved

| File | Role |
|------|------|
| `src/solve.auto-pr.lib.mjs` | Creates initial [WIP] PR with placeholder |
| `src/solve.results.lib.mjs` | Post-processing after agent finishes |
| `src/agent.prompts.lib.mjs` | Agent instructions (includes PR edit guidance) |
| `src/claude.prompts.lib.mjs` | Claude-specific prompts |
| `src/opencode.prompts.lib.mjs` | OpenCode-specific prompts |
| `src/codex.prompts.lib.mjs` | Codex-specific prompts |

## Reproduction Steps

1. Create a simple issue in a repository
2. Run solve with `--tool agent` flag
3. Observe that PR is created with [WIP] prefix
4. Wait for agent to complete the task
5. Check PR title/description - still contains WIP and placeholder

## Related Issues

- This is the first reported instance of this behavior
- May affect all `--tool agent` executions with non-Claude models

## Attachments

- [Full solution draft log](./solution-draft-log.txt) (952KB)
- Original issue: https://github.com/link-assistant/hive-mind/issues/1162
- Example affected PR: https://github.com/bpmbpm/rdf-grapher/pull/132
