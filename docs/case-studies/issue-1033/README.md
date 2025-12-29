# Case Study: Image Upload Failures in Private Repository PR Comments

**Issue:** [#1033 - Uploading of images to comments didn't work](https://github.com/link-assistant/hive-mind/issues/1033)
**Date:** 2025-12-29
**Status:** Analysis Complete

## Executive Summary

This case study investigates why images in a PR comment were not displayed in a private GitHub repository (`kogeletey/egida-test`), while the same approach worked correctly in a public repository (`konard/high-performance-gaussian-splatting`).

**Root Cause:** The AI agent uploaded screenshots to the repository branch and referenced them using `raw.githubusercontent.com` URLs, which **do not work for private repositories** without authentication.

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
2. **raw.githubusercontent.com requires authentication for private repos:** Unlike public repos, accessing raw files from private repos requires:
   - GitHub authentication token in request headers
   - OR authenticated browser session (cookies)
3. **GitHub returns 404:** For security reasons, GitHub returns 404 (not 403) to avoid leaking private repo existence

### Contrast with Working Example

The successful PR (#15 in `konard/high-performance-gaussian-splatting`) used identical URL pattern:

```markdown
![Updated Design](https://github.com/konard/high-performance-gaussian-splatting/blob/issue-14-450f7123a953/screenshots/new-design.png?raw=true)
```

**Key difference:** `konard/high-performance-gaussian-splatting` is a **public repository**, so raw URLs work without authentication.

## Root Causes Identified

### Primary Cause

**The AI agent was not aware that `raw.githubusercontent.com` URLs don't work for private repositories.**

The same approach that works for public repos fails silently for private repos - viewers without authentication see broken images (404).

### Contributing Factors

1. **GitHub Gist limitation:** `gh gist create` doesn't support binary files, which prevented the initial fallback approach
2. **No GitHub API for image uploads:** GitHub doesn't provide a REST API for uploading images to issue/PR comments (like the web drag-and-drop does)
3. **Missing instructions:** The system prompt doesn't include guidance about private repo image handling

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

## Proposed Solutions

### Solution 1: Use External Image Hosting (Recommended)

Upload images to a service that provides public URLs, then embed those URLs in comments.

**Options:**

- **imgbb.com** - Free image hosting API
- **Cloudinary** - Robust media hosting with API
- **GitHub Gist with base64** - Encode images as base64 in a text file

**Pros:** Works regardless of repository visibility
**Cons:** Requires API keys for external services

### Solution 2: Use GitHub User Attachments API (Limited)

GitHub's `user-attachments` URLs work for private repos when the user has access. However:

- There's no official API for uploading these programmatically
- The web interface creates these via drag-and-drop

**Workaround:** Automate browser interaction to upload images via GitHub web interface.

### Solution 3: Detect Private Repos and Warn

Add detection logic to warn when attempting to reference images in private repos:

```javascript
// Pseudo-code for system prompt enhancement
if (repo.isPrivate && imageUrl.includes('raw.githubusercontent.com')) {
  warn("Images from private repos won't display for unauthenticated viewers");
  suggestAlternative('Upload to external image hosting or use base64 inline');
}
```

### Solution 4: Use Base64 Inline Images (Limited)

Embed small images directly in markdown using data URIs:

```markdown
![Small Icon](data:image/png;base64,iVBORw0KGgoAAAANS...)
```

**Pros:** No external dependencies
**Cons:** GitHub may strip large data URIs; bloats comment size

### Solution 5: Enhanced System Prompt

Add guidance to the AI agent's system prompt:

```
When uploading screenshots or images to GitHub comments:
- For PUBLIC repositories: Commit images to branch and use raw.githubusercontent.com URLs
- For PRIVATE repositories: Use external image hosting (imgbb, cloudinary) OR encode as base64 gist
- NEVER use raw.githubusercontent.com URLs for private repos - they will return 404 for viewers
```

## Recommended Implementation

### Short Term (Immediate Fix)

1. Update `src/claude.prompts.lib.mjs` to include private repository image handling guidance
2. Add detection for private repositories before suggesting image upload methods

### Long Term (Robust Solution)

1. Integrate with external image hosting service (e.g., imgbb or Cloudinary)
2. Create helper function for uploading and obtaining public image URLs
3. Fall back gracefully when gist binary upload fails

## Files for Reference

- `logs/failed-session-log.txt` - Complete session log from the failed image upload (6107 lines)
- `logs/successful-pr-comments-raw.json` - Comments from successful public repo PR

## External References

- [GitHub Discussion: raw.githubusercontent.com 404 for private repos](https://github.com/orgs/community/discussions/53538)
- [GitHub Discussion: API for uploading images to comments](https://github.com/orgs/community/discussions/28219)
- [GitHub CLI Issue: Upload files to PRs/Issues](https://github.com/cli/cli/issues/1895)
- [Codegenes: Downloading from private repos](https://www.codegenes.net/blog/how-can-i-download-a-single-raw-file-from-a-private-github-repo-using-the-command-line/)

## Conclusion

The image upload failure was caused by using `raw.githubusercontent.com` URLs for a private repository. This approach works for public repos but fails silently for private ones. The solution requires either using external image hosting services or implementing browser automation for GitHub's web-based image upload.

The AI agent correctly identified that gist binary uploads don't work and chose an alternative (committing to branch), but was not aware that this alternative fails for private repositories.
