# Case Study: Issue #1446 — Misleading `/limits` Rate Limit Message

## Problem Statement

The `/limits` command in the Telegram bot displays a misleading message when the Anthropic
OAuth Usage API (`/api/oauth/usage`) returns HTTP 429 (Rate Limited):

```
Claude limits
Rate limited by Claude Usage API. Retry after: 0s
```

The `Retry after: 0s` text is misleading because:

1. The `retry-after: 0` header from the API does not mean "retry immediately" — the endpoint
   continues returning 429 even after retrying
2. The `/limits` command is not auto-updated, so showing a countdown is confusing
3. No actual reset time information is provided to the user

## Timeline / Sequence of Events

1. User invokes `/limits` command in Telegram group chat
2. Bot calls `getAllCachedLimits()` which calls `getCachedClaudeLimits()`
3. Cache miss → `getClaudeUsageLimits()` calls `GET https://api.anthropic.com/api/oauth/usage`
4. API returns HTTP 429 with `retry-after: 0` header
5. Code formats error as: `Rate limited by Claude Usage API. Retry after: 0s`
6. Error is passed as `claudeError` to `formatUsageMessage()` which displays it in the
   "Claude limits" section
7. User sees misleading "Retry after: 0s" which implies they can retry immediately

## Root Cause Analysis

### Primary Root Cause

The Anthropic `/api/oauth/usage` endpoint has aggressive rate limiting that returns HTTP 429
with `retry-after: 0` — a known upstream bug. See:

- [anthropics/claude-code#30930](https://github.com/anthropics/claude-code/issues/30930) — persistent 429 with retry-after: 0
- [anthropics/claude-code#31021](https://github.com/anthropics/claude-code/issues/31021) — persistent 429 on OAuth usage API
- [anthropics/claude-code#31637](https://github.com/anthropics/claude-code/issues/31637) — aggressive rate limiting makes monitoring unusable

### Contributing Factors

1. **No 429 caching**: Failed responses were not cached, so every `/limits` command call would
   hit the already-rate-limited API again, perpetuating the problem
2. **Insufficient verbose logging**: Only the HTTP status code and error body were logged, not
   the full request/response headers needed to debug rate limiting issues
3. **Literal retry-after formatting**: The code displayed the raw `retry-after` header value
   without validating whether it was meaningful (0 is not meaningful)

## Solutions Implemented

### 1. Fix misleading retry-after message (`formatRetryAfterMessage`)

- New exported function that parses `retry-after` header intelligently
- Handles numeric seconds (e.g., `300` → "Resets in 5m (Mar 19, 8:00pm UTC)")
- Handles HTTP-date format (e.g., RFC 7231 dates)
- Falls back to "Try again later." for `0`, negative, null, or unparseable values
- Uses same `dayjs` formatting as other reset times for consistency

### 2. Cache 429 rate-limit errors

- Rate-limit errors are now cached with the same 20-minute TTL as successful responses
- Prevents repeated requests to an already-rate-limited endpoint
- Uses separate cache key (`claude-rate-limited`) to avoid interfering with successful cache entries
- Logged in verbose mode when cached error is returned

### 3. Enhanced verbose logging

- Full request URL, method, and sanitized headers (Authorization token masked except last 8 chars)
- All response headers (including `retry-after`, `x-ratelimit-*`, etc.)
- Response body logged separately from headers for clarity

## Upstream Issues Filed

The root cause is in the Anthropic `/api/oauth/usage` endpoint. The following issues track
this upstream:

- [anthropics/claude-code#30930](https://github.com/anthropics/claude-code/issues/30930) — persistent 429 with retry-after: 0
- [anthropics/claude-code#31637](https://github.com/anthropics/claude-code/issues/31637) — aggressive rate limiting

### Known Workarounds from Community

1. **User-Agent header**: Setting `User-Agent: claude-code/<version>` may get a more generous
   rate limit bucket (per [comment by fazxes](https://github.com/anthropics/claude-code/issues/30930#issuecomment-4032624631))
2. **Token refresh**: Rate limits are per-access-token; refreshing the OAuth token gets a fresh window
3. **20-minute cache TTL**: Our existing 20-minute cache already reduces API call frequency significantly

## Files Changed

| File                            | Change                                                                   |
| ------------------------------- | ------------------------------------------------------------------------ |
| `src/limits.lib.mjs`            | Added `formatRetryAfterMessage()`, enhanced verbose logging, 429 caching |
| `tests/limits-display.test.mjs` | Added tests for `formatRetryAfterMessage()`                              |

## Verbose Log Sample (from issue report)

```
[VERBOSE] /limits command received
[VERBOSE] /limits-cache: Cache miss for Claude limits, fetching from API...
[VERBOSE] /limits fetching usage from API...
[VERBOSE] /limits API HTTP status: 429 Too Many Requests
[VERBOSE] /limits API error: 429 {
  "error": {
    "type": "rate_limit_error",
    "message": "Rate limited. Please try again later."
  }
}
```

After this fix, the verbose output will additionally include:

```
[VERBOSE] /limits API request: GET https://api.anthropic.com/api/oauth/usage
[VERBOSE] /limits API request headers: { ..., "Authorization": "Bearer ...last8chr" }
[VERBOSE] /limits API response headers: { "retry-after": "0", ... }
[VERBOSE] /limits-cache: Cached rate-limit error for 20 minutes
```
