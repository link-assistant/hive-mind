# Case Study: Issue #1472 - Interactive Mode Not Working / #1475 - Solve Command Stuck

## Summary

The user ran `/solve` with `--interactive-mode` via Telegram bot. Interactive mode was correctly
recognized and the handler was created, but it could not function because Claude CLI produced zero
output for ~4.5 hours. The solve command was stuck, requiring manual CTRL+C to terminate.

## Timeline Reconstruction

### Case 1: trees-rs/issues/8 (PR #9)

| Time     | Event                                                                           |
| -------- | ------------------------------------------------------------------------------- |
| 09:13:40 | solve v1.35.9 started with `--model opus --interactive-mode`                    |
| 09:13:45 | System checks passed (disk, memory)                                             |
| 09:13:49 | Branch `issue-8-c1619bfb477b` created, initial commit pushed                    |
| 09:13:59 | Draft PR #9 created                                                             |
| 09:14:10 | Interactive mode handler created (`claude.lib.mjs:854`)                         |
| 09:14:10 | Claude CLI process spawned with `--output-format stream-json --verbose`         |
| 09:14:14 | API request sent to Anthropic, 200 OK received (per response `date` header)     |
| 09:14:14 | **No output from Claude CLI from this point onward**                            |
| 13:57:58 | **~4h44m later**: User pressed CTRL+C                                           |
| 13:57:58 | ALL buffered output flushed at once: system.init event, API debug logs          |
| 13:57:58 | Interactive mode tried to post comment on init, got HTTP 400 (body: 2860 chars) |
| 13:58:01 | Process terminated                                                              |

### Case 2: xlab2016/space_db_private/issues/23 (PR #24)

| Time     | Event                                                                    |
| -------- | ------------------------------------------------------------------------ |
| 09:42:04 | solve started with `--interactive-mode` (no --model, defaults to sonnet) |
| 09:42:41 | Interactive mode handler created, Claude CLI spawned                     |
| 09:42:44 | API request 200 OK (per response `date` header)                          |
| 09:42:44 | **No output from Claude CLI from this point onward**                     |
| 13:59:45 | **~4h17m later**: User pressed CTRL+C, all output flushed at once        |
| 13:59:45 | Same pattern: system.init + API debug dump + failed comment post         |

## Root Cause Analysis

### Primary Root Cause: Claude CLI stdout/stderr completely stuck

Both sessions show identical behavior:

1. Claude CLI (v2.1.81) was spawned via `command-stream` with `stdin: prompt`
2. The process successfully made the API request (confirmed by response headers)
3. The API returned 200 OK with `text/event-stream` content within ~2 seconds
4. **Zero bytes** of stdout or stderr reached the parent process for ~4.5 hours
5. When CTRL+C killed the process, ALL output (system.init, API debug logs) flushed at once

This is NOT a simple buffering issue — both stdout (stream-json events) AND stderr
(ANTHROPIC_LOG=debug output) were held back simultaneously.

### Interactive Mode: Correctly Recognized but Unable to Function

- `--interactive-mode` was properly parsed by yargs (`argv.interactiveMode = true`)
- Em-dash (`—`) from Telegram was correctly converted to `--` by telegram-bot.mjs:452
- Interactive handler was created in `claude.lib.mjs:854-856`
- Handler could not function because zero stream events were delivered
- When events finally arrived (on CTRL+C), the handler tried to post a comment but got HTTP 400

### Contributing Factors

1. **Claude CLI v2.1.81**: This version may have a bug causing stdout to not flush when
   output is piped (not a TTY). A test with v2.1.84 showed correct streaming behavior.
2. **MCP servers**: Both sessions had `needs-auth` MCP servers (Google Calendar, Gmail).
   MCP_TIMEOUT is set to 900000ms (15 min). While this alone doesn't explain the 4.5h hang,
   MCP initialization could interact with the output buffering issue.
3. **No startup timeout**: Before this fix, there was no mechanism to detect that Claude CLI
   had produced zero output. The force-kill timeout (Issue #1280) only activates after a
   `result` event — which never arrived.

## Fix Applied

### 1. Stream Startup Timeout (`claude.lib.mjs` + `config.lib.mjs`)

Added a configurable timeout (default: 2 minutes) that monitors time-to-first-output from
Claude CLI. If no stdout or stderr chunk arrives within this period, the process is
force-killed via the existing `forceExitOnTimeout()` mechanism.

- Normal Claude CLI startup emits `system.init` within 1-3 seconds
- The 2-minute default provides ample margin for slow starts or MCP initialization
- Configurable via `HIVE_MIND_STREAM_STARTUP_MS` environment variable
- Timeout is cleared immediately when any output chunk is received

### 2. Stream Activity Timeout (`claude.lib.mjs` + `config.lib.mjs`)

Added a configurable activity timeout (default: 5 minutes) that detects mid-session hangs.
Unlike the startup timeout (which catches zero-output scenarios), the activity timeout
catches cases where Claude CLI starts producing output then stops — which is exactly what
happened in the original issue (output arrived only when CTRL+C was pressed).

- Resets on every stdout chunk received
- Only active before the result event (once result is received, the existing
  `resultStreamCloseMs` timeout takes over)
- Triggers the same force-kill and transient error retry mechanism
- Activity timeout preserves the session for resume (work was started)
- Configurable via `HIVE_MIND_STREAM_ACTIVITY_MS` environment variable

### 3. Automatic Retry on Timeout (`claude.lib.mjs`)

Both startup and activity timeouts are integrated into the unified transient error retry system:

- When either timeout fires, a flag is set (`isStartupTimeout` or `isActivityTimeout`)
- Both flags are included in the `isTransientError` condition, triggering automatic retry
- Timeout retries use shorter backoff (30s initial, 120s max) vs API errors,
  since this is a CLI bug not server-side load
- Startup timeout retries start fresh (no `--resume`) since no session was created
- Activity timeout retries preserve the session (work was started, resume it)
- This ensures the solve command recovers automatically instead of just failing

### 4. Remaining Buffer Forwarded to Interactive Handler (`claude.lib.mjs`)

Fixed a bug where the last incomplete NDJSON line in the stream buffer was processed for
cost extraction but never forwarded to the interactive mode handler. If the last event
didn't end with `\n`, it was lost for interactive mode.

### 5. Interactive Mode Diagnostic Counters (`interactive-mode.lib.mjs`)

Added comprehensive diagnostic counters to the interactive handler state:

- `eventsProcessed` — total events passed to `processEvent()`
- `commentsAttempted` / `commentsPosted` / `commentsFailed` — comment lifecycle tracking
- `editsAttempted` / `editsSucceeded` / `editsFailed` — edit lifecycle tracking

These counters are logged in a summary at the end of every interactive mode session,
making it possible to diagnose whether:

- Events were received but comments failed (GitHub API issue)
- Events were never received (CLI output issue)
- Comments were queued but never flushed

### 6. Comment Failure Logging (`interactive-mode.lib.mjs`)

Changed comment posting failures from verbose-only logging to always-on logging.
In the original incident, the HTTP 400 failure was silently swallowed when `--verbose`
wasn't the right level, making it impossible to diagnose without deep log analysis.

### How This Solves the Original Issue

The original problem was: `--interactive-mode` was requested but zero comments were posted.

**Root cause chain:**

1. Claude CLI stdout was stuck (CLI bug in v2.1.81)
2. No stream events reached the parent process for 4.5 hours
3. Interactive mode handler never received events to post as comments
4. When events finally arrived (at CTRL+C), comment posting failed with HTTP 400
5. No timeout existed to detect the zero-output or stalled-output condition
6. Comment posting failures were only logged in verbose mode

**Fix chain:**

1. Startup timeout detects zero output within 2 minutes → force-kill + retry
2. Activity timeout detects stalled output within 5 minutes → force-kill + retry
3. On retry, if CLI works normally, interactive mode receives events and posts comments
4. Remaining buffer events are now forwarded to interactive handler (fixes edge case)
5. Diagnostic counters track events/comments/failures for complete observability
6. Comment failures are always logged (not just verbose) for easier debugging
7. End-of-session summary reports total events, comments attempted/posted/failed

## Log Files

- `trees-rs-issue-8-solve-log.log` - Full log from linksplatform/trees-rs solve session
- `space-db-private-solve-log.log` - Full log from xlab2016/space_db_private solve session
