# Case Study: Issue #1201 - `"type": "error"` was not treated as fail

## Summary

When using `--tool agent`, the agent tool emitted a JSON error event
(`{"type": "error", "error": "The operation timed out."}`) but the solve process
treated the execution as successful, leading to an incorrect auto-restart sequence
instead of an immediate failure exit.

## Timeline of Events

**2026-01-30T14:50:59Z** - `solve` started with `--tool agent --model opencode/big-pickle`
for PR #129 on `netkeep80/isocubic` (continue mode).

**2026-01-30T14:51:12Z** - Work session started on branch `issue-119-eebbf88b8728`.

**2026-01-30T14:51:20Z - 14:55:24Z** - Agent executed multiple steps successfully:
reading files, processing tool calls, generating text output.

**2026-01-30T14:56:20Z** - **THE ERROR**: Agent emitted:

```json
{
  "type": "error",
  "timestamp": 1769784980576,
  "sessionID": "ses_3f09cdf7affePwF0n1677v3wqX",
  "error": "The operation timed out."
}
```

**2026-01-30T14:57:32Z** - Agent **continued** after the error, emitting more
`text` and `step_finish` events (the agent process did not exit on the error).

**2026-01-30T14:57:33Z** - Agent process exited with **exit code 0**.

**2026-01-30T14:57:33Z** - `solve` logged `✅ Agent command completed` (success path).

**2026-01-30T14:57:33Z** - Uncommitted changes detected (`M src/types/god-mode.ts`),
triggering auto-restart sequence instead of failure exit.

**2026-01-30T14:57:35Z** - PR converted to "ready for review" despite the error.

## Root Cause Analysis

### Primary Root Cause

The agent tool's NDJSON streaming output was being collected into a `fullOutput`
string buffer. After the stream completed, a `detectAgentErrors()` function would
parse `fullOutput` line by line to look for `"type": "error"` events.

The bug occurred because when stream chunks arrive from the child process, they
may not always have clean newline delimiters between NDJSON objects. When two JSON
objects get concatenated without a newline separator in `fullOutput`, the
`JSON.parse()` call fails on the combined string, and the error event is silently
skipped.

### Contributing Factor 1: Agent continues after error

The agent tool process continued executing after emitting the error event and
exited with code 0. This meant the exit code check (`exitCode !== 0`) also did
not catch the failure.

### Contributing Factor 2: Error field naming

The error JSON uses `"error"` field (not `"message"`), while the
`detectAgentErrors` function only checked `msg.message` for the error text. While
this didn't affect detection (it still checked `msg.type`), it meant the error
message text was not captured in the match field.

## Fix Applied

### Changes to `src/agent.lib.mjs`

1. **Streaming error detection (primary)**: Added error event detection during
   the `for await` streaming loop, where each JSON line is already being parsed
   individually. This catches errors reliably regardless of how chunks are
   buffered.

2. **Combined detection logic**: After streaming completes, if the post-hoc
   `detectAgentErrors()` missed the error but streaming detection caught it,
   the streaming result is used.

3. **Error field support**: Updated both streaming and post-hoc detection to
   check `msg.error` in addition to `msg.message` for capturing error text.

### Changes to `tests/test-agent-error-detection.mjs`

Added tests 11-15 covering:

- Error events with `"error"` field (not `"message"`)
- Error events followed by continued agent output
- Concatenated JSON objects without newlines (the exact bug scenario)
- Streaming detection simulation
- Combined detection (streaming + post-hoc fallback)

## Files

- `solution-draft-log-pr-129-agent-error.txt` - Full execution log showing the bug
- `pr-129-comments.txt` - Comments from the affected PR

## Key Lessons

1. **Stream processing should detect errors inline**: Relying solely on post-hoc
   parsing of accumulated output is fragile when dealing with streaming data that
   may have buffering artifacts.

2. **Agent tool processes should exit non-zero on errors**: The upstream agent
   tool continued execution and exited with code 0 after an error event. Ideally,
   the agent process should propagate errors to its exit code.

3. **Error field naming matters**: When consuming JSON APIs, check all possible
   field names for error information (`message`, `error`, `detail`, etc.).
