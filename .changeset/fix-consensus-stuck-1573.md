---
'@link-assistant/hive-mind': patch
---

fix: filter unrelated branch runs in CI consensus check (#1573)

- Change `--wait-for-all-actions-in-repository-before-mergable` default from true to false
- By default, only check CI on the PR branch (CheckRuns + WorkflowRuns for all commits)
- Add all-commits CI check: verify CI completes for every commit on the PR branch, not just HEAD
- When repo-wide flag is enabled, skip active runs on unrelated branches when PR CI is passing
- Add `getPRCommitShas()` and `checkAllPRCommitsCI()` for per-commit CI verification
