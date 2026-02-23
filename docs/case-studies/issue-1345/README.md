# Case Study: Issue #1345 — `--auto-restart-until-mergeable` Stuck on No CI/CD Checks

## Overview

**Issue:** [`link-assistant/hive-mind#1345`](https://github.com/link-assistant/hive-mind/issues/1345)
**Fix PR:** [`link-assistant/hive-mind#1347`](https://github.com/link-assistant/hive-mind/pull/1347)
**Affected Command:** `--auto-restart-until-mergeable`
**Symptom:** Infinite loop printing "CI/CD checks have not started yet (waiting for checks to appear)"
**Root Cause:** Code assumed `no CI checks = race condition`, but didn't account for repos with no CI/CD configured

---

## Timeline of Events

### 2026-02-20T10:05:48Z — Solve starts

The hive-mind AI solver was invoked on a pull request in a repository (`PavelChurkin/resource-based-economy-Article`) with no GitHub Actions workflows configured:

```
solve https://github.com/PavelChurkin/resource-based-economy-Article/issues/3 \
  --attach-logs --verbose --auto-restart-until-mergeable
```

### 2026-02-20T10:14:28Z — Auto-restart mode activated

The initial AI session completed. The `--auto-restart-until-mergeable` monitoring loop began.

### 2026-02-20T10:14:32Z — First check, infinite loop begins

```
⏳ Waiting for CI: CI/CD checks have not started yet (waiting for checks to appear)
```

### 2026-02-20T10:14:32Z — ~11:55:00Z (≈101 minutes)

The system polled GitHub every ~60 seconds, logging the same message repeatedly. The loop never exited because:

- The repository had zero GitHub Actions workflows
- `getDetailedCIStatus` returned `{ status: 'no_checks', checks: [] }`
- The code treated `no_checks` as a race condition (push → checks haven't started)
- It never checked whether the PR was actually already mergeable without CI

### 2026-02-20T?? — Manually stopped

The process was stopped manually because it was stuck.

---

## Root Cause Analysis

### The Problematic Code Path

```
getMergeBlockers()
  └─ getDetailedCIStatus() → { status: 'no_checks', checks: [] }
     └─ [Old code] ALWAYS adds ci_pending blocker:
        { type: 'ci_pending', message: 'CI/CD checks have not started yet...' }
     └─ checkPRMergeable() → { mergeable: true, reason: null }  ← this was IGNORED
  └─ Returns blockers: [ci_pending]  ← always non-empty → never exits loop
```

### Why This Happened

The `getMergeBlockers` function in `src/solve.auto-merge.lib.mjs` (pre-fix, line 189-195):

```javascript
if (ciStatus.status === 'no_checks') {
  // No CI checks exist yet - race condition after push, treat as pending
  blockers.push({
    type: 'ci_pending',
    message: 'CI/CD checks have not started yet (waiting for checks to appear)',
    details: [],
  });
}
```

The comment says "treat as pending" — correct for the race condition case, but **wrong** for repos with no CI/CD.

The function also called `checkPRMergeable()` (line 266-273), which would return `{ mergeable: true }` for repos without required CI checks (GitHub's `mergeStateStatus` would be `CLEAN`). But this mergeability result was only checked **after** the CI check, and the early CI blocker addition meant the function would always return at least one blocker.

### GitHub's Mergeability vs. CI Checks

GitHub handles these independently:

- **Check runs** (`/commits/{sha}/check-runs`): Lists CI workflow runs
- **Merge state** (`pr.mergeStateStatus`): GitHub's determination of whether the PR can merge

For a repo with no GitHub Actions:

- `check_runs = []` (zero CI checks)
- `mergeStateStatus = 'CLEAN'` (PR is clean, no required checks missing)
- `mergeable = 'MERGEABLE'`

The code correctly fetched both, but incorrectly assumed "0 check runs = pending/race condition" rather than also considering "0 check runs + MERGEABLE = no CI configured".

### What "Race Condition" Means

There IS a valid scenario where 0 check runs + pending is correct: immediately after pushing a commit, GitHub may take a few seconds to trigger workflows. In this window, `check_runs = []` but soon they'll appear. The mergeability in this window is often `UNKNOWN` (GitHub is computing), so checking `mergeable` first disambiguates the two cases.

---

## The Fix

**File:** `src/solve.auto-merge.lib.mjs`
**Function:** `getMergeBlockers`

### Before (broken)

```javascript
if (ciStatus.status === 'no_checks') {
  // No CI checks exist yet - race condition after push, treat as pending
  blockers.push({
    type: 'ci_pending',
    message: 'CI/CD checks have not started yet (waiting for checks to appear)',
    details: [],
  });
}
```

### After (fixed)

```javascript
if (ciStatus.status === 'no_checks') {
  // Issue #1345: Distinguish between two cases:
  // 1. Race condition after push (checks haven't started yet) - wait
  // 2. Repository with no CI/CD configured - should be mergeable immediately
  const earlyMergeStatus = await checkPRMergeable(owner, repo, prNumber, verbose);
  if (earlyMergeStatus.mergeable) {
    // PR is already mergeable with no CI checks - no CI/CD configured
    if (verbose) {
      console.log(`[VERBOSE] PR #${prNumber} has no CI checks and is already MERGEABLE - no CI/CD configured`);
    }
    return { blockers, ciStatus, noCiConfigured: true };
  } else {
    // PR is not yet mergeable despite no checks - treat as pending race condition
    blockers.push({
      type: 'ci_pending',
      message: 'CI/CD checks have not started yet (waiting for checks to appear)',
      details: [],
    });
  }
}
```

The function now returns `{ blockers, ciStatus, noCiConfigured }` instead of just `blockers[]`.

### Comment Message Update

The success comments on PRs now correctly distinguish between:

- **With CI configured:** "All CI checks have passed"
- **Without CI configured:** "No CI/CD checks are configured for this repository"

---

## Impact

### Affected Repositories

Any repository that:

1. Has no GitHub Actions workflows configured
2. Has the hive-mind `--auto-restart-until-mergeable` flag used on a PR

### Severity

**High** — caused unbounded infinite loops requiring manual intervention. Users would need to kill the process and manually manage the PR.

### Frequency

Any time hive-mind is used on a repository without CI, this bug would trigger. The reporter used it on a GitHub fork repository (`PavelChurkin/resource-based-economy-Article`) which had no CI configured.

---

## Evidence from Logs

### Log 1: `log1-109e47e2.log` (Primary evidence)

- **Source:** https://gist.githubusercontent.com/konard/d5d83296a5e6af5f2cfa935fd2c9e204/raw/...
- **Lines 4407-4783:** 95+ identical log lines:
  ```
  ⏳ Waiting for CI: CI/CD checks have not started yet (waiting for checks to appear)
  ```
  Each ~60 seconds apart, from 10:14:32Z to 11:54:33Z (100 minutes)

### Log 2: `log2-9900b2fc.log`

- Shows the PR `mergeStateStatus: CLEAN` and `mergeable: MERGEABLE` being logged
- Confirms the repository was indeed mergeable but the bot stayed stuck

### Additional Logs

- `log3-2a49ea8d.log`, `log4-ac33e0e7.log`, `log5-29017979.log`: Additional sessions
  showing the same pattern

---

## Solutions Considered

### Solution 1 (Implemented): Check Mergeability for `no_checks` Case

Check `checkPRMergeable()` when `ciStatus.status === 'no_checks'`. If mergeable, skip the CI blocker.

**Pros:**

- Minimal code change
- Uses existing function (`checkPRMergeable`)
- Correct disambiguation: race condition vs. no CI configured

**Cons:**

- One extra API call in the `no_checks` path

### Solution 2 (Alternative): Check Repository for Workflows First

Before starting the monitoring loop, check if the repo has any workflow files.

**Cons:**

- Brittle (workflows could be in other places)
- Doesn't handle dynamic workflow disabling
- More invasive change

### Solution 3 (Alternative): Add Timeout to `no_checks` Wait

After N cycles of `no_checks`, give up waiting and proceed as mergeable.

**Cons:**

- Arbitrary timeout could be wrong
- Doesn't cleanly identify the root cause
- Still waits unnecessarily

---

## Related Issues and Libraries

### GitHub API Behavior

- GitHub's `mergeStateStatus` field provides the authoritative answer about PR mergeability
- Documentation: https://docs.github.com/en/graphql/reference/enums#mergestatus
- `CLEAN`: All checks passed (including the case with NO required checks)

### Similar Open-Source Handling

- The [octokit/rest.js](https://github.com/octokit/rest.js) library exposes `mergeStateStatus`
- GitHub's own merge queue documentation mentions that `CLEAN` means ready to merge with no blocking checks

---

## Test Coverage

New test file: `tests/test-no-ci-checks-1345.mjs`

Tests cover:

1. `no_checks` + `MERGEABLE` → `noCiConfigured=true`, no blockers
2. `no_checks` + not mergeable → race condition, `ci_pending` blocker
3. CI checks exist → `noCiConfigured=false`
4. Success comment content differs based on CI configuration
5. End-to-end merge flow with no CI
6. Infinite loop prevention (old vs. new behavior documented)
