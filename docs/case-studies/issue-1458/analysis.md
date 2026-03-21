# Case Study: Interactive Mode Comment Output Issues (#1458)

## Overview

Investigation of 89+ broken PR comments during an interactive Claude session on
`xlab2016/space_db_private/pull/20`. Three distinct failure modes were identified,
each with a different root cause.

**Source data:**
- PR: `xlab2016/space_db_private/pull/20` (339 total comments)
- Solution draft log: 51,196 lines (from gist)
- Representative samples saved in this directory as JSON files

---

## Issue 1: Empty/Corrupted Markdown Fields (27 comments)

### Symptoms
Comments displayed with literal empty fields like:
```
**Pattern:** ''
**File:** ''
**Path:** ''
```
Bodies contained literal single-quote characters (char code 39) wrapping field values.

### Root Cause
`command-stream`'s `quote()` function wraps values in shell single quotes:
`'value'` → which requires a shell to interpret. However, `gh api -f body=...`
passed via `execFile` (which bypasses the shell) received the quotes as literal
characters instead of shell metacharacters.

The comment body was correctly constructed in JavaScript, but corrupted during
the GitHub API call because `command-stream`'s tagged template literal produced
shell-quoted strings that were never shell-interpreted.

### Fix
Replaced `command-stream`'s `$` template literal calls with direct `execFileAsync`
using `--input -` to pass the JSON body via stdin. This completely bypasses shell
quoting and ensures the body arrives at the GitHub API exactly as constructed.

---

## Issue 2: Comments Not Updated With Results (61 comments)

### Symptoms
Tool use comments permanently showed "⏳ Waiting for result..." instead of being
edited with the tool's output when the result arrived.

### Root Cause
Deadlock between `handleToolResult` and `processQueue`:

1. `handleToolResult` awaits `commentIdPromise` (resolved when the tool_use
   comment is posted and gets a comment ID)
2. `commentIdPromise` is resolved by `processQueue` processing the comment queue
3. `processQueue` runs in `processEvent`'s `finally` block
4. But `processEvent` is blocked because `handleToolResult` is still awaiting

This created a circular dependency. After 30 seconds, the timeout fired and
`handleToolResult` posted a separate "result" comment instead of editing the
original. Evidence from logs:

```
21:55:38 - Tool use queued for comment
21:56:08 - "Timeout waiting for tool use comment, posting result separately"
```

### Fix
Added explicit queue flushing in `handleToolResult` before waiting for the
comment ID promise. This breaks the deadlock by processing any pending queue
items (including the tool_use comment) immediately.

---

## Issue 3: Duplicate Session Started Comment (1 comment)

### Symptoms
A second "🚀 Interactive session started" comment appeared at `22:40:53`,
well after the session was already active (first init at `21:54:53`).

### Root Cause
A `task_notification` event for a background dotnet SDK installation arrived
at `22:40:52` (after the `result` event at `22:40:37`). This late notification
triggered Claude CLI to emit a second `system.init` event with the same session
ID at `22:40:53`.

Timeline from logs:
```
21:54:53 - First system.init (session starts)
22:40:37 - result event (session effectively ends)
22:40:52 - Late task_notification (background dotnet install)
22:40:53 - Second system.init (same session ID - causes duplicate comment)
```

### Fix
Added a guard in `handleSystemInit` that checks if `state.sessionId` is already
set. If a session is already initialized, the duplicate `system.init` event is
silently ignored (with verbose logging for diagnostics).

---

## Files Changed

- `src/interactive-mode.lib.mjs` — All three fixes applied
- `tests/test-interactive-mode.mjs` — Updated test mocks for new `execFileAsync` pattern
- `src/unicode-sanitization.lib.mjs` — No changes (already correct from #1324)

## Testing

All 91 tests pass after the fixes, including existing regression tests for
unicode sanitization (#1324) and agent task events (#1450).
