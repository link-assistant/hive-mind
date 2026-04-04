# Case Study: CI/CD Triggers on .gitkeep File

**Issue:** [#1528](https://github.com/link-assistant/hive-mind/issues/1528)
**PR:** [#1529](https://github.com/link-assistant/hive-mind/pull/1529)
**Date:** 2026-04-04
**Status:** Fix Implemented

---

## Executive Summary

The CI/CD pipeline triggers workflow runs when `.gitkeep` files are pushed to pull request branches. While downstream jobs correctly skip (due to the positive-matching approach from issue #1436), two problems remain:

1. **Cosmetic/correctness issue:** `.gitkeep` appears in the "Files considered as code changes" list in `detect-code-changes.mjs` output because `isExcludedFromCodeChanges()` does not exclude `.gitkeep` files.
2. **Unnecessary workflow runs:** The entire "Checks and release" workflow still triggers for `.gitkeep`-only commits, consuming a GitHub Actions runner for ~8 seconds to run `detect-changes` before all other jobs get skipped.

**Root Causes:**

1. The `.gitkeep` exclusion added in issue #1436 was removed in the same PR's refactor commit (`4f4c18df`) when switching to a "positive-matching" approach. The refactor correctly ensured `code=false` for `.gitkeep` via the `codePattern` regex, but left `.gitkeep` passing through `isExcludedFromCodeChanges()`.
2. The workflow `on.pull_request` trigger has no `paths-ignore` filter, so GitHub Actions creates a run for every push to a PR branch regardless of which files changed.

**Fixes:**

1. Re-add `.gitkeep` exclusion in `isExcludedFromCodeChanges()` for correctness — `.gitkeep` files should not appear in "Files considered as code changes"
2. Add `paths-ignore: ['**.gitkeep']` to the `pull_request` trigger to avoid creating workflow runs for `.gitkeep`-only pushes
3. Add unit tests for the change detection logic

---

## Problem Statement

### Evidence from PR #1527

**Reference:** [PR #1527 changes at commit 0e01568](https://github.com/link-assistant/hive-mind/pull/1527/changes/0e01568591d8c9043f3d6378ba1cf748dc6a3adf)

**Commit [`9847df4`](https://github.com/link-assistant/hive-mind/commit/9847df4734bab7ba94318bdb70ae2f3e5d93542d)** — Initial `.gitkeep` commit for PR creation:

- Only file changed: `.gitkeep` (added)
- Workflow run created: [#23983333764](https://github.com/link-assistant/hive-mind/actions/runs/23983333764)
- `detect-changes` output: `mjs=false, package=false, docs=false, workflow=false, docker=false, helm=false, code=false`
- `.gitkeep` appeared in "Files considered as code changes" list (should not)
- All downstream jobs correctly skipped
- **Waste:** ~8s of GitHub Actions runner time for `detect-changes` job

**Commit [`0e01568`](https://github.com/link-assistant/hive-mind/commit/0e01568591d8c9043f3d6378ba1cf748dc6a3adf)** — Revert of `.gitkeep` commit:

- Only file changed in this commit: `.gitkeep` (removed)
- Workflow run created: [#23983985882](https://github.com/link-assistant/hive-mind/actions/runs/23983985882)
- **However:** the PR diff against base branch (main) includes ALL cumulative changes from the PR (`.mjs` files, etc.)
- `detect-changes` output: `mjs=true, code=true` (correctly reflecting cumulative PR changes)
- All jobs ran and passed — this is **expected behavior** since the PR contains real code changes

### Evidence from PR #1529 (this PR)

**Commit [`39cfd01`](https://github.com/link-assistant/hive-mind/commit/39cfd01d)** — Initial `.gitkeep` commit:

- Same pattern: `detect-changes` ran, all other jobs skipped
- `.gitkeep` appeared in "Files considered as code changes"

---

## Timeline Reconstruction

### 2026-03-18 — Issue #1436 Fix (PR #1441)

1. Commit `d07d8d28`: Added `.gitkeep` exclusion to `isExcludedFromCodeChanges()` and `gitkeep-only` output
2. Commit `4f4c18df`: Refactored to "positive-matching" approach — **removed** the `.gitkeep` exclusion, relying instead on `codePattern` regex not matching `.gitkeep`
3. PR #1441 merged with the positive-matching approach

### 2026-04-04T16:54:18Z — PR #1527 `.gitkeep` commit

- Commit `9847df4` pushed to PR #1527 branch with only `.gitkeep`
- Workflow run #23983333764 created and ran `detect-changes`
- `.gitkeep` listed as "Files considered as code changes" but `code=false`
- All downstream jobs skipped correctly

### 2026-04-04T17:32:27Z — PR #1527 `.gitkeep` revert commit

- Commit `0e01568` pushed, reverting the `.gitkeep`
- Workflow run #23983985882 created
- PR diff against main includes all real code changes → all jobs ran (expected)

---

## Root Cause Analysis

### RCA 1: `.gitkeep` Not Excluded from Code Changes List

The `isExcludedFromCodeChanges()` function in `scripts/detect-code-changes.mjs` excludes:

- Markdown files (`*.md`)
- Files in `.changeset/`, `data/`, `docs/`, `experiments/` folders

But it does **not** exclude `.gitkeep` files. The exclusion was added in commit `d07d8d28` but removed in commit `4f4c18df` during the refactor to positive-matching.

While `code=false` is correct (`.gitkeep` doesn't match `codePattern`), the file still appears in the "Files considered as code changes" filtered list, which is misleading.

### RCA 2: No Path Filter on Workflow Trigger

The workflow trigger:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]
```

Has no `paths-ignore` filter. GitHub Actions creates a workflow run for every push to a PR branch, regardless of which files changed. For `.gitkeep`-only pushes, this creates an unnecessary run where `detect-changes` runs (~8s) just to determine that nothing needs to happen.

### RCA 3: Positive-Matching Gap

The refactor in commit `4f4c18df` correctly prevented `code=true` for `.gitkeep` files via `codePattern`, but created an inconsistency: the "Files considered as code changes" list shows files that passed `isExcludedFromCodeChanges()` but didn't match `codePattern`. These are files that are neither excluded nor code — a gap in the detection logic.

---

## Solutions Implemented

### Solution 1: Exclude `.gitkeep` from Code Changes Detection

**File:** `scripts/detect-code-changes.mjs`

- Re-add `.gitkeep` exclusion to `isExcludedFromCodeChanges()` function
- This ensures `.gitkeep` files don't appear in "Files considered as code changes" list
- Consistent with the exclusion of other non-code files (markdown, docs, etc.)

### Solution 2: Add `paths-ignore` to Workflow Trigger

**File:** `.github/workflows/release.yml`

- Add `paths-ignore: ['**.gitkeep']` to the `pull_request` trigger
- This prevents GitHub Actions from creating a workflow run when only `.gitkeep` files change
- Saves ~8 seconds of runner time per `.gitkeep`-only push
- Note: This only affects the initial `.gitkeep` commit (first push to PR branch). The revert commit typically occurs when there are other code changes in the PR, so the workflow would run anyway.

### Solution 3: Unit Tests for Change Detection

**File:** `tests/test-detect-code-changes-1528.mjs`

- Tests that `.gitkeep` is excluded from code changes
- Tests that markdown files, docs, experiments, etc. are excluded
- Tests that real code files (.mjs, .json, .yml) are not excluded
- Validates the `codePattern` regex behavior

---

## CI/CD Resources Saved (Estimated)

Per Pull Request initial `.gitkeep` commit:

| Before                                      | After                |
| ------------------------------------------- | -------------------- |
| Workflow run created                        | No workflow run      |
| `detect-changes` job runs (~8s)             | No job runs          |
| All other jobs evaluate conditions and skip | No evaluation needed |

**Savings per PR:** ~8 seconds of GitHub Actions runner time + avoided workflow queuing overhead.

---

## Key Insight: `paths-ignore` and PR Diffs

GitHub Actions `paths-ignore` for `pull_request` events uses the **cumulative PR diff** (three-dot diff between topic branch and base branch), not per-commit diffs. This means:

- For the initial `.gitkeep` commit (first push to a new PR branch): the cumulative diff is just `.gitkeep` → workflow is skipped by `paths-ignore`
- For the `.gitkeep` revert commit (after real code is pushed): the cumulative diff includes all real code changes → workflow runs normally

This is exactly the desired behavior. The `paths-ignore` filter correctly skips only the truly irrelevant initial commit.

---

## Related Issues and Case Studies

- [Issue #1436 / PR #1441](https://github.com/link-assistant/hive-mind/pull/1441) — Previous optimization for `.gitkeep`-only changes (positive-matching refactor)
- [Case Study: issue-1436](../issue-1436/README.md) — Detailed analysis of the original `.gitkeep` CI/CD optimization
- [GitHub Docs: Triggering a workflow](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows) — Documentation on `paths-ignore` behavior

---

## References

- CI logs for initial `.gitkeep` commit: `ci-logs/checks-initial-gitkeep-23983333764.log`
- CI logs for `.gitkeep` revert commit: `ci-logs/checks-and-release-23983985882.log`
