# Case Study: Issue #1331 - Auto-Resume on Internal Server Error with Session Preservation

## Overview

This case study documents the investigation and resolution of the Claude API `Internal server error` (HTTP 500) issue in Hive Mind's `claude` tool. The issue required implementing automatic retry with exponential backoff while preserving the session state.

## Issue Details

- **Issue**: [#1331](https://github.com/link-assistant/hive-mind/issues/1331)
- **Title**: Double check that on `Internal server error` of claude tool we do auto-resume with session preservation
- **Labels**: bug
- **Date**: February 2026

## Error Pattern

The error manifests as:

```
API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"},"request_id":"req_011CYFmxpwLMccW87i77dUEL"}
```

## Timeline Reconstruction

### Known Incident Dates

Based on GitHub issues in the `anthropics/claude-code` repository, major incidents of `Internal server error` 500 errors occurred:

| Date       | Incident                       | Request ID Prefix | Scope                              |
| ---------- | ------------------------------ | ----------------- | ---------------------------------- |
| 2025-08-02 | Single user                    | Various           | Single session                     |
| 2026-02-03 | Widespread outage              | `req_011CXm*`     | All chats/terminals simultaneously |
| 2026-02-04 | Repeated within single session | `req_011CXoL*`    | 3 occurrences in one session       |

### Sequence of Events for February 2026 Incident (from GitHub issues #22838, #23120)

1. **T+00:00** - User makes API request to Anthropic API
2. **T+02:00** - After 2+ minutes of processing, server returns HTTP 500 Internal Server Error
3. **T+02:00** - Claude Code displays error to user: `API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}`
4. **T+02:00** - Claude Code prompts: "You received an API: 500 error but you should be able to continue now"
5. **T+02:05** - User manually types "continue"
6. **T+07:00** - Second occurrence during same session
7. **T+07:05** - User manually types "continue" again
8. **T+12:00** - Third occurrence in same session

The same request ID prefix (`req_011CXoL*`) across all 3 occurrences suggests routing to the same backend infrastructure, indicating a transient server-side issue.

## Root Cause Analysis

### Primary Root Cause: Transient Server-Side Failures

The `Internal server error` (HTTP 500) is distinctly different from the Overloaded error (HTTP 529) that Hive Mind already handles. According to Anthropic's official API documentation:

> **500 - api_error**: An unexpected error has occurred internal to Anthropic's systems.

This error indicates:

1. **Server-side processing failures** - not related to request validity
2. **Transient infrastructure issues** - temporary unavailability of backend services
3. **Load balancer or routing issues** - routing to unhealthy backend nodes
4. **Database or storage transient failures** - temporary inability to access session state

### Secondary Root Cause: Missing Retry Logic in Hive Mind

Hive Mind's `claude.lib.mjs` already handles two types of 500 errors:

- `API Error: 500` + `Overloaded` → Retried with exponential backoff (3 retries, starting 5s)
- `API Error: 503` → Retried with exponential backoff (3 retries, starting 5 minutes)

However, `API Error: 500` + `Internal server error` was **not handled** - it fell through as a generic command failure with no retry logic.

### Evidence from GitHub Issues

Multiple reported issues in `anthropics/claude-code` confirm this is a known, recurring pattern:

- [#23120](https://github.com/anthropics/claude-code/issues/23120): 3 occurrences in single session on Feb 4, 2026
- [#22838](https://github.com/anthropics/claude-code/issues/22838): Widespread outage on Feb 3, 2026 affecting all chats
- [#22836](https://github.com/anthropics/claude-code/issues/22836): Same error pattern
- [#5362](https://github.com/anthropics/claude-code/issues/5362): Reported August 2025
- [#4989](https://github.com/anthropics/claude-code/issues/4989): Reported August 2025

The pattern shows **at least 62 incidents in 90 days** (19 major + 43 minor) according to API monitoring data, with median duration of ~79 minutes.

## Current Code Analysis

### `src/claude.lib.mjs` - executeClaudeCommand function

**Existing retry logic for Overloaded (500) errors:**

```javascript
// Lines ~1113-1138: Only checks for 500 + Overloaded
if ((commandFailed || isOverloadError) && (isOverloadError || (lastMessage.includes('API Error: 500') && lastMessage.includes('Overloaded')) || (lastMessage.includes('api_error') && lastMessage.includes('Overloaded')))) {
  // ... retry with maxRetries=3, baseDelay=5s
}
```

**Gap: No handling for `Internal server error`:**
The error pattern `{"type":"api_error","message":"Internal server error"}` does NOT contain "Overloaded", so the above check fails to catch it.

**Existing flags in detection area (~line 790):**

```javascript
let isOverloadError = false; // API overloaded (529/500+Overloaded)
let is503Error = false; // Network error (503)
// MISSING: let isInternalServerError = false;  // Internal server error (500)
```

## Proposed Solution

### Session Preservation Strategy

The key requirement is **session preservation** - resuming the same session ID rather than starting fresh. This allows the in-progress work to continue without losing context.

The existing pattern in `src/solve.execution.lib.mjs` shows how session resume works:

1. Session ID is captured from Claude's output (`sessionId` variable)
2. On retry, passing `--resume ${sessionId}` to Claude Code CLI allows continuation

For the `Internal server error` case:

1. Session ID may or may not be captured (depends on when error occurred)
2. If session ID was captured: use `--resume ${sessionId}` for true session continuation
3. If session ID not captured: restart without resume (start fresh)

### Retry Parameters (as specified in issue)

- Starting delay: **1 minute** (60,000ms)
- Exponential backoff: delay doubles each retry
- Max delay per retry: **30 minutes** (1,800,000ms)
- Max retries: **10**
- Environment variable overrides: via `HIVE_MIND_MAX_INTERNAL_SERVER_ERROR_RETRIES`, `HIVE_MIND_INITIAL_INTERNAL_SERVER_ERROR_DELAY_MS`

### Detection Pattern

The error appears in two places:

1. In `data.type === 'assistant'` content items (during execution)
2. In `data.type === 'result'` with `is_error === true`

Detection regex:

```javascript
const isInternalServerError = text.includes('API Error: 500') && (text.includes('Internal server error') || text.includes('"api_error"')) && !text.includes('Overloaded');
```

## Files Modified

1. `src/claude.lib.mjs` - Added Internal Server Error detection and retry logic with session preservation
2. `src/config.lib.mjs` - Added configuration constants for Internal Server Error retry parameters
3. `tests/test-internal-server-error-retry.mjs` - Unit tests for the new retry logic
4. `docs/case-studies/issue-1331/README.md` - This case study

## Known Issues Reported to Anthropic

Based on this analysis, relevant GitHub issues have been filed in `anthropics/claude-code`:

- The issue already has multiple duplicates (#23120, #22838, #22836, #22839, #5362, #4989, #1470)
- This is a known server-side issue requiring both server-side fixes AND client-side resilience

## Related Existing Handling in Hive Mind

| Error Type                | Retry                                    | Max Retries | Initial Delay | Session Preservation     |
| ------------------------- | ---------------------------------------- | ----------- | ------------- | ------------------------ |
| 500 Overloaded            | Yes                                      | 3           | 5 seconds     | No (restart)             |
| 503 Network Error         | Yes (requires `--auto-resume-on-errors`) | 3           | 5 minutes     | No (restart)             |
| 500 Internal Server Error | **NEW**                                  | 10          | 1 minute      | **Yes (session resume)** |

## Sources

- [Anthropic API Error Documentation](https://platform.claude.com/docs/en/api/errors)
- [GitHub #23120: Repeated API 500 in single session](https://github.com/anthropics/claude-code/issues/23120)
- [GitHub #22838: API Error 500 affecting all chats](https://github.com/anthropics/claude-code/issues/22838)
- [GitHub #5362: Anthropic API 500 Internal Server Error](https://github.com/anthropics/claude-code/issues/5362)
- [GitHub #4989: Unexpected 500 Internal Server Error](https://github.com/anthropics/claude-code/issues/4989)
- [Claude Code API Error Analysis](https://help.apiyi.com/en/claude-code-500-error-fix-guide-en.html)
- [API Status Monitor - Anthropic](https://aistatus.org/anthropic/api)
