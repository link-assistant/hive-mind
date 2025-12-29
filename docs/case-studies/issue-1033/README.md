# Case Study: Image Upload Failures in Private Repository PR Comments

**Issue:** [#1033 - Uploading of images to comments didn't work](https://github.com/link-assistant/hive-mind/issues/1033)
**Date:** 2025-12-29
**Status:** Analysis Complete

## Executive Summary

This case study investigates why images in a PR comment were not displayed in a private GitHub repository (`kogeletey/egida-test`), while the same approach worked correctly in a public repository (`konard/high-performance-gaussian-splatting`).

**Root Cause:** The AI agent uploaded screenshots to the repository branch and referenced them using `raw.githubusercontent.com` URLs. These URLs **do not support authentication at all** - even authenticated users with access to the private repository cannot view the images because the browser's HTTP requests to fetch images cannot carry GitHub authentication tokens.

## Timeline of Events

### Working Session (2025-12-29T19:06:00Z - 2025-12-29T19:15:00Z)

| Time (UTC) | Event                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------- |
| 19:06:00   | AI work session started on PR #4 in `kogeletey/egida-test`                                      |
| 19:07:00   | Attempted to download Figma design image - GitHub asset URL returned 404 initially              |
| 19:09:43   | First screenshot attempt failed due to Playwright MCP path restriction                          |
| 19:09:48   | Successfully captured `current-implementation.png` using relative filename                      |
| 19:10:00   | Downloaded Figma design image with GitHub token authentication                                  |
| 19:13:11   | Captured `updated-implementation.png` after design adjustments                                  |
| 19:14:07   | **Key Failure:** Attempted `gh gist create` with binary files - got "binary file not supported" |
| 19:14:16   | **Alternative taken:** Committed screenshots directly to branch `issue-3-f18b9a29708e`          |
| 19:14:25   | Posted PR comment with `raw.githubusercontent.com` URLs                                         |
| 19:15:04   | Session ended                                                                                   |

## Problem Analysis

### The Problematic Comment

Comment ID: `3697298651` posted to [PR #4](https://github.com/kogeletey/egida-test/pull/4#issuecomment-3697298651)

**Image References Used:**

```markdown
![Figma Design](https://raw.githubusercontent.com/kogeletey/egida-test/issue-3-f18b9a29708e/figma-design.png)
![Previous Implementation](https://raw.githubusercontent.com/kogeletey/egida-test/issue-3-f18b9a29708e/current-implementation.png)
![Updated Implementation](https://raw.githubusercontent.com/kogeletey/egida-test/issue-3-f18b9a29708e/updated-implementation.png)
```

### Why Images Don't Display

1. **Repository is private:** `kogeletey/egida-test` is a private repository
2. **raw.githubusercontent.com does NOT support authentication:** This is the critical finding. When you include an authentication token in requests to `raw.githubusercontent.com`, it is simply **ignored**. There is no way to authenticate with this service.
3. **Browser cannot pass authentication:** When GitHub's web interface renders Markdown containing image URLs, the browser makes separate HTTP requests to fetch those images. These requests cannot carry GitHub authentication tokens, so even authenticated users see 404 errors.
4. **GitHub returns 404:** For security reasons, GitHub returns 404 (not 403) to avoid leaking private repo existence

### Technical Deep Dive

According to [GitHub Community Discussion #160828](https://github.com/orgs/community/discussions/160828):

> "As far as I can tell, raw.githubusercontent.com doesn't actually support authentication at all. You can throw your personal access token in the header, but it's ignored - no rate limit headers, no feedback, nothing. A 200 response doesn't mean authentication worked - it just means the file exists and was public anyway."

The only official way to do authenticated access to raw files is via the GitHub REST API (`/repos/:owner/:repo/contents/:path`), which provides proper rate limit headers and actually respects authentication tokens. However, this API returns base64-encoded content, not raw binary, making it unsuitable for embedding images in Markdown comments.

### Contrast with Working Example

The successful PR (#15 in `konard/high-performance-gaussian-splatting`) used identical URL pattern:

```markdown
![Updated Design](https://github.com/konard/high-performance-gaussian-splatting/blob/issue-14-450f7123a953/screenshots/new-design.png?raw=true)
```

**Key difference:** `konard/high-performance-gaussian-splatting` is a **public repository**, so raw URLs work without authentication.

## Root Causes Identified

### Primary Cause

**The `raw.githubusercontent.com` service does not support authentication at all.**

This means that:

- Even users who are logged into GitHub and have full access to the private repository cannot view images
- Including authentication tokens in requests has no effect - they are ignored
- The same approach that works for public repos fails completely for private repos

### Contributing Factors

1. **GitHub Gist limitation:** `gh gist create` doesn't support binary files, which prevented the initial fallback approach
2. **No GitHub API for image uploads:** GitHub doesn't provide a REST API for uploading images to issue/PR comments (like the web drag-and-drop does)
3. **Missing instructions:** The system prompt didn't include guidance about private repo image handling

## Detailed Evidence

### Failed Gist Upload Attempt (from logs)

```json
{
  "command": "gh gist create /tmp/.../figma-design.png /tmp/.../current-implementation.png /tmp/.../updated-implementation.png --desc \"Screenshots comparison for PR #4\"",
  "result": "Exit code 1\nfailed to collect files for posting: failed to upload .../figma-design.png: binary file not supported"
}
```

### Successful Commit to Branch

```json
{
  "command": "cp screenshots to repo && git add && git commit && git push",
  "result": "[issue-3-f18b9a29708e d24cdca] docs: add screenshots for design comparison\n 3 files changed, 0 insertions(+), 0 deletions(-)\n create mode 100644 current-implementation.png\n create mode 100644 figma-design.png\n create mode 100644 updated-implementation.png"
}
```

## Solution

### Enhanced System Prompt

Added guidance to the AI agent's system prompt in all prompt files (`src/*.prompts.lib.mjs`):

```
Uploading images to GitHub comments.
   - When you need to share screenshots or images in PR/issue comments, be aware of repository visibility:
      For PUBLIC repositories: You can commit images to the branch and reference them using raw.githubusercontent.com URLs (e.g., https://raw.githubusercontent.com/owner/repo/branch/path/to/image.png). These URLs work without authentication.
      For PRIVATE repositories: NEVER use raw.githubusercontent.com URLs - they will return 404 even for authenticated viewers. This is because raw.githubusercontent.com does not support authentication at all - the browser's HTTP requests to fetch images cannot carry GitHub authentication tokens. Instead, use base64 encoding for small images by embedding them directly in markdown using data URIs.
```

## Files for Reference

- `logs/failed-session-log.txt` - Complete session log from the failed image upload (6107 lines)
- `logs/successful-pr-comments-raw.json` - Comments from successful public repo PR

## External References

- [GitHub Discussion: raw.githubusercontent.com authentication](https://github.com/orgs/community/discussions/160828)
- [GitHub Discussion: raw.githubusercontent.com 404 for private repos](https://github.com/orgs/community/discussions/53538)
- [GitHub Discussion: API for uploading images to comments](https://github.com/orgs/community/discussions/28219)
- [GitHub CLI Issue: Upload files to PRs/Issues](https://github.com/cli/cli/issues/1895)

## Conclusion

The image upload failure was caused by using `raw.githubusercontent.com` URLs for a private repository. The critical finding is that **raw.githubusercontent.com does not support authentication at all** - even authenticated users cannot view images from private repos because browser HTTP requests cannot carry GitHub authentication tokens.

For private repositories, the only viable solution for embedding images in Markdown comments is to use base64-encoded data URIs for small images. This approach embeds the image data directly in the Markdown, bypassing the authentication problem entirely.
