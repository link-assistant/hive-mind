# Case Study: Issue #1023 - CI/CD Check Differences Between Pull Request and Push Events

## Issue Link

https://github.com/link-assistant/hive-mind/issues/1023

## Error Message

```
Checking formatting...
[warn] docs/case-studies/issue-1017/README.md
[warn] docs/case-studies/issue-1021/README.md
[warn] docs/case-studies/issue-1021/solutions.md
[warn] docs/case-studies/issue-1021/timeline.md
[warn] Code style issues found in 4 files. Run Prettier with --write to fix.
Error: Process completed with exit code 1.
```

## Date of Occurrence

2025-12-28T15:32:42Z (CI Run ID: 20555859476)

## Problem Summary

After merging PRs #1018 and #1022, the CI/CD pipeline on the main branch failed because several markdown documentation files were not properly formatted with Prettier. The core issue is a **gap between pull request checks and push/merge checks** that allowed unformatted files to be merged.

## Root Cause Analysis

### 1. Workflow Dependency Chain Gap

The CI/CD workflow has different behavior for `pull_request` events vs `push` events:

**For Pull Request Events:**

- `changeset-check` job runs and validates changeset files
- `lint` job depends on `changeset-check.result == 'success'`
- If `changeset-check` fails, `lint` never runs

**For Push Events (to main):**

- `changeset-check` is skipped (line 117: `if: github.event_name == 'pull_request'`)
- `lint` job runs unconditionally when docs/code changed
- This is when the Prettier check finally catches formatting issues

### 2. Documentation-Only PRs Missing Changeset

Both PRs #1018 and #1022 added only documentation (case study files):

- PR #1018: `docs/case-studies/issue-1017/README.md`
- PR #1022: `docs/case-studies/issue-1021/` (multiple files)

These documentation-only PRs were merged without changesets, which is currently acceptable behavior. However, the `lint` job only runs when `changeset-check` passes, meaning **Prettier never ran on these PRs** before they were merged.

### 3. Workflow Logic Issue

Looking at the workflow conditions:

```yaml
lint:
  needs: [detect-changes, changeset-check]
  if: always() && (github.event_name == 'push' || needs.changeset-check.result == 'success') && (...)
```

For PRs: The `lint` job only runs if `changeset-check` succeeds. If changeset validation fails (e.g., missing changeset), the lint job is skipped entirely - meaning Prettier and ESLint don't run.

This creates a scenario where:

1. PR with docs-only changes has no changeset
2. `changeset-check` fails with "No changeset found"
3. `lint` job is skipped because `changeset-check` didn't succeed
4. PR is merged without Prettier validation
5. Push to main triggers lint, which now fails

## Timeline of Events

### PR #1018 (Issue #1017 Case Study)

1. **2025-12-28T06:02:07Z** - Initial commit with task details
2. **2025-12-28T06:09:17Z** - Code fix committed (later reverted)
3. **2025-12-28T15:25:55Z** - Reverted to docs-only with unformatted README.md
4. **2025-12-28T15:32:13Z** - PR merged to main

### PR #1022 (Issue #1021 Case Study)

1. **2025-12-28T14:44:09Z** - Initial commit with task details
2. **2025-12-28T14:52:57Z** - Case study documentation added
3. **2025-12-28T15:16:25Z** - PR merged to main

### Main Branch CI Failure

1. **2025-12-28T15:32:16Z** - Push event triggered (SHA: 672b839...)
2. **2025-12-28T15:32:23Z** - `detect-changes` found only `docs/case-studies/issue-1017/README.md`
3. **2025-12-28T15:32:42Z** - Prettier check ran and failed on 4 files

## Evidence from Logs

From CI run 20555859476 (push to main):

```
detect-changes  Detect changes  Changed files:
detect-changes  Detect changes  docs/case-studies/issue-1017/README.md

lint  Run Prettier format check  [warn] docs/case-studies/issue-1017/README.md
lint  Run Prettier format check  [warn] docs/case-studies/issue-1021/README.md
lint  Run Prettier format check  [warn] docs/case-studies/issue-1021/solutions.md
lint  Run Prettier format check  [warn] docs/case-studies/issue-1021/timeline.md
lint  Run Prettier format check  ##[error]Process completed with exit code 1.
```

Note: Even though only one file was changed in this push, Prettier checks ALL files matching the pattern and found 4 unformatted files (from both merged PRs).

## Solutions

### Immediate Fix (This PR)

1. Format all unformatted markdown files with Prettier
2. Document this case study

### Long-Term Solution Options

#### Option A: Remove Lint Dependency on Changeset (Recommended)

Make the `lint` job independent of `changeset-check`:

```yaml
lint:
  runs-on: ubuntu-latest
  needs: [detect-changes]
  # Remove changeset-check dependency
  if: needs.detect-changes.outputs.mjs-changed == 'true' || needs.detect-changes.outputs.docs-changed == 'true' || ...
```

**Pros:**

- Lint checks run on ALL PRs, regardless of changeset status
- Fast checks should not wait for changeset validation
- Matches the principle stated in the issue: "linter should never depend on [changeset]"

**Cons:**

- Need to ensure we're not introducing race conditions

#### Option B: Allow Docs-Only PRs Without Changeset

Modify `changeset-check` to skip validation when only docs files are changed:

```yaml
changeset-check:
  if: github.event_name == 'pull_request'
  needs: [detect-changes]
  # Skip if only docs changed
  if: needs.detect-changes.outputs.any-code-changed == 'true'
```

**Pros:**

- Docs-only PRs don't need changesets
- Reduces friction for documentation updates

**Cons:**

- Doesn't fix the core issue of lint depending on changeset

#### Option C: Make Both Jobs Independent (Most Comprehensive)

1. Make `lint` independent (no dependency on changeset-check)
2. Make `changeset-check` conditional on code changes (not docs-only)
3. Ensure both checks run in parallel for maximum speed

This aligns with the issue description:

> "linter if depends on changesets should never depend on it, it is fast check, and can be treated before any changesets or just executed at the same time"

## References

- [GitHub Actions Job Conditions](https://docs.github.com/en/actions/using-jobs/using-conditions-to-control-job-execution)
- [Super-Linter Best Practices](https://github.com/marketplace/actions/super-linter) - For merge_group and pull_request events, checks all modified files
- [Skipping Jobs in Workflows](https://www.codestudy.net/blog/github-action-job-fire-when-previous-job-skipped/) - Default behavior skips dependent jobs if any job in `needs` is skipped

## Files Affected

- `docs/case-studies/issue-1017/README.md`
- `docs/case-studies/issue-1021/README.md`
- `docs/case-studies/issue-1021/solutions.md`
- `docs/case-studies/issue-1021/timeline.md`

## Implemented Solution

The solution implemented in this PR follows **Option C: Make Both Jobs Independent**:

### Changes Made

1. **Made `lint` job independent** (commit 9327e83):
   - Removed dependency on `changeset-check`
   - `lint` now runs based only on `detect-changes` outputs

2. **Made `changeset-check` conditional on code changes** (commit 9327e83):
   - Added condition: `needs.detect-changes.outputs.any-code-changed == 'true'`
   - Docs-only PRs skip changeset validation entirely

3. **Updated `any-code-changed` detection** (commit [current]):
   - **Excluded folders** from code changes:
     - `.changeset/` - changeset metadata files
     - `data/` - data files
     - `docs/` - documentation
     - `experiments/` - experimental scripts
   - **Excluded markdown files** (`*.md`) in any folder
   - This ensures docs-only PRs don't trigger changeset requirements

### How It Works Now

For a PR with changes only in excluded folders/files:

1. `detect-changes` sets `any-code-changed=false`
2. `changeset-check` is skipped (no changeset required)
3. `lint` still runs (Prettier and ESLint check the files)
4. PR can be merged after lint passes
5. Push to main runs lint again - should pass since PR already formatted files

### Files Excluded from Code Change Detection

The following are now explicitly excluded from `any-code-changed`:

| Pattern         | Reason                           |
| --------------- | -------------------------------- |
| `*.md`          | Documentation/markdown files     |
| `.changeset/*`  | Changeset metadata               |
| `data/*`        | Data files (not executable code) |
| `docs/*`        | Documentation folder             |
| `experiments/*` | Experimental/example scripts     |

## Appendix: CI Run Information

- **Failed Run:** https://github.com/link-assistant/hive-mind/actions/runs/20555859476/job/59039910327
- **Event Type:** push
- **Branch:** main
- **Commit SHA:** 672b8394fc68c0e507cbc3e0e26da177ccf75dad
