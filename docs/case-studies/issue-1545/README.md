# Case Study: Issue #1545 - Bug with `--isolation screen` Mode

## Summary

When using `/solve` with `--isolation screen` in the Telegram bot, the session monitoring fails because the `$` CLI from `start-command` tracks executions by its own internal UUID, not by the `--session` name passed to it. This causes:

1. `$ --status <sessionId>` to fail with "No execution found" when querying by the session name
2. The `$` CLI to report `status: executed, exitCode: 0` immediately (tracking the wrapper exit, not the screen process)
3. The session monitor to prematurely detect session completion, sending incorrect Telegram notifications

## Timeline of Events

| Timestamp (UTC)      | Event                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| 2026-04-08T07:28:00Z | User sends `/solve https://github.com/link-assistant/hive-mind/pull/564 --isolation screen`        |
| 2026-04-08T07:28:04Z | `isolation-runner` generates session UUID: `54fc440a-0f4b-44f6-8191-ea630b8f73d0`                  |
| 2026-04-08T07:28:04Z | Executes: `$ --isolated screen --detached --session 54fc440a-... -- solve <url> <args>`            |
| 2026-04-08T07:28:04Z | `$` CLI creates its OWN internal UUID: `6a176d96-59ee-4101-9212-f45147c0bc93`                      |
| 2026-04-08T07:28:04Z | `$` CLI launches screen session named `54fc440a-...` and immediately exits (detached mode)         |
| 2026-04-08T07:28:04Z | `$` CLI reports exit code 0 — the wrapper itself exited, not the screen process                    |
| 2026-04-08T07:28:04Z | Telegram bot sends success message with session `54fc440a-...`                                     |
| 2026-04-08T07:28:04Z | Session tracked in memory with `sessionId: 54fc440a-...`                                           |
| ~07:28:34Z           | Session monitor runs, calls `$ --status 54fc440a-...` → "No execution found"                      |
| ~07:28:34Z           | Monitor concludes session ended (false negative), sends premature completion notification           |
| (continuing)         | Screen session `54fc440a-...` is STILL running (`screen -r 54fc440a-...` works)                    |

## Root Cause Analysis

### Problem 1: `$ --status` Cannot Find Sessions by `--session` Name (start-command Bug)

The `$` CLI from `start-command` generates its own internal UUID (`6a176d96-...`) for tracking executions. The `--session` parameter (`54fc440a-...`) is passed through to the isolation backend (screen) as the session name, but `$ --status` only looks up executions by the internal UUID.

**Evidence:**
```
$ $ --status 54fc440a-0f4b-44f6-8191-ea630b8f73d0
Error: No execution found with UUID: 54fc440a-0f4b-44f6-8191-ea630b8f73d0

$ $ --status 6a176d96-59ee-4101-9212-f45147c0bc93
6a176d96-59ee-4101-9212-f45147c0bc93
  status executed
  exitCode 0
```

The `$ --session <name>` flag allows setting a custom screen session name, but there is no way to later query status by that name — only by the internal UUID. This means callers must capture the internal UUID from `$` output to use `--status`, defeating the purpose of providing a predictable session name.

### Problem 2: `$ --detached` Reports Immediate Completion (start-command Bug)

When `$ --isolated screen --detached` is used, the `$` wrapper itself exits immediately after launching the screen session. It reports `status: executed, exitCode: 0` — tracking the wrapper's lifecycle, not the actual screen process inside.

**Evidence:**
```
  status executed
  exitCode 0
  startTime "2026-04-08T07:28:04.143Z"
  endTime "2026-04-08T07:28:04.202Z"
```

Duration: 59ms — clearly just the wrapper starting screen, not the solve operation.

Meanwhile, `screen -r 54fc440a-...` shows the session is still running.

### Problem 3: Hive Mind Session Monitor Has No Fallback (Hive Mind Bug)

The session monitor in `session-monitor.lib.mjs` uses `$ --status <sessionId>` as the ONLY way to check isolation-mode session liveness (line 60-61). When `$ --status` fails to find the session (Problem 1) or reports it as completed (Problem 2), the monitor incorrectly concludes the session is finished.

For screen-backend isolation, the monitor should fall back to `screen -ls` to verify the session is actually gone before declaring it complete.

**Code path:**
```
monitorSessions() → checkIsolatedSessionRunning(sessionId)
  → querySessionStatus(sessionId)     // $ --status → "not found" or "executed"
  → returns false                      // concludes session ended
  → sends premature completion notification
```

## Proposed Solutions

### Fix 1: Add `screen -ls` Fallback in Hive Mind (This PR)

In `session-monitor.lib.mjs`, when the isolation backend is `screen`, add a fallback check using `screen -ls` before declaring a session complete. This makes hive-mind resilient to `start-command` bugs:

```javascript
// If $ --status says not running, verify with screen -ls for screen backend
if (!stillRunning && sessionInfo.isolationBackend === 'screen') {
  stillRunning = await checkScreenSessionExists(sessionName);
}
```

Also add the same fallback in `isolation-runner.lib.mjs` `querySessionStatus()` for screen sessions.

### Fix 2: Parse Internal UUID from `$` Output (This PR)

Extract the internal UUID from `$` CLI output (the `session` field) and store it alongside the screen session name. This allows `$ --status` to work with the correct UUID.

### Fix 3: Report start-command Bugs (Separate Issue)

Two bugs should be filed against `link-foundation/start`:

1. **`$ --status` should support `--session` name lookups**: When a session is created with `--session <name>`, `$ --status <name>` should find it (in addition to `$ --status <internal-uuid>`).

2. **`$ --detached` should track screen process lifecycle**: When using `--isolated screen --detached`, the status should reflect whether the screen session is still running, not just whether the `$` wrapper exited.

## Files Involved

| File                              | Role                                               |
| --------------------------------- | -------------------------------------------------- |
| `src/session-monitor.lib.mjs`     | Session monitoring — needs screen -ls fallback      |
| `src/isolation-runner.lib.mjs`    | Isolation execution — needs UUID extraction + fallback |
| `src/telegram-isolation.lib.mjs`  | Per-command isolation resolution                    |
| `src/telegram-bot.mjs` (line 590-618) | `executeAndUpdateMessage()` — session tracking   |

## References

- Issue: https://github.com/link-assistant/hive-mind/issues/1545
- start-command: https://github.com/link-foundation/start
- Per-command isolation PR: https://github.com/link-assistant/hive-mind/pull/1535
