---
'@link-assistant/hive-mind': patch
---

fix: prevent false positive 'Ready to merge' for repos with CI but no required branch protection (Issue #1363)

Previously, the auto-merge logic would incorrectly declare a PR "Ready to merge — no CI/CD configured" when a repository had GitHub Actions workflows but no required status checks in branch protection rules. This happened because:

- `mergeStateStatus=CLEAN` (no required checks to block merging)
- `check_runs=[]` (CI hadn't started yet — race condition, GitHub takes ~10-30s to register checks)

The fix adds a workflow detection step (`getActiveRepoWorkflows`) that queries the GitHub Actions API to check if the repository has any active workflows. When workflows exist but no checks have started, the system now correctly identifies this as a race condition (CI hasn't started yet) rather than "no CI configured", and waits for the checks to appear before proceeding.

Full case study analysis in `docs/case-studies/issue-1363/`.
