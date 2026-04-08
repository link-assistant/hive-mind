# Case Study: Optimize CI/CD for .gitkeep-only Changes and Investigate Leftover .gitkeep

**Issue:** [#1436](https://github.com/link-assistant/hive-mind/issues/1436)
**PR:** [#1441](https://github.com/link-assistant/hive-mind/pull/1441)
**Date:** 2026-03-18
**Status:** Fix Implemented

---

## Executive Summary

Every Pull Request in the hive-mind repository starts with a `.gitkeep` commit (to create the branch) and ends with a `.gitkeep` revert commit (cleanup). Both of these commits trigger CI/CD workflow runs that waste resources, since the only changed file is `.gitkeep` which has no impact on code, tests, or releases.

Additionally, a leftover `.gitkeep` file was found on the `main` branch, originating from PR #1420 (issue #1419) which was merged without the cleanup revert being applied.

**Root Causes:**

1. **CI/CD waste:** The `version-check` and `helm-pr-check` jobs had no dependency on `detect-changes` outputs, running unconditionally on all PRs regardless of what files changed.
2. **Leftover .gitkeep:** The `cleanupClaudeFile` function used `%s` (subject-only) format to detect `.gitkeep` in commit messages, but the commit subject "Initial commit with task details" doesn't contain ".gitkeep" — only the commit body does. This caused incorrect file type detection during cleanup.

**Fixes:**

1. Add `.gitkeep` to `isExcludedFromCodeChanges()` in `detect-code-changes.mjs`
2. Add `gitkeep-only` output to detect when only `.gitkeep` files changed
3. Make `version-check` and `helm-pr-check` skip on `gitkeep-only` changes
4. Fix commit message detection to use `%B` (full body) and add file-based fallback
5. Add post-cleanup verification with direct removal fallback
6. Remove the leftover `.gitkeep` from the repository

---

## Problem Statement

### Problem 1: Wasted CI/CD Resources

Two referenced commits demonstrate the issue:

**Commit [`bd508f2`](https://github.com/link-assistant/hive-mind/commit/bd508f23b7599ee0ca22e41e34372071ff5a07c1)** — Initial `.gitkeep` commit for PR creation:

- Only changes: `.gitkeep` (added)
- Jobs that ran: `detect-changes` (8s), `Check for Manual Version Changes` (9s), `helm-pr-check` (12s)
- Jobs that should have run: `detect-changes` only (the other two are unnecessary for `.gitkeep`-only changes)

**Commit [`26d44bd`](https://github.com/link-assistant/hive-mind/commit/26d44bdf3470c91cef02fadb8fc11978208cbf46)** — Revert of `.gitkeep` commit:

- Only changes: `.gitkeep` (modified, but cumulative PR changes include real code)
- Jobs that ran: `detect-changes`, `version-check`, `helm-pr-check`, `changeset-check`, `lint`, `test-compilation`, `check-file-line-limits`, `validate-docs`
- Note: For the revert commit, the cumulative PR diff includes all code changes, so most jobs running is expected. However, for the initial `.gitkeep` commit (the first push to a new PR branch), only `.gitkeep` changes and ALL jobs should be skipped.

### Problem 2: Leftover .gitkeep File

A `.gitkeep` file was found on the `main` branch, introduced by commit `781669db` from PR #1420. This file was created as the initial commit for issue #1419 but was never reverted before the PR was merged.

Contents of the leftover file:

```
# .gitkeep file auto-generated at 2026-03-13T07:05:36.210Z for PR creation at branch issue-1419-f16b173187e6 for issue https://github.com/link-assistant/hive-mind/issues/1419
# Updated: 2026-03-18T13:09:24.590Z
```

---

## Timeline Reconstruction

### 2026-03-13T07:05:36Z — PR #1420 Created

- Branch `issue-1419-f16b173187e6` created with `.gitkeep` initial commit (`781669db`)
- AI solver begins working on issue #1419

### 2026-03-13T07:35:02Z — PR #1420 Merged

- PR merged with 3 commits: `.gitkeep` initial + 2 fix commits
- `.gitkeep` was NOT reverted before merge
- `.gitkeep` file now exists on `main` branch

### 2026-03-17 — Issue #1436 Reported

- Observation: `.gitkeep`-only commits trigger unnecessary CI/CD jobs
- Observation: `.gitkeep` leftover found in repository

---

## Root Cause Analysis

### RCA 1: CI/CD Jobs Running Unconditionally

The `version-check` job (line 79 of `release.yml`) had condition:

```yaml
if: github.event_name == 'pull_request'
```

The `helm-pr-check` job (line 666) had condition:

```yaml
if: always() && github.event_name == 'pull_request' && (needs.changeset-check.result == 'success' || needs.changeset-check.result == 'skipped')
```

Neither checked `detect-changes` outputs, so both ran on every PR event regardless of file changes.

### RCA 2: File Type Detection Bug in cleanupClaudeFile

In `solve.results.lib.mjs`, the cleanup function used:

```javascript
const commitMsgResult = await $({ cwd: tempDir })`git log -1 --format=%s ${claudeCommitHash} 2>&1`;
const commitMsg = commitMsgResult.stdout?.trim() || '';
const isGitkeepFile = commitMsg.includes('.gitkeep');
```

The `%s` format returns only the subject line: "Initial commit with task details" — which does NOT contain ".gitkeep". The ".gitkeep" reference is in the commit body. This caused `fileName` to be set to `CLAUDE.md` instead of `.gitkeep`.

While the actual `git revert` command works regardless of this detection (it reverts the whole commit), the subsequent diff check (`git diff ${commitToRevert} HEAD -- ${fileName}`) would compare against the wrong file, potentially taking incorrect code paths.

### RCA 3: No Post-Cleanup Verification

The cleanup function had no verification step to confirm the file was actually removed. If the revert, manual cleanup, or push failed, the `.gitkeep` would silently remain in the repository.

---

## Solutions Implemented

### Solution 1: CI/CD Optimization

**File:** `scripts/detect-code-changes.mjs`

- Added `.gitkeep` to `isExcludedFromCodeChanges()` function
- Added `gitkeep-only` output that is `true` when ALL changed files are `.gitkeep`

**File:** `.github/workflows/release.yml`

- Added `gitkeep-only` to `detect-changes` job outputs
- `version-check`: Now depends on `detect-changes` and skips when `gitkeep-only == 'true'`
- `helm-pr-check`: Now skips when `gitkeep-only == 'true'`

### Solution 2: Hardened .gitkeep Cleanup

**File:** `src/solve.results.lib.mjs`

- Changed `%s` (subject) to `%B` (full message body) for commit message detection
- Added fallback detection via `git diff-tree` to check actual files changed
- Added post-cleanup verification that checks if file still exists and attempts direct removal

### Solution 3: Remove Leftover

- Deleted the `.gitkeep` file from the repository

---

## CI/CD Resources Saved (Estimated)

Per Pull Request, the initial `.gitkeep` commit previously triggered:

- `detect-changes`: ~8s (still runs, needed for detection)
- `version-check`: ~9s (now skipped)
- `helm-pr-check`: ~12s (now skipped)

**Savings per PR:** ~21 seconds of runner time on the initial commit.
**At scale:** With many automated PRs, this adds up to significant CI/CD savings.

---

## Data Files

- `ci-logs/gitkeep-commit-bd508f2-checks.json` — CI check results for the `.gitkeep` add commit
- `ci-logs/revert-commit-26d44bd-checks.json` — CI check results for the `.gitkeep` revert commit
