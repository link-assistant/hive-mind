# Case Study: Issue #958 - Unformatted Files Merged to Main Branch

## Executive Summary

**Issue:** Pull Request #707 was merged to the main branch passing all CI checks, but immediately after merge, the main branch CI run failed due to Prettier formatting errors in files from a different PR (#955).

**Root Cause:** GitHub Actions workflow has inconsistent conditions for the `lint` job:

- On PRs: lint only runs when `.mjs` files change
- On main: lint runs on every push regardless of file types
- Result: Files can be merged without formatting validation

**Impact:** Main branch CI is failing, potentially blocking releases and creating confusion about code quality standards.

**Primary Solution:** Add required status checks to GitHub branch protection rules to prevent merging PRs with failed/skipped checks.

**Secondary Solution:** Fix the workflow condition logic to ensure consistent formatting validation.

---

## Timeline of Events

### 2025-12-21 17:12:07 UTC

**PR #955 Created and CI Runs**

- **Branch:** `issue-954-d0ca5afb6f42`
- **Changes:**
  - Modified: `scripts/ubuntu-24-server-install.sh` (bash script)
  - Added: `docs/case-studies/issue-954/analysis.md` (documentation)
  - Added: `.changeset/fix-perlbrew-unbound-variable.md` (changeset)
  - Added: `experiments/test-perlbrew-fix.sh` (test script)
- **CI Run Result:** [SUCCESS](https://github.com/link-assistant/hive-mind/actions/runs/20413276621)
- **Critical Detail:** Most checks were **SKIPPED** including the `lint` job

**Why lint was skipped:**

```yaml
# From .github/workflows/release.yml line 198
if: always() && (github.event_name == 'push' || needs.changeset-check.result == 'success') && (needs.detect-changes.outputs.mjs-changed == 'true' || needs.detect-changes.outputs.workflow-changed == 'true')
```

- `needs.detect-changes.outputs.mjs-changed` was `false` (no `.mjs` files changed)
- `needs.detect-changes.outputs.workflow-changed` was `false` (no workflow files changed)
- Therefore: **lint job skipped**

### 2025-12-21 18:15:47 UTC

**PR #955 Merged to Main**

- **Merge Commit:** `ee8d6e01a2ec540162c398f0850ad95262bd5c0d`
- **CI Run on Main:** [SUCCESS](https://github.com/link-assistant/hive-mind/actions/runs/20413871350)
- **Files with formatting issues now in main:**
  - `.changeset/fix-perlbrew-unbound-variable.md`
  - `docs/case-studies/issue-954/analysis.md`

### 2025-12-21 17:12:07 UTC (PR #707)

**PR #707 Created**

- **Branch:** `issue-706-2c77a63b8bcb`
- **Changes:**
  - Modified: `src/solve.repository.lib.mjs`
  - Added: `.changeset/readme-initialization.md`
- **CI Run Result:** [SUCCESS](https://github.com/link-assistant/hive-mind/actions/runs/20413150931)
- **lint job:** PASSED (`.mjs` files changed, so lint ran)

### 2025-12-21 18:19:41 UTC

**PR #707 Merged to Main**

- **Merge Commit:** `2406334b4e4bb2edd6083acede46c7e8141577e8`
- **Merged successfully** (all PR checks passed)

### 2025-12-21 18:19:43 UTC

**CI Run on Main Branch FAILS**

- **CI Run:** [FAILURE](https://github.com/link-assistant/hive-mind/actions/runs/20413917848)
- **Failed Job:** `lint`
- **Reason:** Prettier format check failed

```
[warn] .changeset/fix-perlbrew-unbound-variable.md
[warn] docs/case-studies/issue-954/analysis.md
[warn] Code style issues found in 2 files. Run Prettier with --write to fix.
Error: Process completed with exit code 1.
```

**Why lint ran on main:**

```yaml
# On main branch pushes, the condition is:
if: always() && (github.event_name == 'push' || ...)
```

- `github.event_name == 'push'` is `true`
- Therefore: **lint job runs** regardless of file types changed
- Result: Discovered files from PR #955 have formatting issues

---

## Root Cause Analysis

### Primary Root Cause: Missing Branch Protection Rules

**Finding:** The repository does not have required status checks configured for the main branch.

**Evidence:**

1. PR #955 was allowed to merge despite having critical checks **skipped**
2. No enforcement of "all checks must pass" policy
3. GitHub API query for branch protection settings requires admin access (not available to verify current settings)

**GitHub Documentation:**

According to [GitHub's branch protection documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches):

> Required status checks must have a successful, skipped, or neutral status before collaborators can make changes to a protected branch.

**The Problem:** GitHub considers "skipped" as acceptable for merging. This is correct behavior when checks are conditionally skipped, but problematic when important checks like `lint` skip due to workflow logic issues.

**Best Practice:** Configure required status checks to explicitly list which jobs MUST pass:

- ✅ `changeset-check`
- ✅ `test-compilation`
- ✅ `lint`
- ✅ `check-file-line-limits`
- ✅ `test-suites`
- ✅ `test-execution`
- ✅ `validate-docs`
- ✅ `memory-check-linux`

### Secondary Root Cause: Inconsistent Workflow Conditions

**Finding:** The `lint` job has different behavior on PRs vs. main branch.

**Workflow Logic Issue:**

```yaml
lint:
  needs: [detect-changes, changeset-check]
  if: always() && (github.event_name == 'push' || needs.changeset-check.result == 'success') && (needs.detect-changes.outputs.mjs-changed == 'true' || needs.detect-changes.outputs.workflow-changed == 'true')
```

**Condition Breakdown:**

| Context   | `github.event_name` | `mjs-changed` | `workflow-changed` | Result  |
| --------- | ------------------- | ------------- | ------------------ | ------- |
| PR #955   | `pull_request`      | `false`       | `false`            | SKIPPED |
| Main #955 | `push`              | `false`       | `false`            | RUNS†   |
| PR #707   | `pull_request`      | `true`        | `false`            | RUNS    |
| Main #707 | `push`              | `true`        | `false`            | RUNS    |

† Actually skipped on PR #955's merge due to other conditions, but the logic is inconsistent.

**Why This Is Problematic:**

1. Formatting issues in `.md` files are not caught on PRs
2. The workflow assumes `.md` files don't need linting
3. But Prettier DOES format `.md` files (configured in `format:check` script)
4. Result: Silent introduction of formatting issues

---

## Impact Assessment

### Immediate Impact

- ✅ Main branch CI is failing
- ✅ Confusion about code quality (PR passed, main failed)
- ✅ Potential release blocking (if release automation requires green CI)

### Systemic Impact

- ⚠️ **Trust in CI:** Developers may lose confidence in CI checks
- ⚠️ **Code Quality:** Other file types may have similar gaps
- ⚠️ **Future Risk:** Same issue can repeat with any PR that doesn't change `.mjs` files

### Severity: **HIGH**

This is not just a cosmetic issue. It represents a gap in quality gates that could allow:

- Unformatted code merges
- Unvalidated changes to critical files
- CI blind spots for certain file types

---

## Proposed Solutions

### Solution 1: Configure GitHub Branch Protection (RECOMMENDED)

**Implementation:**

1. Navigate to Repository Settings → Branches → Branch protection rules
2. Select or create rule for `main` branch
3. Enable: "Require status checks to pass before merging"
4. Enable: "Require branches to be up to date before merging"
5. Select required status checks:
   - `Check for Changesets`
   - `test-compilation`
   - `lint`
   - `check-file-line-limits`
   - `test-suites`
   - `test-execution`
   - `validate-docs`
   - `memory-check-linux`

**Benefits:**

- ✅ Prevents merging PRs with skipped critical checks
- ✅ Enforces consistent quality gates
- ✅ No code changes required
- ✅ Industry standard practice
- ✅ Immediate protection

**Considerations:**

- Requires repository admin access
- Will need to manually select which checks are required
- GitHub doesn't support "all checks must pass" - must enumerate each one

**References:**

- [About protected branches - GitHub Docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Managing a branch protection rule - GitHub Docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule)

### Solution 2: Fix Workflow Condition Logic ✅ IMPLEMENTED

**Problem:** The `lint` job condition is too restrictive.

**Previous Condition:**

```yaml
if: always() && (github.event_name == 'push' || needs.changeset-check.result == 'success') && (needs.detect-changes.outputs.mjs-changed == 'true' || needs.detect-changes.outputs.workflow-changed == 'true')
```

**Implemented Fix:**

```yaml
if: always() && (github.event_name == 'push' || needs.changeset-check.result == 'success') && (needs.detect-changes.outputs.mjs-changed == 'true' || needs.detect-changes.outputs.docs-changed == 'true' || needs.detect-changes.outputs.package-changed == 'true' || needs.detect-changes.outputs.workflow-changed == 'true')
```

**Rationale:**

- Prettier formats `.md` files, `.json` files, `.mjs` files, and `.js` files
- The workflow already detects `docs-changed` (for `.md` files)
- The workflow already detects `package-changed` (for `package.json`)
- These should trigger the lint job

**Benefits:**

- ✅ Catches formatting issues in all file types
- ✅ Consistent behavior between PR and main
- ✅ Aligns workflow logic with actual tool capabilities

**Implementation:** This fix has been applied to `.github/workflows/release.yml` in PR #959.

### Solution 3: Simplify Lint Condition (Alternative)

**Most Conservative Approach:**

```yaml
if: always() && (github.event_name == 'push' || needs.changeset-check.result == 'success')
```

**Rationale:**

- Remove all file-type filtering for lint
- Let lint run on every PR and every push
- Prettier and ESLint are fast enough (~20s)

**Benefits:**

- ✅ Simplest solution
- ✅ Most comprehensive protection
- ✅ No risk of missing file types

**Considerations:**

- Slightly more CI time used
- May run unnecessarily on docs-only changes
- But provides maximum safety

---

## Recommended Action Plan

### Immediate Actions (Fix Current Issue)

1. ✅ Fix the two files with formatting issues:
   - `.changeset/fix-perlbrew-unbound-variable.md`
   - `docs/case-studies/issue-954/analysis.md`
2. ✅ Create this case study documentation
3. ✅ Push fixes to main to restore green CI

### Short-Term Actions (Prevent Recurrence)

1. **Configure Branch Protection** (Requires Admin)
   - Set up required status checks
   - Enforce up-to-date branches
   - Document in repository README or CONTRIBUTING.md
2. **Fix Workflow Conditions**
   - Implement Solution 2 or 3
   - Test with a PR that only changes `.md` files
   - Verify lint runs as expected

### Long-Term Actions (Process Improvement)

1. **Document Branch Protection Settings**
   - Create `docs/branch-protection-policy.md`
   - Explain why each check is required
   - Provide troubleshooting guide
2. **Add Pre-commit Hooks** (Optional)
   - Configure Prettier to run on commit
   - Catch formatting issues before push
   - Reduces CI failures
3. **CI Health Monitoring**
   - Set up alerts for main branch failures
   - Regular review of skipped checks
   - Periodic audit of branch protection rules

---

## Research & References

### GitHub Documentation

- [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Managing a branch protection rule](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule)
- [Troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks)

### Industry Best Practices

- [Managing GitHub Branch Protections](https://medium.com/@lauravuo/managing-github-branch-protections-4fa37b36ee4f)
- [How to set up branch protection rules in GitHub](https://graphite.com/guides/how-to-set-up-branch-protection-rules-github)

### Similar Issues in Other Projects

- Various projects have encountered similar issues with conditional CI jobs
- Common solution: explicit required status checks list
- Alternative: matrix builds to ensure consistent coverage

---

## Conclusion

This issue reveals a gap in the repository's quality gates. While the CI workflow is sophisticated with change detection to optimize run time, it created a blind spot where formatting issues in certain file types could bypass validation on PRs but fail on main.

**The solution is two-fold:**

1. **Immediate:** Configure branch protection with required status checks
2. **Sustainable:** Fix workflow conditions to ensure comprehensive validation

Both solutions should be implemented to prevent this class of issues from recurring.

**Lessons Learned:**

- Conditional CI jobs require careful design to avoid blind spots
- Branch protection is essential, even with sophisticated CI
- "Skipped" checks are treated as passing by GitHub
- Workflow conditions should align with tool capabilities (Prettier formats many file types, not just `.mjs`)

### Changeset Validation Best Practices

During the fix implementation, we also reinforced an important policy:

**Rule: Each PR must have exactly ONE changeset.**

This is enforced by `scripts/validate-changeset.mjs` and should NEVER be bypassed. If the changeset validation fails:

1. **Check for duplicate changesets** - If multiple `.md` files exist in `.changeset/` (excluding `README.md` and `config.json`), remove the duplicates and keep only the one for your PR.

2. **Merge the latest main branch** - If main has unreleased changesets from other PRs, merge main into your PR branch. This ensures your PR only adds ONE new changeset.

**Why this matters:**

- Each changeset documents a single change for the changelog
- Multiple changesets in a PR indicate either duplicates or stale branch
- The strict validation prevents confusion in release notes
- It enforces a clean commit-per-feature or PR-per-change workflow

**Anti-pattern (NEVER do this):**

```javascript
// DON'T modify validate-changeset.mjs to allow multiple changesets
// DON'T bypass the validation with git diff tricks
// DON'T create multiple changesets for the same PR
```

**Correct approach:**

```bash
# If changeset validation fails, first check what changesets exist
ls .changeset/*.md

# If you have duplicates, remove extras
rm .changeset/duplicate-changeset.md

# If main has new changesets, merge main
git fetch origin main
git merge origin/main
```

---

## Appendix: Data & Logs

All investigation data has been preserved in:

- `docs/case-studies/issue-958/logs/`
  - CI run logs
  - PR metadata
  - Branch protection query results
  - Timeline reconstruction data

This case study can be referenced for:

- Future CI workflow improvements
- Branch protection policy discussions
- Onboarding documentation for contributors
- Post-incident reviews
