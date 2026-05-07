# Case Study: Issue #1074 - Usage API Rate Limiting

## Issue Summary

**Issue:** [#1074](https://github.com/link-assistant/hive-mind/issues/1074)
**Title:** Make sure usage API call for --tool claude would be ever done not more frequent than 20 minutes for both /limits and /solve queue
**Labels:** bug
**Date:** January 7, 2026

## Problem Statement

The Claude Usage API (`https://api.anthropic.com/api/oauth/usage`) is returning `null` values for all usage metrics. This behavior suggests the API may be rate limiting requests that are made too frequently.

### Observed Symptoms

From the verbose logs:

```
[VERBOSE] /limits API response: {
  "five_hour": null,
  "seven_day": null,
  "seven_day_oauth_apps": null,
  "seven_day_opus": null,
  "seven_day_sonnet": null,
  "iguana_necktie": null,
  "extra_usage": {
    "is_enabled": false,
    "monthly_limit": null,
    "used_credits": null,
    "utilization": null
  }
}
```

All usage values are `null`, and there's no HTTP status code logged for the API response (just the parsed JSON).

## Root Cause Analysis

### Current Implementation

The caching mechanism in `limits.lib.mjs` uses:

```javascript
export const CACHE_TTL = {
  API: 180000, // 3 minutes for API calls (Claude, GitHub)
  SYSTEM: 120000, // 2 minutes for system metrics (RAM, CPU, disk)
};
```

This means the Usage API can be called as frequently as every **3 minutes**, which appears to be too aggressive for Anthropic's rate limiting policy.

### Evidence

1. **API Response Structure**: The API is responding with HTTP 200 (implied by successful JSON parsing) but returning `null` for all fields
2. **No Error Status**: No 429 (Too Many Requests) error is being logged, suggesting the API "gracefully degrades" by returning nulls
3. **User Report**: The issue mentions "20 minutes" as the recommended minimum interval
4. **External Research**: According to [Claude Code Usage Limits documentation](https://codelynx.dev/posts/claude-code-usage-limits-statusline), the API returns `utilization` and `resets_at` fields that can be null when no data is available

### Timeline Reconstruction

1. **Initial State**: Usage API was working with 3-minute cache TTL
2. **Rate Limit Enforcement**: Anthropic began rate limiting the usage endpoint more strictly
3. **Graceful Degradation**: Instead of returning 429 errors, the API returns null values
4. **User Impact**: `/limits` command shows "N/A" for all Claude usage metrics

## Proposed Solution

### Changes Required

1. **Increase Cache TTL for Usage API**: Change from 3 minutes to 20 minutes (1,200,000 ms)
2. **Make TTL Configurable**: Add environment variable `HIVE_MIND_USAGE_API_CACHE_TTL_MS`
3. **Document Configuration**: Update `docs/CONFIGURATION.md` with the new setting
4. **Add Verbose Logging**: Log HTTP response status for debugging

### Implementation Details

#### 1. New Cache TTL Constant

```javascript
export const CACHE_TTL = {
  API: 180000, // 3 minutes for regular API calls (GitHub)
  USAGE_API: 1200000, // 20 minutes for Claude Usage API (rate limited)
  SYSTEM: 120000, // 2 minutes for system metrics
};
```

#### 2. Environment Variable

```javascript
// Configurable via HIVE_MIND_USAGE_API_CACHE_TTL_MS
// Default: 1200000 (20 minutes)
// Minimum: 60000 (1 minute) to prevent accidental abuse
```

#### 3. Updated Caching Logic

```javascript
export async function getCachedClaudeLimits(verbose = false) {
  const cache = getLimitCache();
  const cached = cache.get('claude', CACHE_TTL.USAGE_API);
  if (cached) {
    if (verbose) console.log('[VERBOSE] /limits-cache: Using cached Claude limits');
    return cached;
  }
  const result = await getClaudeUsageLimits(verbose);
  if (result.success) cache.set('claude', result, CACHE_TTL.USAGE_API);
  return result;
}
```

## References

### Online Sources

- [Rate limits - Claude Docs](https://platform.claude.com/docs/en/api/rate-limits)
- [How to Show Claude Code Usage Limits in Your Statusline](https://codelynx.dev/posts/claude-code-usage-limits-statusline)
- [GitHub Issue #9094 - Claude usage limits changes](https://github.com/anthropics/claude-code/issues/9094)

### Codebase Files

- `src/limits.lib.mjs` - Main implementation (lines 790-862)
- `src/telegram-solve-queue.lib.mjs` - Queue system using cached limits
- `docs/CONFIGURATION.md` - Configuration documentation

## Testing Plan

1. **Unit Tests**: Test cache TTL enforcement with mocked timers
2. **Integration Tests**: Verify API calls are throttled correctly
3. **Manual Testing**: Monitor verbose logs to confirm 20-minute intervals

## Impact Assessment

- **Low Risk**: Only affects caching behavior, no functional changes
- **Backward Compatible**: Existing behavior preserved, just with longer cache
- **Minimal Breaking Changes**: None expected

## Files Changed

1. `src/limits.lib.mjs` - Add USAGE_API cache TTL
2. `src/config.lib.mjs` - Add configurable TTL environment variable
3. `docs/CONFIGURATION.md` - Document new configuration option
4. `test/limits.test.mjs` - Add tests for new caching behavior
