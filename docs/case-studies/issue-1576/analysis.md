# Case Study: Issue #1576 — Interactive Mode GitHub Comments Display Fixes

## Timeline of Events

Source: PR https://github.com/xlab2016/space_db_private/pull/42 (April 11, 2026)

| Time (UTC) | Event                                                 | Comment ID |
| ---------- | ----------------------------------------------------- | ---------- |
| 01:48:00   | Interactive session started (Claude Sonnet 4.6)       | 4227697854 |
| 01:56:51   | Agent tool_use: Explore codebase                      | 4227734009 |
| 01:56:57   | task_started: Explore codebase → **stuck at Running** | 4227734276 |
| 02:03:15   | ToolSearch tool_use (generic JSON display)            | 4227758390 |
| 02:03:26   | TodoWrite (shows 9 items, no checked count)           | 4227759462 |
| 02:04:34   | Write tool (shows "Content", collapsed)               | 4227764307 |
| 02:06:27   | task_started: Build project → **no prompt shown**     | 4227772514 |
| 02:07:07   | task_started: Rebuild → **no prompt shown**           | 4227774733 |
| 02:08:10   | Session Complete (input_tokens: 47 — misleading)      | 4227780787 |
| 02:08:19   | Solution draft log (shows actual 124K+2.7M tokens)    | 4227781616 |

## Identified Problems and Root Causes

### 1. Agent tasks stuck at "⏳ Running..." (ALL 5 tasks affected)

**Root Cause:** When `postComment()` queues a task_started comment (due to rate limiting), the `taskId` was not passed to the queue. The `processQueue()` function only tracked `toolId` for `pendingToolCalls`, not `taskId` for `pendingTasks`. When the queued comment was finally posted, the returned `commentId` was never linked back to the pending task. Later, when `task_notification` arrived, `commentId` was null, the `commentIdPromise` timed out after 15s, and the edit was silently skipped.

**Fix:** Pass `taskId` through `postComment()` to the queue, and update `processQueue()` to resolve `pendingTasks` entries (same pattern as the existing `toolId` tracking). Also added queue flushing before waiting for comment IDs in `handleTaskProgress` and `handleTaskNotification`.

### 2. Token calculation mismatch (input_tokens: 47 vs actual ~124K)

**Root Cause:** The `result` event's `usage` object contains **last-iteration** token counts, not cumulative session totals. The `usage.input_tokens: 47` represents only the final API call's input tokens. The accurate cumulative data is in `result.modelUsage`, which breaks down tokens per model (including sub-agents using Haiku).

**Fix:** Prefer `modelUsage` over `usage` for the session completion comment. Display per-model token breakdowns when `modelUsage` is available, falling back to `usage` for backward compatibility.

### 3. Agent started "without prompt" (Comments 4227772514, 4227774733)

**Finding:** These tasks have `task_type: "local_bash"` — bash-type sub-agent tasks that inherently don't have prompts. This is expected behavior, not a bug. The `task_started` event for `local_bash` tasks does not include a `prompt` field.

### 4. Display formatting issues

| Problem                             | Fix                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `... [N lines truncated] ...`       | Changed to `... [X-Y lines are omitted] ...` showing actual line range |
| Task prompt collapsed by default    | Made expanded (`startOpen=true`)                                       |
| ToolSearch shown as generic JSON    | Added specific handler showing Query/Max Results                       |
| TodoWrite "Todos (9 items)"         | Changed to "Todos (2/9 items)" with checked count                      |
| Write tool "Content" (collapsed)    | Renamed to "Change", expanded, with line numbers                       |
| Edit tool diff without line numbers | Added line numbers                                                     |
| "Session Complete"                  | Renamed to "Interactive session completed"                             |
| No sub-agent identification         | Added 🤖🔀 emoji and Agent ID field                                    |

## Data Sources

- `pr42-comments.json` — Full comment data from PR #42 (1.1MB)
- `referenced-comments.json` — Extracted comments referenced in issue #1576
