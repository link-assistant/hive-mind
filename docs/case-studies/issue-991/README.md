# Case Study: Issue #991 - URL Hash Fragment Parsing Bug

## Executive Summary

This case study analyzes issue #991, where GitHub URLs containing hash fragments (e.g., `#issuecomment-123`) were incorrectly parsed, causing the solve command to fail when users provided PR or issue URLs that linked directly to specific comments. The issue was discovered on 2025-12-25 when a user attempted to run the solve command with a PR comment URL.

## Issue Overview

**Issue Number:** #991
**Title:** Issue with hash tag should pass validation, as we have issue number and can get to work
**Reported By:** konard
**Date Reported:** 2025-12-25
**Status:** Fixed in PR #992
**Labels:** bug

### Problem Statement

When attempting to solve a PR using a URL that included a hash fragment pointing to a specific comment:

```
https://github.com/tool2agent/tool2agent/pull/9#issuecomment-3691329187
```

The solve command failed with:

```
no pull requests found for branch "9#issuecomment-3691329187"
```

The PR number was being incorrectly parsed as `9#issuecomment-3691329187` instead of just `9`.

### Error Timeline Reconstruction

Based on the log from the issue:

1. User ran solve command with PR comment URL
2. URL validation passed (correctly recognized as PR URL)
3. URL component parsing incorrectly extracted `9#issuecomment-3691329187` as the PR number
4. GitHub CLI command `gh pr view` failed because no PR with that number exists
5. Error reported: "no pull requests found for branch"

## Technical Analysis

### Root Cause

The bug was in the `parseUrlComponents` function in `src/solve.validation.lib.mjs`:

```javascript
// BUGGY CODE
export const parseUrlComponents = issueUrl => {
  const urlParts = issueUrl.split('/');
  return {
    owner: urlParts[3],
    repo: urlParts[4],
    urlNumber: urlParts[6], // Could be issue or PR number
  };
};
```

This function used a simple `split('/')` to parse the URL without first stripping the hash fragment. For a URL like:

```
https://github.com/tool2agent/tool2agent/pull/9#issuecomment-3691329187
```

The split result would be:

- `urlParts[0]` = "https:"
- `urlParts[1]` = ""
- `urlParts[2]` = "github.com"
- `urlParts[3]` = "tool2agent" (owner - correct)
- `urlParts[4]` = "tool2agent" (repo - correct)
- `urlParts[5]` = "pull"
- `urlParts[6]` = "9#issuecomment-3691329187" (INCORRECT - should be "9")

### Why validateGitHubUrl() Passed

The `validateGitHubUrl` function was working correctly because it uses `parseGitHubUrl` internally, which properly uses the JavaScript `URL` object:

```javascript
urlObj = new globalThis.URL(normalizedUrl);
const pathParts = urlObj.pathname.split('/').filter(p => p);
```

The `URL` object automatically separates the pathname from the hash fragment, so `urlObj.pathname` correctly contained `/tool2agent/tool2agent/pull/9` without the hash.

### The Problem Flow

1. `validateGitHubUrl(issueUrl)` - PASSED (uses proper URL parsing)
2. `parseUrlComponents(issueUrl)` - FAILED (simple string split, no hash handling)

The issue was that `solve.mjs` called both functions but used `parseUrlComponents` to extract the PR number, ignoring the correctly parsed values from `validateGitHubUrl`.

## Solution

### Fix 1: Use Values from validateGitHubUrl

The primary fix modifies `solve.mjs` to use the already correctly parsed values from `validateGitHubUrl`:

```javascript
// BEFORE
const { isIssueUrl, isPrUrl, normalizedUrl } = urlValidation;
// ... later ...
const { owner, repo, urlNumber } = parseUrlComponents(issueUrl);

// AFTER
const { isIssueUrl, isPrUrl, normalizedUrl, owner, repo, number: urlNumber } = urlValidation;
// parseUrlComponents call removed - values already available
```

### Fix 2: Update parseUrlComponents for Safety

The `parseUrlComponents` function was also fixed to handle hash fragments correctly for any future use:

```javascript
// FIXED CODE
export const parseUrlComponents = issueUrl => {
  // Remove hash fragment before parsing (e.g., #issuecomment-123, #discussion_r456)
  const urlWithoutHash = issueUrl.split('#')[0];
  const urlParts = urlWithoutHash.split('/');
  return {
    owner: urlParts[3],
    repo: urlParts[4],
    urlNumber: urlParts[6],
  };
};
```

## Common GitHub URL Hash Fragments

GitHub URLs can include various hash fragments to link to specific content:

| Fragment Pattern          | Description                     | Example                     |
| ------------------------- | ------------------------------- | --------------------------- |
| `#issuecomment-{id}`      | Link to a specific comment      | `#issuecomment-3691329187`  |
| `#discussion_r{id}`       | Link to a PR review comment     | `#discussion_r1234567`      |
| `#pullrequestreview-{id}` | Link to a PR review             | `#pullrequestreview-999999` |
| `#event-{id}`             | Link to an issue event          | `#event-12345678`           |
| `#ref-{type}:{id}`        | Link to a reference             | `#ref-commit:abc123`        |
| `#diff-{hash}`            | Link to a specific diff section | `#diff-abc123`              |

All of these should now be correctly handled.

## Testing

A comprehensive test suite was added in `tests/test-url-hash-fragment.mjs` with 15 test cases covering:

1. `parseGitHubUrl` - Hash fragment handling
2. `validateGitHubUrl` - Hash fragment handling
3. `parseUrlComponents` - Bug fix verification
4. Edge cases (empty hash, multiple hashes, query params + hash)

### Test Results

```
===========================================
Results: 15 passed, 0 failed
===========================================

All tests passed!
```

## Lessons Learned

1. **DRY Principle**: The same URL parsing was done twice - once properly (in `validateGitHubUrl`) and once incorrectly (in `parseUrlComponents`). The fix consolidates to use the correct parsing result.

2. **URL Specification Awareness**: Hash fragments in URLs are separated from the path and should always be stripped before path-based parsing.

3. **Defense in Depth**: Even though `parseUrlComponents` is no longer called in the main flow, it was fixed anyway to prevent future bugs if it's used elsewhere.

## Files Changed

| File                                    | Change Description                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/solve.mjs`                         | Extract owner, repo, number from validateGitHubUrl instead of calling parseUrlComponents |
| `src/solve.validation.lib.mjs`          | Fix parseUrlComponents to strip hash fragment before parsing                             |
| `tests/test-url-hash-fragment.mjs`      | New test file with 15 test cases                                                         |
| `experiments/test-hash-url-parsing.mjs` | Experiment script for bug reproduction and verification                                  |

## References

- [RFC 3986 - URI Generic Syntax](https://datatracker.ietf.org/doc/html/rfc3986#section-3.5) - Definition of fragment component
- [MDN URL API](https://developer.mozilla.org/en-US/docs/Web/API/URL) - JavaScript URL object documentation
- [GitHub Deep Links](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/autolinked-references-and-urls) - GitHub URL fragment documentation
