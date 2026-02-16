# Issue #1313: Wrong Tokens Calculation - Case Study

## Problem Statement

This issue reported that token usage was showing "0 input, 0 output" in PR comments despite the solution draft log showing many `step_finish` events with actual token data.

**Example from the issue:**

From the log:
```json
"tokens": {
  "input": 406,
  "output": 353,
  "reasoning": 281,
  "cache": {
    "read": 33880,
    "write": 0
  }
}
```

But the PR comment showed:
```
Token usage: 0 input, 0 output
```

## Timeline of Events

| Timestamp | Event |
|-----------|-------|
| 2026-02-11 | Issue #1250 fixed (commit 82911f58) - implemented streaming token accumulation |
| 2026-02-13 11:26:11 | Solution draft executed with solve v1.21.4 (before the fix) |
| 2026-02-13 11:31:38 | PR comment posted showing "0 input, 0 output" |
| 2026-02-13 | Issue #1313 filed reporting the bug |
| 2026-02-16 | Current version 1.23.11 (includes the fix) |

## Root Cause Analysis

### Investigation Steps

1. **Downloaded the full solution draft log** from the gist linked in the issue
2. **Found 46 `step_finish` events** in the log, each containing valid token data
3. **Analyzed the code path** from agent execution to PR comment generation
4. **Identified the issue version** - solve v1.21.4 (before the fix)

### Root Cause

**This issue was already fixed in Issue #1250 (commit 82911f58).**

The root cause, documented in detail in `docs/case-studies/issue-1250/README.md`, was:

When the agent sends data quickly during streaming, NDJSON lines can be concatenated without newline separators between them:

```
{"type":"step_finish",...}{"type":"step_finish",...}  <-- no newline between objects
```

The old code tried to re-parse `fullOutput` after streaming completed, but `JSON.parse` fails when encountering two JSON objects concatenated together.

### Why the User Encountered This Bug

The user was running solve v1.21.4 which did **not** include the fix from Issue #1250. The fix was released in versions after 82911f58 (2026-02-11).

## Solution

The fix was already implemented in Issue #1250:

1. **Streaming Token Accumulation** - Tokens are now accumulated during streaming instead of post-hoc parsing
2. Added `streamingTokenUsage` object to track tokens as events arrive
3. Added `accumulateTokenUsage` helper function called when parsing each JSON line
4. Process `step_finish` events in real-time during both stdout and stderr streaming

## Resolution

**Update to solve version 1.23.11 or later** which includes the fix.

The current version correctly accumulates tokens during streaming and displays the proper token counts:

```
Token usage: X,XXX input, XXX output
```

## Evidence Files

- `solution-draft-log-pr-759.txt` - Full solution draft log from the gist (16,116 lines)

## Verification

The experiments in `experiments/issue-1313/` confirm:
- `test-token-parsing.mjs` - Validates the NDJSON parsing logic
- `test-actual-log-event.mjs` - Tests with actual event data from the log

Both experiments show the parsing logic is correct in the current codebase.

## Related Issues

- **Issue #1250** - Original fix for token usage showing 0 (`docs/case-studies/issue-1250/README.md`)
- **Issue #1201** - Streaming error detection (same pattern used for fix)

## References

- Original issue: https://github.com/link-assistant/hive-mind/issues/1313
- Log gist: https://gist.github.com/konard/baae4b8157c98675224c6e575fef7178
- PR comment with 0 tokens: https://github.com/veb86/zcadvelecAI/pull/759#issuecomment-3896695944
- Fix commit: 82911f58235123ab9a2d450d180642b4717a7a72

## Conclusion

This issue is a **duplicate of Issue #1250** that was reported using an older version of the solve tool. The fix has already been implemented and released. Users should update to the latest version to resolve this issue.
