# Case Study: Issue #1337 - False Positive Error Detection

## Executive Summary

**Issue:** [#1337 - False positive error detection](https://github.com/link-assistant/hive-mind/issues/1337)

**Status:** Fixed

**Root Cause:** The stderr error detection logic in `src/claude.lib.mjs` only recognizes emoji-prefixed warnings (`⚠️`). When Claude Code emits structured JSON log messages (format: `{"level":"warn","message":"..."}`) to stderr, the code fails to identify them as warnings. If the JSON message contains error-related keywords ("failed", "error", "not found"), the message is incorrectly added to `stderrErrors`, triggering a false positive failure.

**Impact:**

1. Legitimate solve sessions flagged as failures when Claude Code emits slow pre-flight warnings
2. PR logs attach "failure" outcome when the actual execution succeeded
3. Wasted retries and time due to phantom failures

---

## The Failing Scenario

The user observed:

```
❌ Command failed: No messages processed and errors detected in stderr
Stderr errors:
   {"level":"warn","message":"[BashTool] Pre-flight check is taking longer than expected. Run with ANTHROPIC_LOG=debug to check for failed or slow API requests."}
```

The stderr message is a **warning**, not an error. However, the system treated it as an error because:

1. The message contains the word **"failed"** (in "check for **failed** or slow API requests")
2. The message does NOT start with `⚠️` emoji (it's a JSON structured log)
3. The detection logic only checks for `⚠️` prefix to identify warnings

---

## Timeline of Events

| Step | What Happened                                                                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `solve.mjs` spawned Claude Code CLI                                                                                                                       |
| 2    | Claude Code CLI began BashTool pre-flight check (Haiku API call for bash prefix detection)                                                                |
| 3    | Pre-flight check took > 10 seconds (slow API or VM networking)                                                                                            |
| 4    | Claude Code SDK emitted a structured JSON warning to stderr: `{"level":"warn","message":"[BashTool] Pre-flight check is taking longer than expected..."}` |
| 5    | `claude.lib.mjs` received the stderr chunk                                                                                                                |
| 6    | Trimmed the message → does NOT start with `⚠️`                                                                                                            |
| 7    | Checked for error keywords → found "**failed**" in the message text                                                                                       |
| 8    | Added to `stderrErrors` array ← **BUG HERE**                                                                                                              |
| 9    | Claude Code produced no messages before completing (pre-flight delay meant no actual output)                                                              |
| 10   | `messageCount === 0 && toolUseCount === 0 && stderrErrors.length > 0` → triggered "Command failed"                                                        |
| 11   | False positive failure reported                                                                                                                           |

---

## Root Cause Analysis

### Primary Root Cause: Missing JSON-structured warning detection

**File:** `src/claude.lib.mjs`, lines 1069–1078

**Current Code:**

```javascript
const trimmed = errorOutput.trim();
// Exclude warnings (messages starting with ⚠️) from being treated as errors
// Example: "⚠️  [BashTool] Pre-flight check is taking longer than expected..."
const isWarning = trimmed.startsWith('⚠️') || trimmed.startsWith('⚠');
// Issue #1165: Also detect "command not found" errors
if (trimmed && !isWarning && (trimmed.includes('Error:') || trimmed.includes('error') || trimmed.includes('failed') || trimmed.includes('not found'))) {
  stderrErrors.push(trimmed);
}
```

**Problem:** The `isWarning` check ONLY recognizes `⚠️` emoji-prefixed messages. The Claude Code SDK and its Anthropic SDK dependency can emit JSON-structured log messages with format:

```json
{ "level": "warn", "message": "[BashTool] Pre-flight check is taking longer than expected. Run with ANTHROPIC_LOG=debug to check for failed or slow API requests." }
```

When this message is processed:

- `trimmed.startsWith('⚠️')` → `false` (starts with `{`)
- `trimmed.includes('failed')` → `true` (appears in the message text)
- Result: Added to `stderrErrors` → **false positive**

### Secondary Issue: ANTHROPIC_LOG=debug not enabled in verbose mode

The warning message itself suggests:

> "Run with ANTHROPIC_LOG=debug to check for failed or slow API requests."

Currently, `--verbose` mode does NOT set `ANTHROPIC_LOG=debug`. This means users who run with `--verbose` still don't get the detailed API request logs that would help diagnose slow API calls.

---

## Evidence

### Confirmed with Experiment

Running `experiments/test-issue-1337-json-warning.mjs`:

```
❌ FALSE POSITIVE: JSON warn format - BashTool pre-flight warning (THE ISSUE #1337)
   Message: "{"level":"warn","message":"[BashTool] Pre-flight check is taking longer than expected..."}"
   Expected: NOT error, Detected: IS error

❌ FALSE POSITIVE: JSON warn format with "error" in message (should be warn, NOT error)
   Message: "{"level":"warn","message":"Possible error-like condition detected, but not critical"}"
   Expected: NOT error, Detected: IS error

❌ FALSE POSITIVE: JSON warn with "not found" in message (should be warn)
   Message: "{"level":"warn","message":"Some resource not found but non-critical"}"
   Expected: NOT error, Detected: IS error

Current behavior: 3 false positives, 0 false negatives

❌ ISSUE #1337 CONFIRMED: JSON-format warnings are incorrectly treated as errors!
```

### Source of JSON-Format Warnings

The JSON format originates from the Anthropic TypeScript SDK's structured logging when `ANTHROPIC_LOG` environment variable or `DEBUG` is set. The SDK uses a logger interface that can output structured JSON:

- [Issue #157 in claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript/issues/157): ANTHROPIC_LOG=debug corrupts SDK protocol — debug logs should go to stderr
- [Issue #4859 in anthropics/claude-code](https://github.com/anthropics/claude-code/issues/4859): code CLI debug and verbose modes do not output to stderr
- [Issue #2294 in anthropics/claude-code](https://github.com/anthropics/claude-code/issues/2294): Excessive API debug logs appearing in terminal output
- [Issue #25025 in anthropics/claude-code](https://github.com/anthropics/claude-code/issues/25025): [BUG] [BashTool] Pre-flight check console.warn corrupts JSON output

The BashTool pre-flight check timeout is 10 seconds. When the Haiku API call for bash command prefix detection exceeds 10 seconds (e.g., slow network, VM/gvisor networking, API latency), Claude Code emits a warning. This warning appears in two formats depending on the Claude Code version and logging configuration:

1. **Emoji format** (handled): `⚠️  [BashTool] Pre-flight check is taking longer than expected...`
2. **JSON format** (NOT handled — this issue): `{"level":"warn","message":"[BashTool] Pre-flight check..."}`

---

## Proposed Solutions

### Solution 1 (Implemented): Parse JSON-structured stderr messages

When a stderr message is valid JSON with a `"level"` field:

- If level is `"warn"`, `"info"`, or `"debug"` → treat as non-error (isWarning = true)
- If level is `"error"` or `"fatal"` → treat as error
- If JSON parse fails → fall back to existing keyword matching

**Code change at lines 1069–1078 of `src/claude.lib.mjs`:**

```javascript
const trimmed = errorOutput.trim();
// Exclude warnings from being treated as errors.
// Detection 1: Emoji-prefixed warnings (existing)
// Example: "⚠️  [BashTool] Pre-flight check is taking longer than expected..."
// Detection 2: JSON-structured log messages (Issue #1337)
// Example: {"level":"warn","message":"[BashTool] Pre-flight check..."}
let isWarning = trimmed.startsWith('⚠️') || trimmed.startsWith('⚠');
if (!isWarning && trimmed.startsWith('{')) {
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed.level === 'string') {
      const level = parsed.level.toLowerCase();
      // Only "error" and "fatal" levels should be treated as errors
      // "warn", "warning", "info", "debug", "trace" are non-error levels
      if (level !== 'error' && level !== 'fatal') {
        isWarning = true;
      }
    }
  } catch {
    // Not valid JSON — fall through to keyword matching
  }
}
if (trimmed && !isWarning && (trimmed.includes('Error:') || trimmed.includes('error') || trimmed.includes('failed') || trimmed.includes('not found'))) {
  stderrErrors.push(trimmed);
}
```

### Solution 2 (Implemented): Enable ANTHROPIC_LOG=debug in --verbose mode

In `getClaudeEnv()` in `src/config.lib.mjs`, add `ANTHROPIC_LOG: 'debug'` when the verbose flag is set.

Or in `src/claude.lib.mjs`, conditionally add to `claudeEnv`:

```javascript
if (argv.verbose) {
  claudeEnv.ANTHROPIC_LOG = 'debug';
}
```

---

## Related Issues

- [Issue #477](https://github.com/link-assistant/hive-mind/issues/477): Original warning detection for emoji-prefixed BashTool warnings
- [Issue #873](https://github.com/link-assistant/hive-mind/issues/873): Phantom error detection for `--tool agent`
- [Issue #886](https://github.com/link-assistant/hive-mind/issues/886): False positive error detection for `--agent tool`
- [Issue #1276](https://github.com/link-assistant/hive-mind/issues/1276): False positive error detection when agent recovers

## External References

- [anthropics/claude-code #25025](https://github.com/anthropics/claude-code/issues/25025): BashTool pre-flight check console.warn corrupts JSON output
- [anthropics/claude-code #4859](https://github.com/anthropics/claude-code/issues/4859): code CLI debug and verbose modes do not output to stderr
- [anthropics/claude-agent-sdk-typescript #157](https://github.com/anthropics/claude-agent-sdk-typescript/issues/157): ANTHROPIC_LOG=debug corrupts SDK protocol - debug logs should go to stderr
