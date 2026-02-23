---
'@link-assistant/hive-mind': patch
---

fix: prevent --auto-restart-until-mergeable infinite loop when no CI/CD is configured (Issue #1345)

Previously, when a repository had no GitHub Actions workflows configured, `--auto-restart-until-mergeable` would loop indefinitely because `getDetailedCIStatus()` returned `{ status: 'no_checks' }` and the code always treated this as a transient race condition (checks haven't started yet).

Now the fix correctly handles the `no_checks` case by also checking `checkPRMergeable()`. If GitHub reports the PR as `MERGEABLE` (`mergeStateStatus: CLEAN`), the repository has no required CI checks and the process exits immediately with an appropriate message ("No CI/CD checks are configured for this repository — PR is mergeable"). If the PR is not yet mergeable, the existing wait behavior is preserved.

Full case study analysis including timeline reconstruction from logs in `docs/case-studies/issue-1345/`.
