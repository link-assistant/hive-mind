# GitHub API Rate Limit Error Analysis

## Issue Context
**GitHub Issue**: [#186](https://github.com/link-assistant/hive-mind/issues/186)
**Problem**: Search API hits rate limits, need fallback to repository listing API
**Goal**: Implement proper detection of rate limit errors and fallback mechanism

## Key Findings

### 1. Rate Limit Error Patterns

When GitHub CLI (`gh`) commands hit rate limits, they produce specific error messages that can be detected:

#### Primary Rate Limit Error
```
HTTP 403: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. If you reach out to GitHub Support for help, please include the request ID D84A:2DE4CB:565BC8C:5079198:68CB676D. (https://api.github.com/search/issues?advanced_search=true&page=3&per_page=100&q=is%3Aissue+type%3Aissue)
```

#### Detection Patterns
To detect rate limit errors, check for these patterns in error messages:
- `"rate limit"` (case insensitive)
- `"secondary rate limit"`
- `"HTTP 403"` combined with rate-related terms
- `"exceeded.*limit"` (regex pattern)
- `"Please wait"` or `"wait a few minutes"`
- `"abuse detection"` (GitHub's abuse detection mechanism)
- `"too many requests"`

### 2. API Behavior Differences

#### Search API (`gh search issues`)
- **Rate Limit**: 30 requests per minute
- **Secondary Rate Limits**: Triggered by large page sizes (>100) or rapid requests
- **Page Size Limit**: Practical maximum ~100-200 items
- **Behavior**: Stricter limits, more prone to rate limiting
- **Use Case**: Cross-repository searches, organization/user scope

#### Repository Listing API (`gh issue list --repo`)
- **Rate Limit**: Higher than search API
- **Secondary Rate Limits**: Less prone to triggering
- **Page Size Limit**: Can handle 1000+ items successfully
- **Behavior**: More reliable, better for large datasets
- **Use Case**: Single repository, fallback strategy

### 3. Maximum Page Sizes

| API Type | Recommended Max | Tested Max | Notes |
|----------|-----------------|------------|-------|
| Search API | 100 | 200 | Higher values trigger secondary rate limits |
| Repository API | 1000 | 1000+ | Much more reliable with large page sizes |
| PR Listing | 1000 | 1000+ | Similar to repository API |

### 4. Rate Limit Headers

GitHub API responses include rate limit information in headers:
```
X-Ratelimit-Limit: 30
X-Ratelimit-Remaining: 18
X-Ratelimit-Reset: 1758160590
X-Ratelimit-Resource: search
X-Ratelimit-Used: 12
```

## Implementation Strategy

### Current Implementation
The codebase already has `fetchAllIssuesWithPagination()` function in `/tmp/gh-issue-solver-1758160335449/github.lib.mjs` that:
- Uses `execSync` for GitHub CLI commands
- Implements pagination with improved limits (1000)
- Adds delays between requests (5 seconds)
- Has basic error handling

### Required Enhancements

1. **Add Rate Limit Detection Function**
```javascript
function isRateLimitError(error) {
  const errorText = (error.stderr?.toString() || error.stdout?.toString() || error.message || '').toLowerCase();

  const rateLimitPatterns = [
    /rate limit/i,
    /secondary rate limit/i,
    /exceeded.*limit/i,
    /abuse detection/i,
    /too many requests/i,
    /please wait.*before/i,
    /wait.*(?:few )?minutes?/i,
    /http 403.*(?:rate|limit|abuse)/i
  ];

  return rateLimitPatterns.some(pattern => pattern.test(errorText));
}
```

2. **Implement Fallback Strategy**
```javascript
// In fetchAllIssuesWithPagination
try {
  const output = execSync(searchCommand, { encoding: 'utf8' });
  // ... process success
} catch (error) {
  if (isRateLimitError(error)) {
    await log('🚨 Rate limit detected, falling back to repository listing API');
    return await fallbackToRepositoryListing(baseCommand);
  } else {
    // Handle other errors
    throw error;
  }
}
```

3. **Update Page Size Strategy**
- Search API: Use maximum 100 items per request
- Repository API: Use up to 1000 items per request
- Maintain existing 5-second delays between requests

### Fallback Logic

When search API hits rate limits:
1. Detect rate limit error using patterns above
2. Parse the original command to extract repository information
3. Convert search command to repository listing command
4. Use higher page limits (1000) for repository API
5. Return results in same format as search API

### Example Command Conversion

| Original (Search API) | Fallback (Repository API) |
|----------------------|---------------------------|
| `gh search issues org:microsoft is:open` | Multiple `gh issue list --repo {repo} --state open` calls |
| `gh search issues user:username is:open` | Multiple `gh issue list --repo {repo} --state open` calls |
| `gh search issues repo:owner/repo is:open` | `gh issue list --repo owner/repo --state open` |

## Files to Modify

### 1. `/tmp/gh-issue-solver-1758160335449/github.lib.mjs`
- Update `fetchAllIssuesWithPagination()` function
- Add rate limit detection
- Implement fallback logic
- Optimize page sizes based on API type

### 2. Usage Points
- `/tmp/gh-issue-solver-1758160335449/hive.mjs` (lines 585, 598, 629)
- Any other files calling `fetchAllIssuesWithPagination()`

## Testing Strategy

1. **Rate Limit Detection**: Test with deliberate rate limit triggering
2. **Fallback Mechanism**: Verify repository API works when search fails
3. **Page Size Optimization**: Test different limits for each API
4. **Error Handling**: Ensure graceful degradation

## Benefits

1. **Improved Reliability**: Fallback ensures issues can still be fetched
2. **Better Performance**: Use optimal page sizes for each API
3. **Rate Limit Awareness**: Proper detection and handling
4. **User Experience**: Graceful degradation instead of failures

## Next Steps

1. Implement rate limit detection in `fetchAllIssuesWithPagination()`
2. Add fallback to repository listing API
3. Test with various rate limit scenarios
4. Update page size recommendations
5. Monitor and log rate limit events for future optimization