---
'@link-assistant/hive-mind': patch
---

fix: default to PR-branch-only CI check, add pagination and typo fix (#1573)

- Fix typo: `--wait-for-all-actions-in-repository-before-mergable` → `--wait-for-all-actions-in-repository-before-mergeable` (deprecated alias kept for backward compatibility)
- When repo-wide flag is enabled, block on ALL active runs regardless of branch (no branch filtering) to ensure safety when CI/CD pipelines interact
- Add `--paginate` to `getPRCommitShas()` to load all PR commits (not just first page)
- Add all-commits CI check: verify CI completes for every commit on the PR branch, not just HEAD
- Add `getPRCommitShas()` and `checkAllPRCommitsCI()` for per-commit CI verification
