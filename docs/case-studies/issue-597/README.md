# Case Study: "Could not process image" Error

## Issue Information
- **Issue**: #597
- **Title**: Could not process image
- **Date**: 2025-12-11
- **Status**: Root cause identified

## Executive Summary

This case study analyzes the "Could not process image" error that occurs when Claude Code CLI attempts to view images embedded in GitHub issues and pull requests. Through detailed log analysis, we identified that the error is **not** a flaky Anthropic API bug, but rather a systematic problem with how images are downloaded from GitHub.

## Problem Statement

Claude Code CLI encounters an API error when attempting to process images:

```
API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Could not process image"},"request_id":"..."}
```

This error was initially believed to be a random/flaky bug on Anthropic's API side, as retrying the same operation sometimes succeeded.

## Timeline of Events

### Error Case: hh-job-application-automation/pull/125
**Timestamp**: 2025-12-11T15:06:04.705Z
**Result**: Failed with "Could not process image"

### Success Case: hh-job-application-automation/pull/125 (Retry)
**Timestamp**: Later (same day)
**Result**: Succeeded

## Root Cause Analysis

Through detailed log analysis, we discovered the following sequence of events:

### 1. Initial WebFetch Attempt
```
URL: https://github.com/user-attachments/assets/06a90208-d5fe-43fc-8e30-cb510150e1e0
Result: REDIRECT DETECTED (302 Found)
Redirect to: https://github-production-user-asset-6210df.s3.amazonaws.com/...
```

### 2. Fallback to Direct Download
The AI assistant attempted to download the image using curl:
```bash
curl -sL "https://github.com/user-attachments/assets/06a90208-d5fe-43fc-8e30-cb510150e1e0" -o /tmp/issue-124-screenshot.png
```

### 3. GitHub Returns HTML Instead of Image
Despite using `-L` (follow redirects) flag, the download sometimes fails and GitHub returns an HTML "Not Found" page:
```html
<!DOCTYPE html>
<html>
  <head>
    <title>Unicorn! &middot; GitHub</title>
    ...
```

This HTML content gets saved as a `.png` file.

### 4. Read Tool Attempts to Process HTML as Image
```json
{
  "type": "image",
  "source": {
    "type": "base64",
    "data": "PCFET0NUWVBFIGh0bWw+DQo8IS0tDQo..." // Decoded: "<!DOCTYPE html>..."
  }
}
```

### 5. Anthropic API Rejects Invalid Image
```
API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Could not process image"}}
```

## Why It Appears "Flaky"

The error appears random because:

1. **Temporary URL Expiration**: GitHub's S3 URLs include time-limited AWS signatures (`X-Amz-Expires=300` = 5 minutes)
2. **Race Conditions**: If the AI takes too long between detecting the redirect and downloading, the signed URL expires
3. **Retry Success**: On retry, a fresh request gets a new, valid signed URL
4. **Timing Variance**: Different execution paths and speeds lead to different outcomes

## The Real Issue

The problem is **NOT** with the Anthropic API. The API correctly rejects HTML content masquerading as an image. The real issues are:

1. **Incomplete Redirect Handling**: While `-L` flag is used, there's no verification that the download succeeded
2. **No Content Validation**: Downloaded files are not validated before being treated as images
3. **URL Expiration**: GitHub's time-limited S3 URLs can expire during processing
4. **Missing Error Detection**: No check for HTML error pages in downloaded content

## Evidence

### From Error Log
```javascript
// Base64 data decodes to:
<!DOCTYPE html>
<!--
Hello future GitHubber! ...
-->
<html>
  <head>
    <title>Unicorn! &middot; GitHub</title>
    ...
  </head>
  <body>
    <div class="container">
      <p>
        <img width="200" src="data:image/png;base64,..." />
      </p>
      <h1>404</h1>
      <p>This is not the web page you are looking for.</p>
      ...
    </div>
  </body>
</html>
```

This is GitHub's 404 "Unicorn" error page.

## Proposed Solutions

### Solution 1: Use GitHub CLI (Preferred)
Use `gh` CLI which handles authentication and redirects properly:
```bash
gh api "/repos/OWNER/REPO/issues/NUMBER" --jq '.body' |
  extract-images |
  download-with-gh-auth
```

### Solution 2: Validate Downloaded Content
```bash
curl -sL "$IMAGE_URL" -o /tmp/image.png
if file /tmp/image.png | grep -q "HTML"; then
  echo "Error: Downloaded HTML instead of image"
  exit 1
fi
```

### Solution 3: Use Our gh-issue-download Tool
The tool we already created in this PR handles this correctly:
- Downloads entire issue/PR content
- Extracts all images
- Downloads images with proper error handling
- Updates markdown to reference local files
- No Anthropic API calls needed for images

### Solution 4: Improve solve.mjs Instructions
Update system messages to:
1. Always use `gh-issue-download` or `gh-pr-download` for issues/PRs with images
2. Validate downloaded files before reading
3. Check file type with `file` command
4. Use `curl -L --fail` to fail fast on HTTP errors

## Impact Assessment

### Affected Operations
- Viewing images in GitHub issues
- Viewing images in GitHub PR descriptions
- Viewing images in issue/PR comments
- Any automated analysis requiring image content

### Severity
- **High**: Blocks automated issue/PR processing
- **Workaround exists**: Manual retry or use gh-issue-download tool
- **User Impact**: Requires manual intervention

## Recommendations

### Immediate Actions
1. ✅ Document root cause (this case study)
2. Update solve.mjs system messages to recommend gh-issue-download
3. Add file validation before Read tool calls
4. Test with multiple GitHub image URLs

### Long-term Improvements
1. Integrate gh-issue-download into solve.mjs workflow automatically
2. Add robust retry logic with exponential backoff
3. Implement content-type validation for all downloads
4. Create telemetry to track download success/failure rates

## Related Issues and PRs

### Error Examples
- [konard/hh-job-application-automation#125 (comment)](https://github.com/konard/hh-job-application-automation/pull/125#issuecomment-3642365155)
- [link-assistant/sales-audit-agent#6 (comment)](https://github.com/link-assistant/sales-audit-agent/pull/6#issuecomment-3643254991)
- [link-assistant/sales-audit-agent#6 (comment)](https://github.com/link-assistant/sales-audit-agent/pull/6#issuecomment-3643419988)
- [link-assistant/hive-mind#918](https://github.com/link-assistant/hive-mind/issues/918)

### Success Examples (After Retry)
- [konard/hh-job-application-automation#125 (comment)](https://github.com/konard/hh-job-application-automation/pull/125#issuecomment-3643256555)
- [link-assistant/sales-audit-agent#6 (comment)](https://github.com/link-assistant/sales-audit-agent/pull/6#issuecomment-3643447506)

### Successful Image Processing (Different Approach)
- [link-assistant/image-to-number](https://github.com/link-assistant/image-to-number) - Uses proper image handling

## Conclusion

The "Could not process image" error is **not** a flaky Anthropic API bug. It is a deterministic error that occurs when:

1. GitHub image URLs expire or redirect
2. curl downloads HTML error pages instead of images
3. The HTML content is mistakenly treated as image data
4. Anthropic API correctly rejects the invalid image data

The comprehensive solution is being developed in separate repositories:
- [gh-download-issue](https://github.com/link-foundation/gh-download-issue) - Issue #7
- [gh-download-pull-request](https://github.com/link-foundation/gh-download-pull-request) - Issue #7

These tools will properly handle GitHub's image URLs and download images to local files before processing. Integration with hive-mind will be done in #753.

For now, this PR implements a **minimal hotfix** by adding validation warnings to AI solver prompts to detect corrupted image downloads before they crash the solver.

## Appendix

### Log Files
- Error case: `logs/error-cases/hh-job-125-error-full.log` (201KB)
- Success case: `logs/success-cases/hh-job-125-success-full.log` (714KB)

### Future Work
- Comprehensive GitHub download tools: [gh-download-issue #7](https://github.com/link-foundation/gh-download-issue/issues/7)
- Comprehensive GitHub download tools: [gh-download-pull-request #7](https://github.com/link-foundation/gh-download-pull-request/issues/7)
- Integration with hive-mind: #753

### References
- Original issue: #597
- This PR: #610
- Inspiration: [gh-pull-all](https://github.com/link-foundation/gh-pull-all)
