# Case Study: Issue #1151 - `--tool agent` does not work

## Issue Summary

**Issue URL:** https://github.com/link-assistant/hive-mind/issues/1151
**Related PR:** https://github.com/link-assistant/hive-mind/pull/1163
**Date:** 2026-01-21 to 2026-01-23

## Problem Description

When using `solve.mjs --tool agent`, the agent would fail with a ZodError related to parsing the finish response. The issue manifested as:

1. Agent command starts successfully
2. Agent executes tool calls (e.g., `gh issue view`)
3. After receiving the AI response, a ZodError is thrown
4. The command exits with error but reports "✅ Agent command completed" (false positive)

### Error Log

```json
{
  "type": "error",
  "timestamp": 1769000874230,
  "sessionID": "ses_41f54ed82ffegmIi5d4WGNrEjs",
  "error": {
    "name": "UnknownError",
    "data": {
      "message": "[{\"code\": \"invalid_union\", \"errors\": [{\"expected\": \"string\", \"code\": \"invalid_type\", \"path\": [\"reason\"], \"message\": \"Invalid input: expected string, received object\"}...]"
    }
  }
}
```

```
ZodError: [{
  "expected": "string",
  "code": "invalid_type",
  "path": ["finish"],
  "message": "Invalid input: expected string, received object"
}]
```

## Root Cause Analysis

### Primary Cause: @link-assistant/agent Bug

The issue was **NOT** in hive-mind's `solve.mjs` but in the `@link-assistant/agent` package itself.

**Problem:** When using newer versions of Bun (1.3.6+) with AI SDK 6.0.0-beta.99, the SDK returns:
- Token counts as objects: `{ total: 8707, noCache: 6339, cacheRead: 2368 }` instead of numbers
- finishReason as objects: `{ type: "stop" }` instead of strings

This caused ZodError crashes because the `@link-assistant/agent` code expected primitives (strings/numbers).

### Secondary Issue: --verbose Flag Not Working

The issue also mentioned that `--verbose` option on the `agent` command didn't work when executed through hive-mind. However, when running the same command directly, verbose logs were visible.

From the issue:
```bash
# Direct execution - verbose works
(cd "/tmp/gh-issue-solver-1769000822352" && cat "/tmp/agent_prompt_1769000865749_678166.txt" | agent --model opencode/grok-code --verbose)
```

This is because hive-mind's `agent.lib.mjs` captures stdout/stderr differently than direct terminal execution.

## Timeline

| Date | Event |
|------|-------|
| 2026-01-21T13:06:50Z | Original issue observed (agent v0.8.5) |
| 2026-01-21T15:50:58Z | Agent v0.8.5 released (bug present) |
| 2026-01-21T16:17:09Z | Fix committed to agent repo |
| 2026-01-21T18:36:41Z | PR #126 merged in agent repo |
| 2026-01-21T18:39:16Z | Agent v0.8.6 released (fix included) |
| 2026-01-22T15:26:40Z | Agent v0.8.7 released |
| 2026-01-22T19:11:55Z | Agent v0.8.9 released (current latest) |

## Fix Applied

The fix was applied in the `@link-assistant/agent` repository:

**PR:** https://github.com/link-assistant/agent/pull/126

**Changes:**
1. Enhanced `toNumber()` function to handle objects with `total` field
2. Added new `toFinishReason()` function to safely convert object/string finishReason values to string
3. Updated `processor.ts` to use the new `toFinishReason()` function
4. Added comprehensive tests covering edge cases

## Resolution for hive-mind

### Recommended Solution

Users experiencing this issue should upgrade their `@link-assistant/agent` package:

```bash
bun install -g @link-assistant/agent@latest
```

Or specifically:
```bash
bun install -g @link-assistant/agent@0.8.9
```

### Verification

After upgrading, verify the agent version:
```bash
agent --version
```

Expected output: `0.8.6` or higher

### Documentation Update

This case study serves as documentation for future reference when similar issues occur with the `--tool agent` option.

## Lessons Learned

1. **Error Detection:** The hive-mind code marked the command as successful even when agent output contained errors. This was addressed in issue #867 and #886 with improved error detection.

2. **Dependency Management:** External tool dependencies (`@link-assistant/agent`) can have bugs that affect hive-mind functionality. Version pinning or better error messaging could help.

3. **Verbose Mode Propagation:** When running CLI tools through child processes, verbose/debug flags may not produce visible output unless properly handled by the stream processing code.

## Related Issues and PRs

- **hive-mind:**
  - Issue #1151: `--tool agent` does not work
  - Issue #867: agent error not treated as error
  - Issue #886: false positive error detection

- **@link-assistant/agent:**
  - Issue #125: ZodError on Ubuntu with Bun 1.3.6+
  - PR #126: fix: handle object types for token counts and finishReason

## Files

- `evidence/gristwidgets-pr9-comment.txt` - Original error log from veb86/GristWidgets#9
