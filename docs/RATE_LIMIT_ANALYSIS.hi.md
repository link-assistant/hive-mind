# GitHub API Rate Limit त्रुटि विश्लेषण (languages: [en](RATE_LIMIT_ANALYSIS.md) • [zh](RATE_LIMIT_ANALYSIS.zh.md) • hi • [ru](RATE_LIMIT_ANALYSIS.ru.md))

## Issue संदर्भ

**GitHub Issue**: [#186](https://github.com/link-assistant/hive-mind/issues/186)
**समस्या**: Search API rate limits तक पहुँच जाती है, repository listing API पर fallback की आवश्यकता है
**लक्ष्य**: Rate limit errors का उचित detection और fallback mechanism implement करना

## मुख्य निष्कर्ष

### 1. Rate Limit त्रुटि पैटर्न

जब GitHub CLI (`gh`) commands rate limits तक पहुँचते हैं, तो वे specific error messages produce करते हैं जिन्हें detect किया जा सकता है:

#### Primary Rate Limit त्रुटि

```
HTTP 403: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. If you reach out to GitHub Support for help, please include the request ID D84A:2DE4CB:565BC8C:5079198:68CB676D. (https://api.github.com/search/issues?advanced_search=true&page=3&per_page=100&q=is%3Aissue+type%3Aissue)
```

#### Detection पैटर्न

Rate limit errors detect करने के लिए, error messages में इन patterns की जांच करें:

- `"rate limit"` (case insensitive)
- `"secondary rate limit"`
- `"HTTP 403"` rate-related terms के साथ combined
- `"exceeded.*limit"` (regex pattern)
- `"Please wait"` या `"wait a few minutes"`
- `"abuse detection"` (GitHub का abuse detection mechanism)
- `"too many requests"`

### 2. API व्यवहार अंतर

#### Search API (`gh search issues`)

- **Rate Limit**: 30 requests प्रति मिनट
- **Secondary Rate Limits**: Large page sizes (>100) या rapid requests द्वारा triggered
- **Page Size Limit**: Practical maximum ~100-200 items
- **व्यवहार**: सख्त limits, rate limiting की अधिक संभावना
- **Use Case**: Cross-repository searches, organization/user scope

#### Repository Listing API (`gh issue list --repo`)

- **Rate Limit**: Search API से अधिक
- **Secondary Rate Limits**: Trigger होने की कम संभावना
- **Page Size Limit**: 1000+ items को successfully handle कर सकता है
- **व्यवहार**: अधिक reliable, large datasets के लिए बेहतर
- **Use Case**: Single repository, fallback strategy

### 3. अधिकतम Page Sizes

| API Type       | अनुशंसित Max | Tested Max | नोट्स                                            |
| -------------- | ------------ | ---------- | ------------------------------------------------- |
| Search API     | 100          | 200        | Higher values secondary rate limits trigger करते हैं |
| Repository API | 1000         | 1000+      | Large page sizes के साथ बहुत अधिक reliable       |
| PR Listing     | 1000         | 1000+      | Repository API के समान                           |

### 4. Rate Limit Headers

GitHub API responses में headers में rate limit जानकारी शामिल होती है:

```
X-Ratelimit-Limit: 30
X-Ratelimit-Remaining: 18
X-Ratelimit-Reset: 1758160590
X-Ratelimit-Resource: search
X-Ratelimit-Used: 12
```

## Implementation रणनीति

### वर्तमान Implementation

Codebase में पहले से `/tmp/gh-issue-solver-1758160335449/github.lib.mjs` में `fetchAllIssuesWithPagination()` function है जो:

- GitHub CLI commands के लिए `execSync` उपयोग करता है
- Improved limits (1000) के साथ pagination implement करता है
- Requests के बीच delays (5 सेकंड) जोड़ता है
- Basic error handling है

### आवश्यक Enhancements

1. **Rate Limit Detection Function जोड़ें**

```javascript
function isRateLimitError(error) {
  const errorText = (error.stderr?.toString() || error.stdout?.toString() || error.message || '').toLowerCase();

  const rateLimitPatterns = [/rate limit/i, /secondary rate limit/i, /exceeded.*limit/i, /abuse detection/i, /too many requests/i, /please wait.*before/i, /wait.*(?:few )?minutes?/i, /http 403.*(?:rate|limit|abuse)/i];

  return rateLimitPatterns.some(pattern => pattern.test(errorText));
}
```

2. **Fallback रणनीति Implement करें**

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

3. **Page Size रणनीति Update करें**

- Search API: प्रति request अधिकतम 100 items उपयोग करें
- Repository API: प्रति request 1000 items तक उपयोग करें
- Requests के बीच existing 5-second delays बनाए रखें

### Fallback Logic

जब Search API rate limits तक पहुँचे:

1. ऊपर दिए patterns का उपयोग करके rate limit error detect करें
2. Original command को parse करके repository जानकारी extract करें
3. Search command को repository listing command में convert करें
4. Repository API के लिए higher page limits (1000) उपयोग करें
5. Search API के समान format में results return करें

### उदाहरण Command Conversion

| Original (Search API)                      | Fallback (Repository API)                                          |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `gh search issues org:microsoft is:open`   | Multiple `gh issue list --repo {repo} --state open` calls          |
| `gh search issues user:username is:open`   | Multiple `gh issue list --repo {repo} --state open` calls          |
| `gh search issues repo:owner/repo is:open` | `gh issue list --repo owner/repo --state open`                     |

## Modify की जाने वाली फ़ाइलें

### 1. `/tmp/gh-issue-solver-1758160335449/github.lib.mjs`

- `fetchAllIssuesWithPagination()` function update करें
- Rate limit detection जोड़ें
- Fallback logic implement करें
- API type के आधार पर page sizes optimize करें

### 2. Usage Points

- `/tmp/gh-issue-solver-1758160335449/hive.mjs` (lines 585, 598, 629)
- `fetchAllIssuesWithPagination()` को call करने वाली कोई अन्य files

## Testing रणनीति

1. **Rate Limit Detection**: Deliberate rate limit triggering के साथ test करें
2. **Fallback Mechanism**: Verify करें कि search fail होने पर repository API काम करता है
3. **Page Size Optimization**: प्रत्येक API के लिए अलग-अलग limits test करें
4. **Error Handling**: Graceful degradation सुनिश्चित करें

## लाभ

1. **बेहतर Reliability**: Fallback सुनिश्चित करता है कि issues अभी भी fetch किए जा सकते हैं
2. **बेहतर Performance**: प्रत्येक API के लिए optimal page sizes उपयोग करें
3. **Rate Limit Awareness**: उचित detection और handling
4. **User Experience**: Failures के बजाय Graceful degradation

## अगले कदम

1. `fetchAllIssuesWithPagination()` में rate limit detection implement करें
2. Repository listing API पर fallback जोड़ें
3. विभिन्न rate limit scenarios के साथ test करें
4. Page size recommendations update करें
5. भविष्य की optimization के लिए rate limit events monitor और log करें
