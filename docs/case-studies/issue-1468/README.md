# Case Study: Issue #1468 - PR Verification Fails Due to GitHub API Eventual Consistency

## Summary

The `solve.mjs` auto-PR creation process successfully creates a pull request via `gh pr create`, but the immediately-following verification step (`gh pr view`) fails with a 404 because GitHub's API has not yet propagated the newly created resource. This is a **race condition** caused by GitHub's eventually consistent API.

## Affected Issue

- **Target Repository**: Jhon-Crow/godot-topdown-MVP
- **Target Issue**: [#1367](https://github.com/Jhon-Crow/godot-topdown-MVP/issues/1367)
- **Created PR**: [#1368](https://github.com/Jhon-Crow/godot-topdown-MVP/pull/1368)
- **Error**: `PR verification failed - gh pr create returned URL "https://github.com/Jhon-Crow/godot-topdown-MVP/pull/1368" but PR #1368 does not exist on GitHub`

## Timeline of Events

| Timestamp (UTC)              | Event                                                            |
| ---------------------------- | ---------------------------------------------------------------- |
| 2026-03-23T04:20:15.922Z     | solve.mjs v1.35.6 started                                        |
| 2026-03-23T04:20:22.085Z     | URL validated: Jhon-Crow/godot-topdown-MVP issue #1367           |
| 2026-03-23T04:20:22.696Z     | Fork mode enabled (no write access to target repo)               |
| 2026-03-23T04:20:28.338Z     | Fork validated: konard/Jhon-Crow-godot-topdown-MVP               |
| 2026-03-23T04:20:38.548Z     | Repository cloned to /tmp/gh-issue-solver-1774239626872          |
| 2026-03-23T04:20:40.661Z     | Branch created: issue-1367-72614cbb9a8f                          |
| 2026-03-23T04:20:40.765Z     | .gitkeep committed: b1a01403                                     |
| 2026-03-23T04:20:41.680Z     | Branch pushed to remote (exit code 0)                            |
| 2026-03-23T04:20:44.175Z     | Compare API confirms: 1 commit ahead of main                     |
| 2026-03-23T04:20:44.478Z     | Branch verified on GitHub                                        |
| 2026-03-23T04:20:45.948Z     | `gh pr create --draft` command executed                          |
| **2026-03-23T04:20:47.751Z** | **`gh pr create` returns URL: `.../pull/1368` (SUCCESS)**        |
| **2026-03-23T04:20:48.040Z** | **`gh pr view 1368` returns non-zero exit code (FAILURE — 404)** |
| 2026-03-23T04:20:48.041Z     | FATAL ERROR thrown: "PR verification failed"                     |

**Critical observation**: Only **289 milliseconds** elapsed between `gh pr create` returning the URL and `gh pr view` failing to find the PR.

## Root Cause Analysis

### Primary Root Cause: GitHub API Eventual Consistency

GitHub's API is **eventually consistent** for newly created resources. When `gh pr create` is called:

1. The GitHub API accepts the PR creation request
2. GitHub returns the PR URL immediately (HTTP 201 response with Location header)
3. The PR data is written to GitHub's backend asynchronously
4. Different API endpoints (REST, GraphQL) may see different states during propagation

The verification code at `src/solve.auto-pr.lib.mjs:1204-1233` queries the PR immediately after creation with **zero delay**:

```javascript
// Line 1204-1209: Verification happens immediately after gh pr create returns
const verifyResult = await $({
  silent: true,
})`gh pr view ${localPrNumber} --repo ${owner}/${repo} --json number,url,state 2>&1`;
```

This races against GitHub's backend propagation. In this case, the PR was created successfully (it was later merged at 07:58:46Z), but the verification check at +289ms found nothing.

### Ironic Contrast with Existing Code

The **same file** already implements exponential backoff retry for the compare API (lines 571-624):

```javascript
// Line 571-584: Existing retry logic for compare API
let compareReady = false;
let compareAttempts = 0;
const maxCompareAttempts = 5;

while (!compareReady && compareAttempts < maxCompareAttempts) {
  compareAttempts++;
  const waitTime = Math.min(2000 * compareAttempts, 10000); // 2s, 4s, 6s, 8s, 10s
  // ...
}
```

But the PR verification step (lines 1204-1233) has **no retry logic at all**.

### Evidence: PR Actually Existed

The PR was later found to be:

- **State**: closed (merged)
- **Created at**: 2026-03-23T04:20:47Z
- **Merged at**: 2026-03-23T07:58:46Z
- **Title**: "fix(#1367): update gas mask enemy grenade behavior"
- **Commits**: 5 commits, 182 additions, 12 deletions

This proves the PR was created successfully; only the verification timing was wrong.

## External Evidence

GitHub's API eventual consistency is a known issue documented across multiple projects:

1. **[cli/cli Issue #2311](https://github.com/cli/cli/issues/2311)**: `gh pr view` can't find PR just created — the canonical report of this exact bug
2. **[python/the-knights-who-say-ni Issue #86](https://github.com/python/the-knights-who-say-ni/issues/86)**: "On 404 responses it might be necessary to retry after a short sleep to let the system catch up with itself"
3. **[rust-lang/highfive Issue #190](https://github.com/rust-lang/highfive/issues/190)**: GitHub API returns 404 for newly created PRs; fix: "retry the request after 1 second"
4. **[GitHub Community Discussion #26333](https://github.com/orgs/community/discussions/26333)**: Race condition when creating and immediately modifying resources via the API
5. **[GitHub REST API Best Practices](https://docs.github.com/rest/guides/best-practices-for-using-the-rest-api)**: Recommends exponential backoff for retries

## Proposed Solutions

### Solution 1: Add Retry with Exponential Backoff to PR Verification (Recommended)

Add retry logic matching the existing compare API pattern:

```javascript
// Retry PR verification with exponential backoff
let prVerified = false;
let verifyAttempts = 0;
const maxVerifyAttempts = 5;

while (!prVerified && verifyAttempts < maxVerifyAttempts) {
  verifyAttempts++;
  const waitTime = Math.min(2000 * verifyAttempts, 10000);

  if (verifyAttempts > 1) {
    await log(`   Retry ${verifyAttempts}/${maxVerifyAttempts}: Waiting ${waitTime}ms for PR to propagate...`);
  }

  await new Promise(resolve => setTimeout(resolve, waitTime));

  const verifyResult = await $({ silent: true })`gh pr view ${localPrNumber} --repo ${owner}/${repo} --json number,url,state 2>&1`;

  if (verifyResult.code === 0) {
    // PR found, verify data
    prVerified = true;
  }
}
```

**Pros**: Follows existing codebase pattern, handles race condition gracefully, minimal code change
**Cons**: Adds up to ~30 seconds delay in worst case (acceptable since it only triggers on transient failures)

### Solution 2: Trust gh pr create Output

Skip verification entirely when `gh pr create` exits with code 0 and returns a valid URL:

**Pros**: Simplest fix, no delay added
**Cons**: Loses the safety net of verification (which protects against other failure modes)

### Solution 3: Use GraphQL API for PR Creation + Verification

Use a single GraphQL mutation to create the PR and get back the PR data atomically.

**Pros**: Eliminates the race condition entirely
**Cons**: Major refactor, loses `gh pr create` CLI convenience

## Recommended Implementation

**Solution 1** is recommended because it:

- Follows the established pattern already in the codebase (compare API retry at line 571)
- Is a minimal, focused change
- Handles the race condition gracefully
- Preserves the verification safety net
- Has been validated by multiple open-source projects as the correct approach

## Impact Assessment

- **Severity**: High — blocks entire automated PR creation workflow
- **Frequency**: Low to Medium — depends on GitHub API load and geographic proximity to GitHub's servers
- **User Impact**: Full failure of solve session; manual intervention required
- **Fix Risk**: Very Low — adding retry logic is well-understood and safe

## References

1. Original failure log: [Issue comment](https://github.com/Jhon-Crow/godot-topdown-MVP/issues/1367#issuecomment-4108284673)
2. Full failure log: `docs/case-studies/issue-1468/original-failure-comment.md`
3. Source file: `src/solve.auto-pr.lib.mjs` (lines 1204-1233 — PR verification)
4. Related case study: `data/case-studies/issue-683-pr-creation-failure.md` (different root cause, same area)
5. Issue: [hive-mind #1468](https://github.com/link-assistant/hive-mind/issues/1468)
