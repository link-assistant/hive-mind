# Branch Protection Policy

## Overview

This document outlines the branch protection rules and required status checks for the `main` branch of the hive-mind repository. These rules ensure code quality, prevent breaking changes, and maintain a stable main branch.

## Why Branch Protection?

Branch protection rules prevent:

- Merging pull requests with failing tests
- Merging code that doesn't meet formatting standards
- Introducing changes that haven't been validated by CI
- Accidental force pushes to the main branch
- Merging pull requests with skipped critical checks

**See:** [Case Study: Issue #958](./case-studies/issue-958/ANALYSIS.md) for a real-world example of what can happen without proper branch protection.

## Required Status Checks

All pull requests to `main` must have these checks pass before merging:

### Critical Checks (Must Pass)

1. **Check for Changesets** (`changeset-check`)
   - Ensures every PR includes a changeset for version management
   - Only runs on PRs, not on main branch pushes
   - Skipped for automated release PRs

2. **test-compilation**
   - Validates JavaScript syntax for all `.mjs` files
   - Ensures code compiles without syntax errors
   - Fast fail check (~7-8 seconds)

3. **lint**
   - Runs Prettier format check on all applicable files
   - Runs ESLint code quality checks
   - Validates code style consistency
   - ~20-26 seconds runtime

4. **check-file-line-limits**
   - Ensures no `.mjs` file exceeds 1500 lines
   - Encourages code modularity and maintainability
   - Fast check (~7 seconds)

5. **test-suites**
   - Runs comprehensive test suite
   - Validates core functionality
   - ~3-4 minutes runtime

6. **test-execution**
   - Tests actual command execution scenarios
   - Validates real-world usage patterns
   - ~2 minutes runtime

7. **validate-docs**
   - Ensures documentation files are valid
   - Checks for broken links or malformed content
   - ~8-12 seconds runtime

8. **memory-check-linux**
   - Tests for memory leaks and excessive usage
   - Ensures performance standards
   - ~30 seconds runtime

### Optional Checks (May Skip)

These checks run conditionally based on what files changed:

- **docker-pr-check**: Only runs when Docker-related files change
- **helm-pr-check**: Validates Helm charts if changed
- **Release jobs**: Only run on version bump commits

## Configuration Steps

### For Repository Administrators

To configure these rules in GitHub:

1. Navigate to **Settings** → **Branches**
2. Click **Add rule** or edit existing rule for `main`
3. Configure the following:

#### Basic Settings

- ✅ **Require a pull request before merging**
  - Required approvals: 0 (or 1 for stricter policy)
  - ✅ Dismiss stale pull request approvals when new commits are pushed
  - ⬜ Require review from Code Owners (optional)
- ✅ **Require status checks to pass before merging**
  - ✅ **Require branches to be up to date before merging**
  - Select the following status checks:
    - `Check for Changesets`
    - `test-compilation`
    - `lint`
    - `check-file-line-limits`
    - `test-suites`
    - `test-execution`
    - `validate-docs`
    - `memory-check-linux`
- ✅ **Require conversation resolution before merging** (recommended)
- ✅ **Do not allow bypassing the above settings** (recommended)

#### Additional Protections

- ⬜ **Require deployments to succeed before merging** (not applicable)
- ⬜ **Lock branch** (not recommended - prevents all pushes)
- ⬜ **Require linear history** (optional - enforces rebase or squash)

## Understanding Check Statuses

GitHub treats these statuses as acceptable for merging:

- ✅ **Success**: Check passed
- ⚠️ **Skipped**: Check was conditionally skipped
- ➖ **Neutral**: Check completed but with neutral result

⚠️ **Important:** "Skipped" is considered passing! This is why we must explicitly list required checks.

## What Happens Without Branch Protection?

Without these rules, the following can occur:

1. **Silent Failures**: PRs can merge with skipped checks, introducing issues
2. **Main Branch Failures**: Code that passes PR checks can fail on main
3. **Quality Degradation**: Formatting, linting, or test issues slip through
4. **Release Blocking**: Failed main branch CI can block releases

**Real Example:** PR #955 merged with `lint` check skipped because it only changed `.md` files. The workflow conditionally skips `lint` for non-code changes. After merge, main branch CI failed because those files had formatting issues.

## Workflow Conditional Logic

The CI workflow uses change detection to optimize CI time:

```yaml
detect-changes:
  outputs:
    mjs-changed: # true if .mjs files changed
    package-changed: # true if package.json changed
    docs-changed: # true if .md files changed
    workflow-changed: # true if workflow files changed
    docker-changed: # true if Docker files changed
    any-code-changed: # true if any code files changed
```

Jobs use these outputs to conditionally run:

```yaml
lint:
  if: |
    always() &&
    (github.event_name == 'push' || needs.changeset-check.result == 'success') &&
    (needs.detect-changes.outputs.mjs-changed == 'true' || needs.detect-changes.outputs.workflow-changed == 'true')
```

**Problem:** On PRs, `lint` only runs if `.mjs` or workflow files change. But on main branch pushes, it runs regardless. This inconsistency created the issue documented in case study #958.

**Branch Protection Solution:** By requiring `lint` to be in "success" state (not "skipped"), we ensure it always runs when needed.

## Troubleshooting

### Check Shows as "Expected" but Never Runs

**Cause:** The check name in branch protection doesn't match the job name in workflow.

**Solution:**

1. Go to a recent PR
2. Click "Show all checks"
3. Copy the exact check name as shown by GitHub
4. Use that exact name in branch protection settings

### Check Keeps Failing on Legitimate Changes

**Cause:** Check may be too strict or have a bug.

**Solution:**

1. Review the check's purpose
2. Fix the code to meet the check's requirements, OR
3. Update the check's logic if it's incorrectly failing

### Can't Merge Because Check is Stuck "Pending"

**Cause:** GitHub Actions runner issue or workflow syntax error.

**Solution:**

1. Check workflow runs in Actions tab
2. Look for errors in workflow YAML
3. Re-run failed checks
4. If persistent, may need to temporarily disable that specific check

## Maintenance

### Adding New Required Checks

When adding a new CI check that should always pass:

1. Add the check to the workflow
2. Test it on a PR
3. Once confirmed working, add it to branch protection required checks
4. Update this document

### Removing Required Checks

Only remove a required check if:

1. The check is obsolete or replaced by another check
2. The check has persistent false failures
3. Team consensus agrees it's not critical

Document the reason in this file.

## References

- [GitHub Docs: About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub Docs: Managing a branch protection rule](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule)
- [GitHub Docs: Troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks)
- [Case Study: Issue #958 - Unformatted Files Merged to Main](./case-studies/issue-958/ANALYSIS.md)

## Questions?

If you have questions about branch protection or need help with a specific scenario, please:

1. Check the case studies in `docs/case-studies/`
2. Review the workflow file: `.github/workflows/release.yml`
3. Open an issue with the `question` label

---

**Last Updated:** 2025-12-21
**Maintained By:** Repository maintainers
