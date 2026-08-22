# Case Study: CI/CD Runs Unnecessarily for Non-Code File Changes

**Issue:** [#1582](https://github.com/link-assistant/hive-mind/issues/1582)
**PR:** [#1583](https://github.com/link-assistant/hive-mind/pull/1583)
**Date:** 2026-04-11
**Status:** Fix Implemented

---

## Executive Summary

The CI/CD workflow triggers for every push to a PR branch, even when only non-code files (like `.gitkeep`) are changed. While individual jobs correctly skip based on `detect-changes` outputs (fixed in issues #1436 and #1528), the workflow run itself still starts, consuming GitHub Actions runner time (~8s for `detect-changes`) and cluttering the PR checks UI.

**Root Cause:** The `on.pull_request` trigger in `release.yml` has no `paths` filter, so GitHub Actions creates a workflow run for every `synchronize` event regardless of which files changed.

**Fix:** Add a `paths` filter to the `on.pull_request` trigger using positive matching (consistent with issue #1528's approach). The workflow only triggers when files matching known code, documentation, or configuration patterns change. Unknown file types (`.gitkeep`, `.txt`, `.log`, images, etc.) are naturally excluded.

---

## Problem Statement

### Evidence from PR #1579

**Reference:** [PR #1579 commit 8134a2f](https://github.com/link-assistant/hive-mind/pull/1579/commits/8134a2f25a11dfc3a8f63a33f0f2a936d0c977ea)

**Commit `8134a2f`** — Revert of `.gitkeep` commit in PR #1579:

- Only file changed in this commit: `.gitkeep` (removed)
- Workflow run [#24272954371](https://github.com/link-assistant/hive-mind/actions/runs/24272954371) was created
- All test and lint jobs ran because the cumulative PR diff (base vs head) included real code changes from earlier commits
- While this specific case ran tests correctly (the PR has real code changes), it demonstrates that the workflow triggers for any push, including `.gitkeep`-only pushes

**Initial `.gitkeep` commit pattern** (applies to all PRs in this repo):

- Every PR starts with a `.gitkeep` commit to create the branch
- This triggers a full workflow run where `detect-changes` runs (~8s) only to determine nothing needs to happen
- All downstream jobs are correctly skipped, but the `detect-changes` job itself wastes compute

### CI Run Analysis for Commit 8134a2f

| Job                      | Conclusion | Expected                                   |
| ------------------------ | ---------- | ------------------------------------------ |
| detect-changes           | success    | success (always runs)                      |
| test-suites              | success    | success (PR has code changes)              |
| test-compilation         | success    | success (PR has code changes)              |
| test-execution           | success    | success (PR has code changes)              |
| memory-check-linux       | success    | success (PR has code changes)              |
| lint                     | success    | success (PR has code changes)              |
| changeset-check          | success    | success (PR has code changes)              |
| version-check            | success    | success (PR has code changes)              |
| validate-docs            | success    | success (PR has doc changes)               |
| check-file-line-limits   | success    | success (PR has mjs changes)               |
| Docker/Helm/Release jobs | skipped    | skipped (PR event, no docker/helm changes) |

---

## Timeline Reconstruction

### 2026-03-18 — Issue #1436 Fix (PR #1441)

- Added `detect-changes` job and conditional execution for jobs
- Refactored to positive-matching approach for code change detection
- `version-check` and `helm-pr-check` made conditional on detected changes

### 2026-04-04 — Issue #1528 Fix (PR #1529)

- Fixed "Files considered as code changes" list to use consistent positive matching
- Explicitly decided NOT to add `paths-ignore` to workflow trigger, considering ~8s overhead acceptable
- Added unit tests for detection logic

### 2026-04-10 — Issue #1582 Reported

- User observes CI/CD running tests for `.gitkeep`-only changes
- Requests reducing computation load for non-code file changes
- Notes this applies to any unrecognized file types, not just `.gitkeep`

---

## Root Cause Analysis

### RCA 1: No Path Filter on Workflow Trigger

The workflow trigger configuration:

```yaml
on:
  push:
    branches:
      - main
  pull_request:
    types: [opened, synchronize, reopened]
```

Has no `paths` or `paths-ignore` filter on `pull_request`. GitHub Actions creates a workflow run for every push to a PR branch, regardless of which files changed.

**Impact:** For `.gitkeep`-only pushes (common pattern: every PR starts with one), this wastes:

- ~8s of GitHub Actions runner time for the `detect-changes` job
- PR checks UI space showing a run where everything is skipped

### RCA 2: Leftover .gitkeep File on Branch

The `.gitkeep` file exists on the current branch, left over from the automated PR creation process. This file should be removed as part of the fix.

---

## Solution

### Approach: Positive-Matching Path Filter

Add a `paths` filter to the `on.pull_request` trigger that uses positive matching — only files matching known code, documentation, or configuration patterns trigger the workflow. This is consistent with the positive-matching approach established in issue #1528.

**Key design decisions:**

1. **`paths` (positive) over `paths-ignore` (negative):** Using `paths` ensures unknown file types are naturally excluded without maintaining an exclusion list. This aligns with the `codePattern` approach in `detect-code-changes.mjs`.

2. **No filter on `on.push`:** The `push` trigger for `main` has no path filter — we always want to run the full pipeline on pushes to the default branch to ensure releases are correct.

3. **Broad coverage:** The filter includes all file types that any job in the workflow cares about: code (`.mjs`, `.sh`, `.js`), config (`.json`, `.yml`, `.yaml`), docs (`.md`), Docker files, Helm charts, changesets, and workflow files.

### Changes

**File: `.github/workflows/release.yml`**

Added `paths` filter to `on.pull_request`:

```yaml
on:
  push:
    branches:
      - main
  pull_request:
    types: [opened, synchronize, reopened]
    paths:
      - '**.mjs'
      - '**.js'
      - '**.sh'
      - '**.json'
      - '**.yml'
      - '**.yaml'
      - '**.md'
      - '.changeset/**'
      - '.github/**'
      - 'Dockerfile'
      - 'coolify/Dockerfile'
      - '.dockerignore'
      - 'helm/**'
      - '.prettierrc'
      - '.prettierignore'
      - '.eslintrc*'
```

### Consistency with detect-code-changes.mjs

The `paths` filter is intentionally broader than `codePattern` in `detect-code-changes.mjs`:

- `codePattern` determines which jobs run (code vs docs vs helm)
- `paths` filter determines whether the workflow starts at all
- Including `.md` files in `paths` ensures `validate-docs` can run for docs-only PRs
- Including `.changeset/**` ensures changeset validation works

### Alternatives Considered

1. **`paths-ignore` approach:** Rejected (consistent with issue #1528 reasoning) — requires maintaining a list of excluded file types, which is fragile and prone to missing new non-code file types.

2. **No change (status quo):** The ~8s overhead per `.gitkeep`-only push was previously considered acceptable (#1528), but issue #1582 explicitly requests reducing this waste.

---

## References

- [Issue #1436](https://github.com/link-assistant/hive-mind/issues/1436) — Original CI/CD optimization for `.gitkeep`
- [Issue #1528](https://github.com/link-assistant/hive-mind/issues/1528) — Positive matching for code change detection
- [GitHub Docs: paths filter](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#onpull_requestpull_request_targetpathspaths-ignore) — Official documentation on path filtering
