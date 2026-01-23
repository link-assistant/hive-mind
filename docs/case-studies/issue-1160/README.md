# Case Study: Issue #1160 - Conflicts Not Resolved by `--tool agent`

## Executive Summary

This case study analyzes why the Grok Code Fast 1 model (used with `--tool agent`) failed to automatically resolve merge conflicts in [GristWidgets PR #9](https://github.com/veb86/GristWidgets/pull/9), despite the system detecting and informing the agent about the DIRTY merge status.

**Key Finding**: The agent only resolved conflicts after receiving an explicit human comment "Resolve conflicts, please." This reveals that the current system prompt's guideline-based approach is insufficient for ensuring automatic conflict resolution.

## Problem Statement

When using `solve.mjs` with `--tool agent` (Grok Code Fast 1 model), the agent did not automatically resolve merge conflicts even when:

1. The system correctly detected `Merge status: DIRTY`
2. The feedback mechanism informed the agent: `"Merge status is DIRTY (conflicts detected)"`
3. The system prompt contained guidelines about merging the default branch

## Timeline of Events

| Timestamp (UTC) | Event | Session | Merge Status |
|-----------------|-------|---------|--------------|
| 2026-01-21T13:06:50Z | Initial work session started | pr-1769163546483 | CLEAN |
| 2026-01-23T10:11:05Z | Continued session | pr-1769163838639 | CLEAN |
| 2026-01-23T10:31:48Z | Session with conflicts | **pr-1769164538444** | **DIRTY** |
| 2026-01-23T10:32:15Z | Agent informed of DIRTY status | - | - |
| 2026-01-23T10:35:35Z | Agent marked PR "ready for review" | - | (conflicts not resolved) |
| 2026-01-23T15:49:04Z | Human comment: "Resolve conflicts, please." | - | - |
| 2026-01-23T15:49:34Z | New session started | pr-1769183633153 | DIRTY |
| 2026-01-23T15:52:29Z | Agent ran `git merge origin/main` | - | - |
| 2026-01-23T15:52:48Z | Agent committed merge resolution | - | CLEAN |

## Root Cause Analysis

### 1. System Prompt Design Issue

The current system prompt in `src/agent.prompts.lib.mjs` only contains a **guideline** about conflict resolution:

```
- When you finalize the pull request:
   ...
   make sure the default branch is merged to the pull request's branch,
   ...
```

This is structured as a "when finalizing" checklist item, not as an immediate action triggered by detecting conflicts.

### 2. Feedback Mechanism Limitation

The feedback system in `src/solve.feedback.lib.mjs` correctly detects DIRTY status and adds it to the feedback lines:

```javascript
const statusDescriptions = {
  DIRTY: 'Merge status is DIRTY (conflicts detected)',
  ...
};
```

However, passing this information as feedback doesn't guarantee the agent will act on it immediately - it's just informational.

### 3. Model-Specific Behavior

The Grok Code Fast 1 model:
- Focused on completing the task (implementing the widget)
- Did not proactively address the conflict status before marking PR ready
- Only resolved conflicts when explicitly instructed

Compare this to Claude Code (`--tool claude`), which typically follows the system prompt guidelines more strictly.

## Comparison: Claude Code vs Agent Tool

| Aspect | Claude Code (`--tool claude`) | Agent Tool (`--tool agent`) |
|--------|------------------------------|----------------------------|
| Model Used | Claude 3.5/4 Sonnet | Grok Code Fast 1 |
| Prompt Following | Strict adherence | May require explicit instructions |
| Conflict Handling | Typically proactive | Reactive (waits for explicit request) |
| System Prompt Length | 8500+ chars | 7759 chars |

## Evidence from Logs

### Session Where Conflicts Were Not Resolved (pr-1769164538444)

```
[2026-01-23T10:32:00.914Z] [INFO]    Merge status: DIRTY
[2026-01-23T10:32:15.767Z] [INFO]      - Merge status is DIRTY (conflicts detected)
...
[2026-01-23T10:35:29.513Z] [INFO]         "command": "gh pr ready 9 --repo veb86/GristWidgets",
[2026-01-23T10:35:29.513Z] [INFO]         "description": "Mark the PR as ready for review"
[2026-01-23T10:35:29.513Z] [INFO]       },
[2026-01-23T10:35:29.513Z] [INFO]       "output": "✓ Pull request veb86/GristWidgets#9 is marked as \"ready for review\"\n",
```

The agent marked PR ready despite unresolved conflicts.

### Session Where Conflicts Were Resolved (pr-1769183633153)

After receiving the explicit comment "Resolve conflicts, please.":

```
[2026-01-23T15:52:29.790Z] [INFO]         "command": "git merge origin/main",
[2026-01-23T15:52:29.790Z] [INFO]         "description": "Try to merge main to see conflicts"
...
[2026-01-23T15:52:48.082Z] [INFO]         "command": "git commit -m \"Merge branch 'main' into issue-8-d4719601faa7\"",
[2026-01-23T15:52:48.082Z] [INFO]         "description": "Commit the merge"
[2026-01-23T15:52:48.082Z] [INFO]       },
[2026-01-23T15:52:48.082Z] [INFO]       "output": "[issue-8-d4719601faa7 a2a2576] Merge branch 'main' into issue-8-d4719601faa7\n",
```

## Impact

- User had to manually intervene by adding a comment
- Additional session required to resolve conflicts
- Delays in PR workflow
- Inconsistent behavior between different tools/models

## Files in This Case Study

- `README.md` - This executive summary
- `TECHNICAL_SUMMARY.md` - Deep technical analysis
- `improvements.md` - Proposed solutions
- `data/session-logs-index.md` - Index with links to session logs (stored as GitHub Gists)

## References

- [Issue #1160](https://github.com/link-assistant/hive-mind/issues/1160) - Original issue report
- [GristWidgets PR #9](https://github.com/veb86/GristWidgets/pull/9) - The affected pull request
- [Session Start Comment](https://github.com/veb86/GristWidgets/pull/9#issuecomment-3789575034)
- [Session End Comment with Logs](https://github.com/veb86/GristWidgets/pull/9#issuecomment-3789588804)
- [Resolve Conflicts Comment](https://github.com/veb86/GristWidgets/pull/9#issuecomment-3790906051)
