# Case Study: Interactive Mode Improvements (Issue #1450)

## Reference

- **Issue:** https://github.com/link-assistant/hive-mind/issues/1450
- **Test Case PR:** https://github.com/xlab2016/space_db_private/pull/16
- **Date:** 2026-03-20

## Problem Statement

The interactive mode in hive-mind posts real-time PR comments during Claude Code execution sessions. Analysis of PR #16 in `xlab2016/space_db_private` revealed several issues:

1. **Unrecognized events creating noisy comments** - Events like `system.task_started`, `system.task_progress`, `system.task_notification`, and `rate_limit_event` are posted as "Unrecognized Event" comments, cluttering the PR.
2. **Excessive comment volume** - The session generated 50 comments for a ~5-minute session, many being repetitive `system.task_progress` events.
3. **No deduplication of task progress updates** - Each `system.task_progress` event creates a new comment instead of updating an existing one per task.

## Timeline Reconstruction

| Time              | Event                        | Comment                                    |
| ----------------- | ---------------------------- | ------------------------------------------ |
| 12:53:14          | `system.init`                | Session started table                      |
| 12:53:20          | `assistant.text`             | AI text message                            |
| 12:53:26          | `assistant.tool_use` (Agent) | Agent tool use with "waiting..."           |
| 12:53:32          | `system.task_started`        | **Unrecognized** - Agent subtask started   |
| 12:53:38          | `rate_limit_event`           | **Unrecognized** - Rate limit info         |
| 12:53:44          | `system.task_progress`       | **Unrecognized** - "View GitHub issue #15" |
| 12:53:51          | `assistant.tool_use` (Bash)  | Bash tool use                              |
| 12:53:57          | `system.task_progress`       | **Unrecognized** - "View PR #16"           |
| 12:54:03          | `assistant.tool_use` (Bash)  | Bash tool use                              |
| ...               | (pattern repeats)            | task_progress + tool_use alternating       |
| 12:56:22          | `system.task_notification`   | **Unrecognized** - Agent task completed    |
| 12:56:28-12:57:52 | Various tool calls           | Read, Edit, Bash for implementation        |
| 12:57:58          | `assistant.text`             | Final summary                              |
| 12:58:10          | Solution draft log           | Log upload                                 |
| 12:58:15          | `result.success`             | Session complete                           |

**Total: 50 comments, of which 16 were "Unrecognized Event" comments (32%).**

## Root Cause Analysis

### 1. Missing Event Handlers

The `processEvent` switch statement in `interactive-mode.lib.mjs` only handles:

- `system` (subtype `init` only)
- `assistant` (text and tool_use)
- `user` (tool_result)
- `result`

Missing event types:

- **`system.task_started`** - Emitted when an Agent tool spawns a subtask. Contains task_id, tool_use_id, description, prompt.
- **`system.task_progress`** - Emitted periodically as a subtask runs. Contains task_id, description of current step, usage stats.
- **`system.task_notification`** - Emitted when a subtask completes. Contains task_id, status, summary, final usage.
- **`rate_limit_event`** - Emitted with rate limit status information.

### 2. Comment Volume Problem

Each `system.task_progress` event creates a separate comment. In the test case, a single Agent tool call generated 13 progress events, each creating a new "Unrecognized Event" comment. The ideal behavior would be to:

- Create one comment when a task starts
- Update that same comment as progress events arrive
- Finalize the comment when the task completes

### 3. Rate Limit Event Noise

The `rate_limit_event` is informational and doesn't need its own visible comment. It should either be silently logged or folded into an existing comment.

## Solution

### New Event Handlers

1. **`system.task_started`** - Creates a comment showing the agent task starting, with task description and prompt preview. Tracks the comment ID for progress updates.
2. **`system.task_progress`** - Updates the existing task comment (created by task_started) with the latest progress description and usage stats. No new comment created.
3. **`system.task_notification`** - Updates the existing task comment with final status (completed/failed) and summary.
4. **`rate_limit_event`** - Silently logged (no comment created). Rate limit info is internal and not useful for PR review.

### Expected Comment Reduction

For the PR #16 test case:

- Before: 50 comments (16 unrecognized)
- After: ~35 comments (0 unrecognized, 1 task lifecycle comment instead of 15)

## Data Files

- `pr16-comments-raw.json` - All 50 PR comments with full metadata
- `pr16-solution-draft-log.txt` - Complete execution log (5120 lines)
