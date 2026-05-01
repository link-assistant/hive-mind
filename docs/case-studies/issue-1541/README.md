# Case Study: Issue #1541 - Agent CLI False Positive Error Detection

## Summary

When using Agent CLI with `--tool agent --verbose` mode, Hive Mind's `solve.mjs` falsely reports agent errors due to verbose log messages being emitted as `"type": "error"` JSON events by the Agent CLI. Additionally, the session fails with a "zero tokens with unknown finish reason" error from the OpenCode provider, but the false positive error detection obscures the real problem.

## Timeline of Events

| Timestamp (UTC)      | Event                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| 2026-04-07T17:24:00Z | `solve.mjs` v1.46.9 started for PR #1763 (Jhon-Crow/godot-topdown-MVP)                                         |
| 2026-04-07T17:24:07Z | Continue mode activated, using existing PR branch `issue-1762-c0f424e30cbb`                                    |
| 2026-04-07T17:24:25Z | Work session started, Agent CLI invoked with `--model opencode/minimax-m2.5-free --verbose`                    |
| 2026-04-07T17:24:34Z | Agent CLI starts, configuration resolved                                                                       |
| 2026-04-07T17:24:35Z | Migration failure: `ENOENT: no such file or directory` with null byte in path (non-fatal)                      |
| 2026-04-07T17:24:35Z | **FALSE POSITIVE #1**: `"type": "error"` emitted for "verbose HTTP logging active" (chat/completions endpoint) |
| 2026-04-07T17:24:35Z | **FALSE POSITIVE #2**: `"type": "error"` emitted for "verbose HTTP logging active" (messages endpoint)         |
| 2026-04-07T17:24:35Z | Provider sends request to `https://opencode.ai/zen/v1/messages`                                                |
| 2026-04-07T17:24:41Z | Provider returns zero tokens with unknown finish reason (the actual error)                                     |
| 2026-04-07T17:24:41Z | Agent exits with `hasError: false`, exit code 0, uptime 7 seconds                                              |
| 2026-04-07T17:24:41Z | `solve.mjs` reports: "Agent reported error: [verbose] HTTP logging active for provider: opencode"              |

## Root Cause Analysis

### Problem 1: Agent CLI Emits Verbose Logs as Error Events (Agent CLI Bug)

The Agent CLI wraps verbose logging messages in `"type": "error"` JSON events:

```json
{
  "type": "error",
  "errorType": "RuntimeError",
  "message": "[verbose] HTTP logging active for provider: opencode"
}
```

This is not a real error -- it's an informational message about HTTP logging being enabled in verbose mode. However, because it uses `"type": "error"`, Hive Mind's error detection treats it as a genuine error.

**Evidence from log (lines 1258-1261):**

```
{
  "type": "error",
  "errorType": "RuntimeError",
  "message": "[verbose] HTTP logging active for provider: opencode"
}
```

The same message appears twice (once for the chat/completions endpoint, once for the messages endpoint).

### Problem 2: Hive Mind False Positive Error Detection (Hive Mind Bug)

The error detection in `src/agent.lib.mjs` has two layers that both trigger on these verbose messages:

1. **Streaming detection (line 647):** `data.type === 'error'` catches the verbose log event and sets `streamingErrorDetected = true`.

2. **Post-hoc detection (line 791):** `detectAgentErrors()` also catches it and returns `{detected: true}`.

The recovery logic at line 810 only clears streaming errors when `agentCompletedSuccessfully` is true (requires `session.idle` or `step_finish` with `reason: "stop"`). In this case, the agent fails before reaching those events due to the zero-tokens error, so the false positive error is never cleared.

The agent's own exit log at line 2690 confirms `"hasError": false`, but Hive Mind ignores this field.

### Problem 3: Zero Tokens with Unknown Finish Reason (Provider/Model Issue)

The actual failure is that the OpenCode provider returned zero tokens:

```json
{
  "finishReason": "unknown",
  "tokens": { "input": 0, "output": 0, "reasoning": 0 },
  "message": "Provider returned zero tokens with unknown finish reason. Requested model: unknown (provider: unknown). Responded model: unknown."
}
```

This is a known issue (linked to `https://github.com/link-assistant/agent/issues/198`). The model/provider fields all show "unknown", suggesting the provider didn't properly process the request.

### Problem 4: Migration Path Contains Null Byte (Agent CLI Bug)

During startup, the Agent CLI fails a migration with a null byte in the file path:

```
"error": {
  "name": "Error",
  "message": "ENOENT: no such file or directory, open '/workspace/.local/share/link-assistant-agent/project\u0000'"
}
```

The trailing `\0` (null byte) in the path suggests a buffer handling bug in the storage/migration code. This error is non-fatal but indicates a code defect.

## Proposed Solutions

### Fix 1: Filter Non-Error Events in Hive Mind (This PR)

In `src/agent.lib.mjs`, add filtering logic to `detectAgentErrors()` and the streaming detection to skip error events that are clearly informational verbose messages:

- Skip events where `message` starts with `"[verbose]"`
- Skip events with `errorType: "RuntimeError"` when the message is a verbose log
- Use the agent's own `hasError` field from the exit log as an additional signal

### Fix 2: Report Agent CLI Issues (Separate Issues)

Two issues should be filed against `link-assistant/agent`:

1. **Verbose logs emitted as error events**: The Agent CLI should use `"type": "log"` with `"level": "debug"` or `"level": "info"` for verbose HTTP logging messages, not `"type": "error"`.

2. **Null byte in migration path**: The storage migration code has a buffer handling bug producing paths with trailing null bytes.

## Files Involved

| File                                              | Role                               |
| ------------------------------------------------- | ---------------------------------- |
| `src/agent.lib.mjs` (lines 647, 781-801, 810-826) | Error detection and recovery logic |
| `tests/test-agent-error-detection.mjs`            | Error detection test suite         |

## References

- Issue: https://github.com/link-assistant/hive-mind/issues/1541
- Log: `solution-draft-log-pr-1775582682883.txt` (in this directory)
- Related agent issue: https://github.com/link-assistant/agent/issues/198
