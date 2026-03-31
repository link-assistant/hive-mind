# Case Study: Issue #1480 — "Ready to merge" false positives

## Timeline

### Case 1: hive-mind PR #1479 (2026-03-25)

- **PR created:** 09:45:20Z
- **False positive "Ready to merge" posted:** Before 09:55:18Z (before CI started)
- **False positive message:** "CI workflows exist but were not triggered for this commit"
- **CI eventually started:** 09:55:18Z (first check run)
- **CI result:** Failures in `lint` and `check-file-line-limits`
- **Root cause path:** `no_checks` → `mergeable` → `hasWorkflows` → no workflow runs yet → grace period elapsed → no previous CI → concluded `noCiTriggered: true`

### Case 2: trees-rs PR #21 (2026-03-28)

- **PR created:** 22:52:00Z
- **False positive "Ready to merge" posted:** 22:56:53Z
- **False positive message:** "All CI checks have passed"
- **CI checks started appearing:** CodeFactor at 22:56:46Z, main CI at 22:57:04Z
- **CI result:** Failures in `Build Package` and `Version Modification Check`
- **Root cause path:** `getDetailedCIStatus` returned `status: 'success'` because only CodeFactor (a fast external check) was registered and already passed; the main CI/CD workflow hadn't started registering check-runs yet.

## Root Causes

### Root Cause 1: `success` status path has no cross-validation (Case 2)

`getDetailedCIStatus()` only examines currently-registered check runs. If a fast external check (e.g., CodeFactor) registers and passes before the main CI pipeline starts, the function returns `status: 'success'` with `allPassed: true`. The `getMergeBlockers()` function then concludes there are no blockers.

The `no_checks` path (0 check runs) has extensive race-condition protection, but the `success` path assumes that if ANY checks passed, ALL expected checks are present. This is incorrect when:

- External services (CodeFactor, Codecov, etc.) register quickly
- Main CI workflows take 30-120 seconds to register check-runs after a push
- The check happens during this registration window

### Root Cause 2: Grace period detection can fail for `no_checks` path (Case 1)

The `no_checks` path uses commit age as a grace period proxy. But commit date reflects when the commit was authored/committed, NOT when it was pushed. A commit may have been authored hours ago but pushed just now, causing the grace period check to fail because `ageSeconds` is much larger than the grace period threshold.

Additionally, if a PR is the first commit on its branch (no previous commits), `checkPreviousPRCommitsHadCI` returns `hadPreviousCI: false`, and the system falls through to the `noCiTriggered: true` conclusion.

## Fix Strategy

### Fix 1: Cross-validate `success` status with expected workflow runs

When `getDetailedCIStatus()` returns `success`, verify that the number and identity of check-runs matches what we'd expect from the repository's workflows. Specifically:

- After getting `status: 'success'`, check if the repo has active workflows with PR triggers
- If yes, check if workflow runs exist for this SHA
- If workflow runs exist but are not yet `completed`, treat as `pending` (more check-runs may appear)
- If no workflow runs exist for the SHA yet, check commit age for grace period

### Fix 2: Use push event timestamp instead of commit date

The commit date is unreliable for determining "how recently was this pushed". Instead, we should use the workflow run creation time or fall back to checking if any workflow runs exist at all (regardless of age).

For maximum robustness, when we see `success` with only external checks (not from GitHub Actions), cross-validate with the workflow runs API.

## Implementation

The fix adds a new cross-validation step in `getMergeBlockers()` that runs after `getDetailedCIStatus()` returns `success`:

1. Check if repo has workflows with PR/push triggers
2. If yes, verify that workflow runs exist for the SHA AND are completed
3. If workflow runs are still `in_progress` or `queued`, add `ci_pending` blocker
4. If no workflow runs exist yet but workflows should trigger, check grace period and add `ci_pending` blocker
