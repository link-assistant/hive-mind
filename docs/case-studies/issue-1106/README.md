# Case Study: Issue #1106

## Error: `error_during_execution` - `only prompt commands are supported in streaming mode`

**Date:** 2026-01-11 (Updated: 2026-01-16)
**Status:** Analysis Complete - Fix Available
**Related Bug Reports:**

- [claude-code#16768](https://github.com/anthropics/claude-code/issues/16768) - **FIXED in v2.1.7** - Spurious error_during_execution after background task
- [claude-code#17406](https://github.com/anthropics/claude-code/issues/17406) - **OPEN** - Mid-execution input fails with `--model haiku`
- [claude-code#8126](https://github.com/anthropics/claude-code/issues/8126) - Missing result in stream-json
- [claude-code#5034](https://github.com/anthropics/claude-code/issues/5034) - Duplicate entries in session files

---

## Executive Summary

This case study investigates a recurring error pattern where Claude Code CLI emits **two consecutive `result` events** at the end of a session:

1. First result: `subtype: "success"` - Normal completion with full statistics
2. Second result: `subtype: "error_during_execution"` - Error with message "only prompt commands are supported in streaming mode"

**Key Finding:** This bug was **FIXED in Claude Code CLI v2.1.7** ([#16768](https://github.com/anthropics/claude-code/issues/16768)). Updating the CLI to v2.1.7 or later should resolve this issue.

The error was a **bug in Claude Code CLI's streaming mode** rather than an issue with the hive-mind integration. Despite the error message, the actual work was completed successfully in all observed cases.

---

## Timeline of Events

### Affected Sessions

| PR                                                              | Timestamp            | Session ID                           | First Result       | Second Result                    |
| --------------------------------------------------------------- | -------------------- | ------------------------------------ | ------------------ | -------------------------------- |
| [#585](https://github.com/VisageDvachevsky/StoryGraph/pull/585) | 2026-01-11T03:14:20Z | 064e3157-c2b3-4cec-a7b3-e2b64741c012 | success (72 turns) | error_during_execution (0 turns) |
| [#588](https://github.com/VisageDvachevsky/StoryGraph/pull/588) | 2026-01-11T03:12:17Z | 5fcc0441-5e26-419b-8541-d7a66bf0fb2e | success            | error_during_execution (0 turns) |
| [#591](https://github.com/VisageDvachevsky/StoryGraph/pull/591) | 2026-01-11T03:16:03Z | d3e1fd0d-377a-4cde-97b4-9a21fb4cadf8 | success            | error_during_execution (0 turns) |
| [#594](https://github.com/VisageDvachevsky/StoryGraph/pull/594) | 2026-01-11T03:19:25Z | da9ffea7-e88a-42bc-afcc-b5e877e74949 | success            | error_during_execution (0 turns) |

### Sequence of Events (per session)

```
1. Session starts with claude CLI invocation
   └── --output-format stream-json --verbose --dangerously-skip-permissions --model sonnet

2. Claude executes task successfully over 72+ turns
   └── Commits code, runs tests, updates PR

3. First result event emitted
   └── type: "result", subtype: "success"
   └── num_turns: 72, duration_ms: ~1,400,000
   └── total_cost_usd: $2.075+
   └── Contains full usage statistics and model breakdown

4. IMMEDIATELY AFTER (within 2ms)
   └── Second result event emitted
   └── type: "result", subtype: "error_during_execution"
   └── num_turns: 0, duration_ms: 0, total_cost_usd: 0
   └── errors: ["only prompt commands are supported in streaming mode"]

5. hive-mind detects error_during_execution flag
   └── Reports: "Claude command finished with errors"
   └── But work was actually completed successfully
```

---

## Root Cause Analysis

### Hypothesis 1: Duplicate Session Command (REJECTED)

Initially suspected that hive-mind might be sending a second command after the first completes. However:

- Only ONE claude process is spawned per session
- The second result has `num_turns: 0` and `duration_ms: 0` - impossible for a separate command
- The `session_id` is identical for both results

### Hypothesis 2: Claude Code CLI Internal Bug (CONFIRMED)

This was confirmed as an internal Claude Code CLI bug and has been **FIXED in v2.1.7**.

**Evidence:**

1. **Pattern Consistency**: The error occurs in 100% of analyzed sessions with identical characteristics
2. **Zero-Duration Second Result**: The second result has:
   - `num_turns: 0`
   - `duration_ms: 0`
   - `duration_api_ms: 0`
   - `total_cost_usd: 0`
   - Empty `usage` statistics
3. **Same Session ID**: Both results share the same `session_id`, indicating they're from the same CLI process

**Root Cause** (from [#16768](https://github.com/anthropics/claude-code/issues/16768)):

- Task completion enqueues a command with `mode: "task-notification"`
- Streaming mode handler only accepts `mode: "prompt"` or `mode: "orphaned-permission"`
- When background tasks complete, they try to notify but the streaming mode throws the error

**Related Known Bugs**:

- [Issue #16768](https://github.com/anthropics/claude-code/issues/16768): **FIXED in v2.1.7** - Spurious error_during_execution after background task
- [Issue #17406](https://github.com/anthropics/claude-code/issues/17406): **OPEN** - Similar error with `--model haiku` during mid-execution input
- [Issue #8126](https://github.com/anthropics/claude-code/issues/8126): Missing result in stream-json (39.5% failure rate reported)
- [Issue #5034](https://github.com/anthropics/claude-code/issues/5034): Duplicate entries in session files

### Hypothesis 3: Streaming Mode Limitation

The error message "only prompt commands are supported in streaming mode" suggests:

- The CLI might be attempting to perform a non-prompt operation after the session completes
- This could be related to session cleanup, telemetry, or internal state management
- According to Anthropic documentation, streaming mode has specific limitations:
  - No support for session management commands during streaming
  - Some operations are only valid in single-message mode

---

## Technical Details

### Affected Configuration

```javascript
// hive-mind invocation pattern
execCommand = $({
  cwd: tempDir,
  stdin: prompt,
  mirror: false,
  env: claudeEnv,
})`${claudePath} --output-format stream-json --verbose --dangerously-skip-permissions --model ${mappedModel} --append-system-prompt "${systemPrompt}"`;
```

### Error Event Structure

```json
{
  "type": "result",
  "subtype": "error_during_execution",
  "duration_ms": 0,
  "duration_api_ms": 0,
  "is_error": true,
  "num_turns": 0,
  "session_id": "064e3157-c2b3-4cec-a7b3-e2b64741c012",
  "total_cost_usd": 0,
  "usage": {
    "input_tokens": 0,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "output_tokens": 0,
    "server_tool_use": { "web_search_requests": 0, "web_fetch_requests": 0 },
    "service_tier": "standard"
  },
  "modelUsage": {},
  "permission_denials": [],
  "errors": ["only prompt commands are supported in streaming mode"]
}
```

### Additional Errors (in some sessions)

Some sessions showed additional error messages:

- `AxiosError: timeout of 5000ms exceeded` - Network timeout during cleanup
- `1P event logging: 99 events failed to export` - Telemetry export failure
- `Failed to export 99 events` - Event export failure

These suggest the error occurs during CLI cleanup/shutdown phase when attempting non-prompt operations.

---

## Impact Assessment

### Severity: LOW

Despite the error message:

- All code changes were successfully committed and pushed
- All PRs were created/updated correctly
- CI pipelines ran as expected
- No data loss occurred

### User Experience Impact

- Confusing "finished with errors" message when work was actually successful
- Unnecessary error notifications in logs and PR comments
- May cause users to incorrectly believe the session failed

---

## Proposed Solutions

### Solution 0: Update Claude Code CLI (RECOMMENDED)

**This is the simplest and most effective solution.**

The bug was fixed in Claude Code CLI v2.1.7. To resolve this issue:

```bash
# Update Claude Code CLI to the latest version
npm update -g @anthropic/claude-code

# Verify version is 2.1.7 or later
claude --version
```

**Version History:**

| Version | Status                                    |
| ------- | ----------------------------------------- |
| 2.0.76  | Working (last working version before bug) |
| 2.1.1   | Affected (bug introduced)                 |
| 2.1.2   | Still affected                            |
| 2.1.7   | **FIXED**                                 |

**Note:** Issue [#17406](https://github.com/anthropics/claude-code/issues/17406) reports a similar error specifically with `--model haiku` that may still occur. If you encounter this error only when using Haiku model, this is a separate issue.

### Solution 1: Improve Error Detection in hive-mind (FALLBACK)

Modify the error detection logic to recognize this specific pattern:

```javascript
// In claude.lib.mjs, after detecting error_during_execution
if (data.type === 'result') {
  // Check if this is the "ghost" error that follows a success
  if (data.subtype === 'error_during_execution' &&
      data.num_turns === 0 &&
      data.duration_ms === 0 &&
      previousResultWasSuccess) {
    // This is the spurious second result - ignore it
    await log('⚠️ Ignoring spurious error result (known Claude CLI bug)', { verbose: true });
    continue;
  }
}
```

### Solution 2: Track First Success Result

Track when a success result is received and ignore subsequent error results with zero duration:

```javascript
let sessionCompletedSuccessfully = false;

if (data.type === 'result' && data.subtype === 'success' && !data.is_error) {
  sessionCompletedSuccessfully = true;
}

// Later, when processing error results:
if (data.subtype === 'error_during_execution' && sessionCompletedSuccessfully) {
  // Work was already completed - this is a post-completion cleanup error
  errorDuringExecution = false; // Override the flag
}
```

### Solution 3: Report Bug to Anthropic

File a bug report with Anthropic for the Claude Code CLI with:

- Detailed reproduction steps
- Log files demonstrating the issue
- Link to existing related issues (#8126, #5034)

---

## Workaround (Current)

The current hive-mind implementation partially handles this by:

1. Treating `error_during_execution` differently from true failures
2. Marking the session as "finished with errors" rather than "failed"
3. Still processing the successful result's statistics

However, the warning message is misleading and could be improved.

---

## Log Files

The following log files are preserved in this directory for reference:

- `logs/pr-585-log.txt` (666KB) - Session 064e3157-c2b3-4cec-a7b3-e2b64741c012
- `logs/pr-588-log.txt` (695KB) - Session 5fcc0441-5e26-419b-8541-d7a66bf0fb2e
- `logs/pr-591-log.txt` (676KB) - Session d3e1fd0d-377a-4cde-97b4-9a21fb4cadf8
- `logs/pr-594-log.txt` (919KB) - Session da9ffea7-e88a-42bc-afcc-b5e877e74949

---

## References

### External Documentation

- [Claude Agent SDK - Streaming vs Single Mode](https://platform.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)
- [Claude Agent SDK - Session Management](https://platform.claude.com/docs/en/agent-sdk/sessions)
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference)

### Related GitHub Issues

- [anthropics/claude-code#16768](https://github.com/anthropics/claude-code/issues/16768) - **FIXED in v2.1.7** - Spurious error_during_execution after background task
- [anthropics/claude-code#17406](https://github.com/anthropics/claude-code/issues/17406) - **OPEN** - Mid-execution input fails with `--model haiku`
- [anthropics/claude-code#8126](https://github.com/anthropics/claude-code/issues/8126) - Missing result in stream-json
- [anthropics/claude-code#5034](https://github.com/anthropics/claude-code/issues/5034) - Duplicate entries in session files
- [anthropics/claude-code#3188](https://github.com/anthropics/claude-code/issues/3188) - Resume bug

### Internal Files

- `src/claude.lib.mjs` - Claude CLI execution logic
- `src/interactive-mode.lib.mjs` - Real-time PR comment posting
- `src/solve.auto-continue.lib.mjs` - Session continuation logic

---

## Conclusion

The error "only prompt commands are supported in streaming mode" was a **Claude Code CLI bug** ([#16768](https://github.com/anthropics/claude-code/issues/16768)) that emits a spurious error result after a successful session completion. The error had zero impact on actual functionality but created confusing output.

**Resolution**: This bug was **FIXED in Claude Code CLI v2.1.7**. Updating the CLI to this version or later will resolve the issue.

**Recommended Action**: Update Claude Code CLI to v2.1.7 or later:

```bash
npm update -g @anthropic/claude-code
```

**Note**: A related but distinct issue ([#17406](https://github.com/anthropics/claude-code/issues/17406)) may still cause similar errors when using `--model haiku` specifically. This is a separate bug that remains open.
