# Case Study: Issue #1354 — False Positive Error Detection for `--tool claude`

## Overview

**Issue:** [#1354 — We have false positive for error detection of `--tool claude`](https://github.com/link-assistant/hive-mind/issues/1354)
**Status:** Resolved
**Component:** `src/claude.lib.mjs` — `isStderrError()` and stderr chunk processing

## Evidence

- [Log 1: solution-draft-log-pr-1771856757692.txt](./solution-draft-log-pr-1771856757692.txt) — Run solving VermenkoLev/facer#17 (26,376 lines, ~73 turns)
- [Log 2: solution-draft-log-pr-1771858206355.txt](./solution-draft-log-pr-1771858206355.txt) — Run solving VermenkoLev/facer#21 (18,807 lines, ~60 turns)

## Timeline / Sequence of Events

Both logs follow the same pattern:

```
[14:25:56.279Z] [INFO]  ✅ Stream closed normally after result event
[14:25:56.280Z] [ERROR] ❌ Command failed: No messages processed and errors detected in stderr
                         Stderr errors:
                           {"level":"warn","message":"[BashTool] Pre-flight check is taking longer than expected..."}
                         {"level":"warn","message":"[BashTool] Pr
```

### Detailed sequence:

1. Claude CLI is started with `--verbose` flag → causes `ANTHROPIC_LOG=debug` to be set in the environment (`claude.lib.mjs:893-896`)
2. Claude CLI processes the issue normally (60-73 turns, successful result)
3. During execution, Claude CLI emits JSON-format log lines to stderr: `{"level":"warn","message":"[BashTool] Pre-flight check is taking longer than expected. Run with ANTHROPIC_LOG=debug to check for failed or slow API requests."}`
4. **Bug**: These stderr lines arrive as a **multi-line chunk** (two JSON lines concatenated with `\n`)
5. The entire multi-line chunk is passed to `isStderrError()` as one string
6. `isStderrError()` sees the string starts with `{`, tries `JSON.parse()` on the **entire multi-line chunk** — this fails (multi-line is not valid single JSON)
7. Falls through to keyword matching: the string contains `"failed"` → returns `true`
8. `stderrErrors.push(errorOutput.trim())` adds the warning to the error list
9. After stream close: `messageCount === 0` (counter never incremented — see Root Cause 2 below)
10. Condition `!commandFailed && stderrErrors.length > 0 && messageCount === 0 && toolUseCount === 0` is true
11. **False positive**: `❌ Command failed: No messages processed and errors detected in stderr`

## Root Cause Analysis

### Root Cause 1: Multi-line stderr chunks not split before error detection

**Location:** `src/claude.lib.mjs:1112-1121`

```javascript
if (chunk.type === 'stderr') {
  const errorOutput = chunk.data.toString();
  if (errorOutput) {
    await log(errorOutput, { stream: 'stderr' });
    // BUG: errorOutput may contain multiple newline-separated JSON lines
    if (isStderrError(errorOutput)) {
      stderrErrors.push(errorOutput.trim());
    }
  }
}
```

When `errorOutput` contains two JSON lines like:

```
{"level":"warn","message":"[BashTool] Pre-flight check..."}
{"level":"warn","message":"[BashTool] Pre-flight check..."}
```

The `isStderrError()` function receives the entire string. It checks `trimmed.startsWith('{')` → true, then tries `JSON.parse(trimmed)` → **fails** (two JSON objects concatenated is not valid JSON). Falls through to keyword search: finds `"failed"` in the text → returns `true` (false positive).

### Root Cause 2: `messageCount` never incremented for `"assistant"` event type

**Location:** `src/claude.lib.mjs:1004-1008`

```javascript
if (data.type === 'message') {
  messageCount++;
} else if (data.type === 'tool_use') {
  toolUseCount++;
}
```

Claude CLI emits outer events with `"type": "assistant"`, not `"type": "message"`. The `"message"` type appears only in the nested `data.message` object. Therefore `messageCount` is always 0, even for 60-turn successful sessions.

The condition `messageCount === 0` is never false, making any stderr content a potential false positive trigger.

### Root Cause 3: No guard for successful `result` event

The false positive check at line 1258 does not account for the fact that a successful `result` event (`subtype === 'success'`) was already received and logged. A successful result should be definitive proof that the command succeeded, regardless of `messageCount` and `stderrErrors`.

## The BashTool Pre-flight Warning

The `[BashTool] Pre-flight check is taking longer than expected. Run with ANTHROPIC_LOG=debug to check for failed or slow API requests.` warning is emitted by the Claude CLI's BashTool when its pre-execution API validation takes more than a few seconds. This is:

- **Not an error** — it's a performance warning
- **Not a failure** — the BashTool command runs successfully after the delay
- **Level: `warn`** — correctly classified by the SDK but not by our multi-line chunk parsing

This warning was previously handled correctly when received as a single-line chunk (the `isStderrError` function correctly identifies `{"level":"warn",...}` as non-error). The bug only manifests when two such warnings are delivered in a single stderr chunk.

## Why Warnings Should Never Be Treated As Errors

The issue title states: "Warnings should not be treated as errors ever." This is a sound principle:

1. The Claude SDK explicitly classifies log levels: `debug`, `info`, `warn`, `error`, `fatal`
2. Only `error` and `fatal` levels indicate actual failures requiring intervention
3. `warn` level indicates a potential issue that is being handled gracefully
4. Treating `warn` as `error` causes false failures, preventing successful work from being committed

## Proposed Solutions

### Solution 1 (Implemented): Split multi-line stderr chunks line-by-line

In `src/claude.lib.mjs`, split `errorOutput` by newlines before checking each line:

```javascript
if (chunk.type === 'stderr') {
  const errorOutput = chunk.data.toString();
  if (errorOutput) {
    await log(errorOutput, { stream: 'stderr' });
    // Split multi-line chunks to check each line individually (Issue #1354)
    // A single stderr chunk may contain multiple newline-separated JSON messages.
    // Checking the whole chunk fails JSON.parse() and falls through to keyword matching.
    const stderrLines = errorOutput.split('\n');
    for (const line of stderrLines) {
      if (isStderrError(line)) {
        stderrErrors.push(line.trim());
      }
    }
  }
}
```

### Solution 2 (Implemented): Guard against false positive when result event succeeded

Add a check: if a successful `result` event was already received, skip the "No messages processed" false positive detection:

```javascript
// Issue #1354: Do not trigger this check if the result event already confirmed success.
// A successful result event is definitive proof the command succeeded.
if (!commandFailed && !resultSuccessReceived && stderrErrors.length > 0 && messageCount === 0 && toolUseCount === 0) {
  // ... error handling
}
```

### Solution 3 (Alternative): Fix `messageCount` to count `assistant` events

Change `data.type === 'message'` to `data.type === 'assistant'` so `messageCount` is incremented for actual Claude turns. This makes the condition `messageCount === 0` truly meaningful.

## Related Issues

- **Issue #477**: Emoji-prefixed warnings (`⚠️`) excluded from stderr error detection
- **Issue #1165**: `"command not found"` (exit code 127) detection via stderr
- **Issue #1337**: JSON-structured SDK warnings with non-error level excluded from stderr error detection

## External Reports

The `[BashTool] Pre-flight check is taking longer than expected` warning comes from the Claude Code CLI (npm package `@anthropic-ai/claude-code`). This is a known warning when Claude Code's BashTool pre-execution API health check takes longer than expected. It does not indicate a failure.

Related upstream issue that could be filed: [anthropics/claude-code](https://github.com/anthropics/claude-code) — "BashTool pre-flight warning emitted to stderr even when command succeeds, causing false positive error detection in wrapper tools"
