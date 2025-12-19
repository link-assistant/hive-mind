# Proposed Solution: Issue #923

## Solution Overview

Modify the `parseGitHubUrl` function to detect backslashes anywhere in the URL path (not just at the start), and provide a helpful error message suggesting the corrected URL.

## Implementation Strategy

### 1. Enhanced Backslash Detection

Add a check after URL normalization but before parsing to detect backslashes in the path component:

```javascript
// Check for backslashes in the URL path (excluding query params and hash)
const urlBeforeQueryAndHash = normalizedUrl.split('?')[0].split('#')[0];
if (urlBeforeQueryAndHash.includes('\\')) {
  // Try to suggest corrected URL
  const suggestedUrl = urlBeforeQueryAndHash.replace(/\\/g, '/');
  const urlAfterPath = normalizedUrl.substring(urlBeforeQueryAndHash.length);
  
  return {
    valid: false,
    error: 'Invalid character in URL: backslash (\\) is not allowed in URL paths',
    suggestion: suggestedUrl + urlAfterPath
  };
}
```

### 2. Location in Code

**File**: `src/github.lib.mjs`
**Function**: `parseGitHubUrl` (starting at line 1073)
**Insert after**: Line 1108 (after http to https conversion)
**Insert before**: Line 1110 (before URL parsing with `new URL()`)

This placement ensures:
- URL has been normalized (protocol added, trimmed)
- Before actual URL object creation
- Catches backslashes in any position

### 3. Error Message Design

Return format:
```javascript
{
  valid: false,
  error: 'Invalid character in URL: backslash (\\) is not allowed in URL paths',
  suggestion: 'https://corrected/url/without/backslash'
}
```

This allows callers to:
1. Display the error message
2. Optionally show the suggested corrected URL
3. In Telegram bot: offer to retry with corrected URL

### 4. Test Coverage

Add test cases for:
- Backslash at end: `https://github.com/owner/repo/issues/123\`
- Backslash in middle: `https://github.com\owner/repo/issues/123`
- Multiple backslashes: `https://github.com/owner\repo\issues\123`
- Backslash in query param (should be allowed): `https://github.com/owner/repo/issues/123?q=test\value`
- Backslash in hash (should be allowed): `https://github.com/owner/repo/issues/123#L\123`

### 5. Integration Points

The fix will automatically benefit:
- `/solve` command in Telegram bot
- `/hive` command in Telegram bot
- Direct `solve` CLI usage
- Direct `hive` CLI usage
- Any other code using `parseGitHubUrl()`

## Benefits

1. **Clear Error Message**: Users immediately understand what's wrong
2. **Helpful Suggestion**: Corrected URL is provided
3. **Prevents Silent Failures**: No more mysterious HTML parsing errors
4. **Standards Compliant**: Enforces RFC 3986 URL standards
5. **Single Point of Fix**: One change fixes all entry points

## Backward Compatibility

- No breaking changes to function signature
- Existing valid URLs continue to work
- Only affects previously-broken URLs with backslashes
