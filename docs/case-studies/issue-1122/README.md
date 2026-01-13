# Case Study: Issue #1122 - Weekly Limit Not Displayed as Specially Marked Comment

## Issue Summary

When Claude reaches its usage limit, the solution draft tool should post a specially formatted comment (like the 5-hour limit) to make it clear to users that the session was interrupted due to usage limits. However, for weekly limits, this formatting was not applied correctly.

**Issue URL**: https://github.com/link-assistant/hive-mind/issues/1122

## Cases Analyzed

### Case 1: Successful Limit Message (5-hour limit)
- **URL**: https://github.com/link-foundation/browser-commander/pull/22#issuecomment-3745819552
- **Timestamp**: 2026-01-13T18:40:59Z
- **Reset message**: "You've hit your limit · resets 10pm (Europe/Berlin)"
- **Result**: Successfully posted with `## ⏳ Usage Limit Reached` header

### Case 2: Failed Limit Message (Weekly limit)
- **URL**: https://github.com/ProverCoderAI/vibecode-linter/pull/2#issuecomment-3742234295
- **Timestamp**: 2026-01-13T06:28:48Z
- **Reset message**: "You've hit your limit · resets Jan 15, 8am (Europe/Berlin)"
- **Result**: Posted with generic `## 🤖 Solution Draft Log` header (WRONG)

### Case 3: Branch Operation Failure (Not a limit issue)
- **URL**: https://github.com/ProverCoderAI/effect-template/pull/8#issuecomment-3743313834
- **Timestamp**: 2026-01-13T09:52:43Z
- **Error**: "Branch operation failed" (NOT a usage limit error)
- **Note**: This case was incorrectly categorized in the issue - it's a separate bug

## Timeline Reconstruction

### Case 1 (Browser Commander - Successful)
```
18:40:50.393Z - Claude returns rate_limit error: "You've hit your limit · resets 10pm (Europe/Berlin)"
18:40:50.962Z - Tool captures result with error: "rate_limit"
18:40:51.509Z - extractResetTime() returns "10:00 PM"
18:40:51.xxx Z - attachLogToGitHub() called with isUsageLimit=true, limitResetTime="10:00 PM"
18:40:59Z     - Comment posted with proper "⏳ Usage Limit Reached" format
```

### Case 2 (Vibecode-linter - Failed)
```
06:28:42.629Z - Claude returns rate_limit error: "You've hit your limit · resets Jan 15, 8am (Europe/Berlin)"
06:28:42.630Z - Tool captures result with error: "rate_limit"
06:28:43.xxx Z - extractResetTime() returns null (CANNOT PARSE DATE FORMAT)
06:28:43.xxx Z - limitResetTime is null, but isUsageLimit detection still works
06:28:45.716Z - Comment posted with generic format because limitResetTime is null
```

Wait - this doesn't match. Let me re-examine...

Looking at the vibecode-linter log more carefully:
- The `error: "rate_limit"` field IS set
- The message contains "resets" which SHOULD trigger `isUsageLimitError()` to return true
- But the comment was posted with generic "🤖 Solution Draft Log" header

## Root Cause Analysis

### Primary Bug: Date Parsing Failure in `extractResetTime()`

The `extractResetTime()` function in `src/usage-limit.lib.mjs` handles these patterns:
- "resets 10pm" → Returns "10:00 PM" ✅
- "resets 5am" → Returns "5:00 AM" ✅
- "resets Jan 15, 8am" → Returns **null** ❌

The function does NOT handle reset times that include a DATE (for weekly limits).

**Test Evidence:**
```javascript
// 5-hour limit (works)
extractResetTime("You've hit your limit · resets 10pm (Europe/Berlin)")
// Returns: "10:00 PM"

// Weekly limit (fails)
extractResetTime("You've hit your limit · resets Jan 15, 8am (Europe/Berlin)")
// Returns: null
```

### Why the Comment Format Failed

Looking at the code flow in `solve.mjs` and `github.lib.mjs`:

1. The `isUsageLimitError()` check DOES detect the limit correctly (returns `true`)
2. But `extractResetTime()` returns `null` because it can't parse dates
3. When `limitResetTime` is `null`, the code path in `attachLogToGitHub()` still uses `isUsageLimit=true`

Wait - this should still work. Let me re-check the actual log output...

Looking at the vibecode-linter log:
```
[2026-01-13T06:28:43.099Z] [WARNING] Your Claude usage limit has been reached.
[2026-01-13T06:28:43.100Z] [WARNING] Please wait for the limit to reset.
```

The "Please wait for the limit to reset" line confirms that `extractResetTime()` returned `null`.

But then the comment was still posted with the generic format. This means the code path did NOT set `isUsageLimit=true` when calling `attachLogToGitHub()`.

### Secondary Issue: Log Attachment Path

Looking at the actual log end:
```
[2026-01-13T06:28:45.716Z] [INFO] 📎 Uploading solution draft log to Pull Request...
```

This is the GENERIC log upload path, not the usage limit specific path!

The issue is that when the limit is reached on the FIRST turn (no actual work was done), the code takes a different path that doesn't properly detect the usage limit.

## Key Findings

### Finding 1: Date Pattern Not Supported
The `extractResetTime()` function only handles time-only patterns, not date+time patterns like:
- "resets Jan 15, 8am"
- "resets January 15, 8am"

### Finding 2: First-Turn Limit Detection Issue
When the limit is reached immediately (on the first turn, before any work is done), the error handling path may differ from when it's reached mid-session. The vibecode-linter case shows `num_turns: 1` and `duration_ms: 643`, indicating the limit was hit immediately.

### Finding 3: Log Upload Path Selection
The code that selects between "Usage Limit Reached" and "Solution Draft Log" format may not be correctly triggered when:
- `limitResetTime` is `null` (can't parse date format)
- The session ends immediately on the first turn

## Proposed Solutions

### Solution 1: Add Date Pattern Support to `extractResetTime()`

Add new regex patterns to handle date+time formats:

```javascript
// Pattern X: "resets Jan 15, 8am" or "resets January 15, 8:00 am"
const resetsWithDate = normalized.match(
  /resets\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+([0-9]{1,2})(?::([0-9]{2}))?\s*([ap]m)/i
);
if (resetsWithDate) {
  const hour = resetsWithDate[1];
  const minute = resetsWithDate[2] || '00';
  const ampm = resetsWithDate[3].toUpperCase();
  // Also need to handle the date for proper scheduling
  return `${hour}:${minute} ${ampm}`;
}
```

### Solution 2: Return Full Reset String When Date is Included

Instead of just returning the time, return the complete reset string for weekly limits:

```javascript
// For weekly limits, return the full date+time string
const resetsWithFullDate = normalized.match(
  /resets\s+((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+[0-9]{1,2}(?::[0-9]{2})?\s*[ap]m)/i
);
if (resetsWithFullDate) {
  return resetsWithFullDate[1]; // e.g., "Jan 15, 8am"
}
```

### Solution 3: Ensure isUsageLimit Flag is Set Regardless of Reset Time Parsing

Even if `extractResetTime()` returns `null`, the `isUsageLimit` flag should still be set when the error contains limit-related keywords.

## Evidence Files

Located in `./evidence/`:
- `successful-limit-comment-browser-commander.json` - API response for successful case
- `failed-limit-comment-vibecode-linter.json` - API response for failed case
- `failed-limit-comment-effect-template.json` - API response for branch failure case
- `successful-limit-log-browser-commander.txt` - Full execution log for successful case

## Related Code Files

- `src/usage-limit.lib.mjs` - Contains `extractResetTime()` and `isUsageLimitError()` functions
- `src/github.lib.mjs` - Contains `attachLogToGitHub()` function that formats the comment
- `src/solve.mjs` - Main solve logic that handles limit detection and log upload

## Note on Third Case (effect-template)

The third case mentioned in the issue (effect-template PR#8) is NOT a usage limit issue. It's a separate bug where the branch checkout failed due to `null` values in the repository context:

```
Repository: https://github.com/null/null
Pull Request: https://github.com/null/null/pull/null
```

This indicates a bug in the PR metadata parsing when working with Renovate-created PRs from forks. This should be tracked as a separate issue.
