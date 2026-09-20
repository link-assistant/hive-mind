# Case Study: `--tool claude` Command Execution Stuck After Success

## Issue Summary

**Issue URL**: https://github.com/link-assistant/hive-mind/issues/1280
**Report Date**: 2026-02-13
**Reporter**: @konard
**Severity**: High - Requires manual interrupt (CTRL+C) to terminate

## Problem Description

The `solve` command using `--tool claude` becomes stuck after successful task completion. The Claude Code CLI successfully completes its work (all CI checks pass, PR marked ready, final summary output), but the process hangs indefinitely until manually interrupted with CTRL+C.

## Timeline Reconstruction

Based on the log file `2ab1d239-9581-4d03-a895-af10c9fcb863.log`:

| Timestamp       | Event                                                         | Duration          |
| --------------- | ------------------------------------------------------------- | ----------------- |
| `20:51:52.702Z` | solve.mjs started                                             | -                 |
| `20:51:53.183Z` | Version: solve v1.22.4                                        | ~0.5s             |
| `20:52:00.361Z` | PR #158 branch identified: `issue-157-7ec6d0dc0010`           | ~7s               |
| `20:52:12.388Z` | Claude execution started                                      | ~12s              |
| `21:09:37.151Z` | Final tool use (CI check wait + sleep 60)                     | ~17min            |
| `21:09:43.587Z` | CI passing confirmed                                          | ~6s               |
| `21:09:52.131Z` | `gh pr ready 158` executed                                    | ~8s               |
| `21:10:07.696Z` | PR summary comment posted                                     | ~15s              |
| `21:10:17.135Z` | Final assistant message output                                | ~10s              |
| `21:10:17.168Z` | **SUCCESS RESULT** - `"type": "result", "subtype": "success"` | -                 |
| `21:10:17.169Z` | Cost captured: $5.573962 (by our code, inside `for await`)    | < 1ms             |
| `21:10:17.169Z` | "Captured result summary from Claude output"                  | < 1ms             |
| **GAP**         | **`for await` loop stuck waiting for stream to close**        | **~5 min 26 sec** |
| `21:15:43.123Z` | User interrupted with CTRL+C                                  | -                 |
| `21:15:43.124Z` | Exit code updated to 130 (SIGINT)                             | ~1ms              |
| `21:15:43.126Z` | "Claude command completed" (Total messages: 0, Tool uses: 0)  | ~3ms              |

**Critical Gap**: Between `21:10:17.169Z` and `21:15:43.123Z`, there was **5 minutes 26 seconds** where the `for await (const chunk of execCommand.stream())` loop was stuck waiting for `command-stream` to signal stream completion.

## Root Cause Analysis

### Primary Root Cause: `command-stream` Library Stream Lifecycle Issue

The hang occurs in the `for await` loop in `src/claude.lib.mjs` due to how the `command-stream` library (v0.9.4) implements its `stream()` async iterator.

**How `command-stream` `stream()` works:**

1. The `stream()` method is an async generator that listens for `'data'` and `'end'` events
2. The `'end'` event is emitted by `finish()` in `$.process-runner-base.mjs`
3. `finish()` is called from `executeChildProcess()` only after:
   ```javascript
   const code = await exited; // Wait for process exit
   await Promise.all([outPump, errPump, stdinPumpPromise]); // Wait for pipe close
   ```
4. `outPump` is `pumpReadable()` which does `for await (const chunk of readable)` on stdout
5. **If the child process keeps stdout open, `pumpReadable()` hangs indefinitely**
6. Without `finish()`, `'end'` is never emitted, and `stream()` iterator never terminates

### Secondary Issue: Dead Code — `chunk.type === 'exit'` Never Fires

`command-stream` v0.9.4 `stream()` only yields `{type:'stdout'}` and `{type:'stderr'}` chunks. It does NOT yield `{type:'exit'}` chunks. The `finish()` method emits `'exit'` as an EventEmitter event, but the `stream()` generator only listens to `'data'` and `'end'` — it never captures exit information.

This means the following code in `claude.lib.mjs` (and 5 other source files) is dead code:

```javascript
} else if (chunk.type === 'exit') {
  exitCode = chunk.code;      // ← Never executes
  if (chunk.code !== 0) {
    commandFailed = true;      // ← Never executes
  }
}
```

The exit code is actually obtained from `execCommand.result.code` after the loop (Issue #1165 workaround).

### Supporting Evidence: Claude CLI May Not Close stdout

The Claude CLI process sends the result event to stdout but may not close the stdout stream or exit promptly. Multiple related issues exist:

- https://github.com/anthropics/claude-code/issues/1920 (missing result event / hang)
- https://github.com/anthropics/claude-code/issues/24478 (CLI freeze/unresponsive)
- https://github.com/anthropics/claude-code/issues/24481 (hang in print mode)

However, as @konard noted in the PR review: the lines "Cost captured" and "Captured result summary" are printed by **our code** after the result event arrives. The hang is in our `for await` loop waiting for the `command-stream` library's `stream()` to terminate — NOT in the Claude CLI itself.

### Exit Code Evidence

Exit code `130` = `128 + SIGINT(2)`, confirming the process was killed by user CTRL+C, not a graceful exit.

## Applied Solution

### Workaround: Configurable Timeout After Result Event

In `src/claude.lib.mjs`, after receiving the result event, a timeout starts to force-kill the process:

1. When `data.type === 'result'` is received → start timeout (default 30s)
2. If `stream()` doesn't close within the timeout:
   - Send SIGTERM to the process
   - Wait 2 seconds
   - Send SIGKILL if still running
3. The `for await` loop breaks due to `forceExitTriggered` flag

The timeout is configurable via `HIVE_MIND_RESULT_STREAM_CLOSE_MS` environment variable (default: 30000ms).

### Upstream Bug Report

Filed issue on `command-stream` repository:

- https://github.com/link-foundation/command-stream/issues/155
  - `stream()` does not yield exit chunks
  - `stream()` hangs if stdout stays open after process exit

Previously filed report to Anthropic:

- https://github.com/anthropics/claude-code/issues/25629

## Impact Assessment

| Impact Area     | Severity | Description                                                          |
| --------------- | -------- | -------------------------------------------------------------------- |
| Automation      | High     | Automated CI/CD pipelines using solve command will hang indefinitely |
| Resource Usage  | Medium   | Stuck processes consume memory and may accumulate                    |
| User Experience | High     | Users must manually monitor and interrupt stuck processes            |
| Data Integrity  | Low      | Work is saved before hang occurs; no data loss                       |

## Long-term Recommendations

1. **Fix `command-stream`** to yield exit chunks and handle stdout staying open
2. **Consider alternative**: If command-stream is fixed to yield exit chunks, the timeout workaround can be removed
3. **Monitor**: If Claude CLI starts closing stdout properly, the timeout will simply clear without firing

## Files and Evidence

- Log file: Available via gist (8304 lines, ~4MB)
- Screenshot 1: `./screenshot1.png` - Shows success result JSON
- Screenshot 2: `./screenshot2.png` - Shows CTRL+C interrupt and subsequent cleanup

## Related Links

- Original Issue: https://github.com/link-assistant/hive-mind/issues/1280
- Related PR: https://github.com/link-assistant/agent/pull/158
- **command-stream Issue**: https://github.com/link-foundation/command-stream/issues/155
- **Upstream Claude CLI Issue**: https://github.com/anthropics/claude-code/issues/25629
- Claude Code Issues:
  - https://github.com/anthropics/claude-code/issues/1920
  - https://github.com/anthropics/claude-code/issues/24478
  - https://github.com/anthropics/claude-code/issues/24481
