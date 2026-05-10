# Root Cause Analysis: Issue #923

## Timeline of Events

1. **User Action**: User executes `/solve` command with URL containing trailing backslash:

   ```
   /solve https://github.com/konard/hh-job-application-automation/issues/124\
   ```

2. **URL Parsing**: The `parseGitHubUrl` function in `src/github.lib.mjs` processes the URL:
   - Line 1081: Removes trailing slashes with `.replace(/\/+$/, '')`
   - Line 1084: Checks for special characters **at the start only**: `/^[!@#$%^&*()[\]{}|\\:;"'<>,?`~]/.test(normalizedUrl)`
   - **PROBLEM**: Backslash in middle or end of URL is not detected

3. **URL Object Creation**: The URL passes initial validation and is parsed by `new URL()`
   - Browsers have "willful violation" of RFC 3986 and sometimes convert `\` to `/`
   - But this behavior is inconsistent

4. **Symptom**: System attempts to fetch the malformed URL, getting HTML content instead of GitHub API data

## Root Causes

### Primary Cause

The `parseGitHubUrl` function only checks for backslashes at the **start** of the URL (line 1084), not in the path component. The regex pattern:

```javascript
/^[!@#$%^&*()[\]{}|\\:;"'<>,?`~]/.test(normalizedUrl);
```

Uses `^` which only matches at the beginning of the string.

### Secondary Cause

The URL normalization step (line 1081) removes trailing slashes but doesn't check for or remove trailing backslashes:

```javascript
normalizedUrl = url.trim().replace(/\/+$/, ''); // Only removes forward slashes
```

### Contributing Factor

According to RFC 3986 and RFC 1738:

- Backslash `\` is **NOT a valid character** in URL paths
- It must be percent-encoded as `%5C` if needed
- Using raw backslash leads to undefined behavior

## Affected Components

1. **src/github.lib.mjs**: `parseGitHubUrl()` function (line 1073)
   - Used by all URL parsing throughout the system

2. **src/telegram-bot.mjs**:
   - `validateGitHubUrl()` function (line 614)
   - Used by `/solve` and `/hive` commands

3. **src/hive.mjs**: Uses `parseGitHubUrl()` (line 337)

4. **src/solve.mjs**: (No direct usage found, likely uses through validation)

## Standards References

Based on web search findings:

- **RFC 1738**: Lists `\` as an unsafe character that must be encoded
- **RFC 3986**: Backslash is not a valid path character
- **WHATWG URL Standard**: Browsers may replace `\` with `/` (willful violation)
- **Best Practice**: Reject URLs with unencoded backslashes to avoid ambiguity

Sources:

- [Rocket Validator - Backslash used as path segment delimiter](https://rocketvalidator.com/html-validation/bad-value-x-for-attribute-src-on-element-img-backslash-used-as-path-segment-delimiter)
- [Sucuri - Bad Paths & Valid URL Characters](https://blog.sucuri.net/2023/01/bad-paths-the-importance-of-using-valid-url-characters.html)
- [RFC 3986 - URI Generic Syntax](https://www.rfc-editor.org/rfc/rfc3986)
