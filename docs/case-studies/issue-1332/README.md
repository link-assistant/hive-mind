# Case Study: Issue #1332 - Error: Fork not accessible

## Executive Summary

When `solve.mjs` is invoked with a PR URL pointing to a cross-repository PR (i.e., a PR from a fork), and the PR's target repository (the base repository) is itself a fork with a different name than the head repository, the tool fails to locate the contributor's fork because it constructs the fork name using the wrong repository name.

**Error observed:**

```
❌ Error:                    Fork not accessible
   Fork:                     MILANA808/konard-MILANA808-Milana-backend
   Suggestion:               The PR may be from a fork you no longer have access to
   Hint:                     Try running with --fork flag to use your own fork instead
```

The fork `MILANA808/konard-MILANA808-Milana-backend` does not exist. The actual contributor's repository is `MILANA808/Milana-backend`.

## Data Sources

- **Original log:** [solve-2026-02-17T23-23-27-055Z.log](https://gist.github.com/konard/9ca098b1e148874ddab3bc80a7d01200) (also saved locally as [original-log.log](./original-log.log))
- **Issue:** https://github.com/link-assistant/hive-mind/issues/1332
- **Solve command:** `solve https://github.com/konard/MILANA808-Milana-backend/pull/2#issuecomment-3917516653 --attach-logs --verbose --no-tool-check --auto-resume-on-limit-reset --auto-restart-until-mergeable --tokens-budget-stats`
- **PR being processed:** https://github.com/konard/MILANA808-Milana-backend/pull/2
- **Version:** solve v1.23.12

## Timeline of Events

| Time (UTC)          | Event                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------- |
| 2026-02-17T23:23:27 | `solve.mjs` started with `--no-tool-check` (skipping GitHub authentication check)        |
| 2026-02-17T23:23:32 | Disk/memory checks passed. Checks skipped due to `--no-tool-check`                       |
| 2026-02-17T23:23:33 | Repository visibility detected as `public`                                               |
| 2026-02-17T23:23:33 | Write access confirmed for `konard/MILANA808-Milana-backend`                             |
| 2026-02-17T23:23:34 | Continue mode activated: PR URL provided directly → `prNumber = 2`                       |
| 2026-02-17T23:23:34 | **Fork PR detected**: `forkOwner = MILANA808`, logged as `from MILANA808/Milana-backend` |
| 2026-02-17T23:23:34 | **Bug**: Fork name built as `MILANA808/konard-MILANA808-Milana-backend` (wrong!)         |
| 2026-02-17T23:23:34 | `gh repo view MILANA808/konard-MILANA808-Milana-backend` → fails (repo does not exist)   |
| 2026-02-17T23:23:34 | **Error**: "Fork not accessible" → `safeExit(1, 'Repository setup failed')`              |

**Total time to failure:** ~7 seconds

## Repository Topology (Context)

```
MILANA808/Milana-backend          ← Original repo (not a fork)
    └── konard/MILANA808-Milana-backend  ← konard's fork of MILANA808's repo
                ↑
        PR #2: MILANA808/Milana-backend → konard/MILANA808-Milana-backend
        (MILANA808 submitting code back to konard's fork)
```

The scenario:

- **Base repo** (where PR targets): `konard/MILANA808-Milana-backend` — this is konard's fork
- **Head repo** (where PR comes from): `MILANA808/Milana-backend` — this is the original

When `solve` parses:

- `owner = konard`, `repo = MILANA808-Milana-backend`
- `headRepositoryOwner.login = MILANA808` (different from `konard`) → triggers fork detection
- `headRepository.name = Milana-backend` ← **the actual repo name for MILANA808's account**

## Root Cause Analysis

### Primary Root Cause: Fork name constructed using base repo name instead of head repo name

In `src/solve.repository.lib.mjs`, when handling a PR from a fork (Priority 2 path), the code constructs fork names using `repo` (the **base** repository name), not the **head** repository name:

```javascript
// Line 824-827 in src/solve.repository.lib.mjs
const standardForkName = `${forkOwner}/${repo}`;
//                         MILANA808 / MILANA808-Milana-backend  ← WRONG
const prefixedForkName = `${forkOwner}/${owner}-${repo}`;
//                         MILANA808 / konard-MILANA808-Milana-backend  ← ALSO WRONG

// The correct name should use headRepository.name:
// MILANA808 / Milana-backend  ← CORRECT
```

The `forkRepoName` (derived from `headRepository.name`) **is captured** in `solve.mjs` at lines 460 and 380:

```javascript
// solve.mjs line 460
const forkRepoName = prData.headRepository && prData.headRepository.name ? prData.headRepository.name : repo;
await log(`🍴 Detected fork PR from ${forkOwner}/${forkRepoName}`);
// → correctly logs "from MILANA808/Milana-backend"
```

However, `forkRepoName` is **only used for logging** — it is never passed to `setupRepository` or `setupRepositoryAndClone`. The actual fork name resolution logic in `solve.repository.lib.mjs` only receives `forkOwner` and uses the `repo` variable from the function parameters.

### Secondary Root Cause: Inconsistency between logged fork name and used fork name

The log shows:

```
🍴 Detected fork PR from MILANA808/Milana-backend   ← correctly identified
   Fork owner: MILANA808
   Will clone fork repository for continue mode

🍴 Fork mode:                DETECTED from PR
   Fork owner:               MILANA808
✅ Using fork:               MILANA808/konard-MILANA808-Milana-backend  ← WRONG!
```

The tool correctly identifies the fork as `MILANA808/Milana-backend` but then uses a completely different (incorrect) name when trying to clone. This inconsistency causes confusion for the user reading logs.

### Tertiary Root Cause: Error message is misleading

The error message says:

```
Suggestion: The PR may be from a fork you no longer have access to
Hint:        Try running with --fork flag to use your own fork instead
```

Both suggestions are incorrect and unhelpful:

1. The PR is from a valid, accessible public repository (`MILANA808/Milana-backend`)
2. The `--fork` flag would create a new fork under konard's account, which is not the intent when continuing work on a PR from a fork
3. The real problem is an incorrect fork name computation

### Supporting Evidence

Verified via GitHub API:

- `MILANA808/konard-MILANA808-Milana-backend` → **404 Not Found** (the name the tool tried)
- `MILANA808/Milana-backend` → **exists, public** (the correct name)
- `MILANA808/MILANA808-Milana-backend` → not verified (would also likely 404)

## Related Scenario: When Does This Trigger?

This bug triggers when **all** of these conditions are met:

1. User provides a PR URL pointing to a repository that is itself a fork (`konard/MILANA808-Milana-backend` is a fork of `MILANA808/Milana-backend`)
2. The PR's head repository has a **different name** than the base repository (head: `Milana-backend`, base: `MILANA808-Milana-backend`)
3. `--fork` flag is NOT used (so the code falls into "Priority 2" fork mode)
4. `--prefix-fork-name-with-owner-name` is NOT enabled (standard names tried first)

## GitHub API Behavior: `headRepository.nameWithOwner` Returns Empty String

An additional observed anomaly: when fetching the PR via `gh pr view --json headRepository`, the field `headRepository.nameWithOwner` returns `""` (empty string) even though `headRepository.name = "Milana-backend"` and `headRepositoryOwner.login = "MILANA808"`.

```json
{
  "headRepository": {
    "id": "R_kgDOQKgqpQ",
    "name": "Milana-backend",
    "nameWithOwner": ""   ← empty!
  },
  "headRepositoryOwner": {
    "login": "MILANA808",
    "name": "ALFIIA"
  }
}
```

This is a known GitHub GraphQL API behavior where `nameWithOwner` may be empty for cross-repository PRs in certain scenarios. A similar issue was reported in [opencode#13812](https://github.com/anomalyco/opencode/issues/13812) where code accessing `prData.headRepository.nameWithOwner` crashed with "null is not an object".

The current `hive-mind` code uses `headRepository.name` (not `nameWithOwner`), which is correct and avoids that crash — but the name is still not propagated correctly to the fork setup logic.

## Proposed Solutions

### Solution 1 (Recommended): Pass `forkRepoName` to `setupRepository`

Pass the actual head repository name (`headRepository.name`) alongside `forkOwner` to `setupRepositoryAndClone` and `setupRepository`, so the fork name can be constructed correctly.

**Changes needed:**

1. In `src/solve.mjs`: pass `forkRepoName` alongside `forkOwner` to `setupRepositoryAndClone`
2. In `src/solve.repo-setup.lib.mjs`: pass `forkRepoName` to `setupRepository`
3. In `src/solve.repository.lib.mjs`: use `forkRepoName` (if provided) in fork name construction instead of `repo`

**Expected behavior after fix:**

```
✅ Using fork:               MILANA808/Milana-backend   ← correct!
✅ Fork verified:            MILANA808/Milana-backend is accessible
```

### Solution 2: Look up head repo name from PR data in `setupRepository`

Inside `setupRepository`, when `forkOwner` is provided, query the PR's head repository name from the GitHub API directly instead of guessing from the base repo name.

**Drawback:** Requires additional API call inside setup; more complex.

### Solution 3 (Workaround for users): Use `--fork` flag

When `--fork` is specified, the tool creates a new fork under the authenticated user's account (konard) instead of trying to use the contributor's fork. This bypasses the bug entirely.

**Limitation:** Only works if the user is the base repo owner and has fork creation rights. Does not allow continuing on the contributor's fork.

## Improvements to Suggestion Messages

The error output should be improved when the fork is not found. Currently:

```
❌ Error:      Fork not accessible
   Fork:       MILANA808/konard-MILANA808-Milana-backend
   Suggestion: The PR may be from a fork you no longer have access to
   Hint:       Try running with --fork flag to use your own fork instead
```

Improved version should:

1. Show what the code **tried** to find vs. what was expected
2. Explain that the issue may be a fork name mismatch (not access loss)
3. Suggest checking if `headRepository.name` from the PR data could be the correct fork name

Example:

```
❌ Error:      Fork not accessible
   Fork tried: MILANA808/konard-MILANA808-Milana-backend (did not exist)
   Head repo:  MILANA808/Milana-backend (from PR data)
   Suggestion: The fork repo name may differ from the base repo name.
               Try: solve <url> --fork
               Or verify: gh repo view MILANA808/Milana-backend
```

## Output Consistency Issues

The log shows an inconsistency between two stages:

1. **PR parsing stage** (solve.mjs): correctly identifies `MILANA808/Milana-backend`
2. **Repository setup stage** (solve.repository.lib.mjs): incorrectly constructs `MILANA808/konard-MILANA808-Milana-backend`

This inconsistency means users reading logs see conflicting information. A fix should ensure these two stages agree on the fork repository name.

## Related Issues

- [Issue #439](https://github.com/link-assistant/hive-mind/issues/439): "We should fail early on no access to repository without --fork option" — a similar class of problem where the tool fails after wasting time
- [Issue #967](https://github.com/link-assistant/hive-mind/issues/967): Fork parent mismatch validation
- [Issue #1311](https://github.com/link-assistant/hive-mind/issues/1311): Fork validation false positive due to network timeout
- [opencode#13812](https://github.com/anomalyco/opencode/issues/13812): Similar `nameWithOwner` empty string crash in opencode

## External References

- [GitHub REST API: PR head repository](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request)
- [GitHub GraphQL: headRepository field](https://docs.github.com/en/graphql/reference/objects#pullrequest)
- [gh CLI issue #2143: gh pr has stopped detecting the fork](https://github.com/cli/cli/issues/2143)
- [gh CLI issue #6462: gh and REST API unable to work with same-org forked repos](https://github.com/cli/cli/issues/6462)
