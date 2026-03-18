---
'@link-assistant/hive-mind': patch
---

Add timeout for no-CI-checks waiting to prevent infinite loop (Issue #1442)

When `--auto-restart-until-mergeable` monitors a PR in a repo that has active GitHub Actions workflows but CI checks never start (e.g., fork PRs needing maintainer approval, `paths-ignore` filtering all changed files, workflow trigger conditions not matching), the monitoring loop now exits gracefully after a configurable timeout instead of waiting indefinitely.

New `--no-ci-checks-timeout` option (default: 10 iterations, ~10 min at 60s interval) controls the maximum wait. At timeout, the system checks PR mergeability and either exits successfully (PR is mergeable) or reports the issue with a diagnostic PR comment explaining possible reasons and requesting manual intervention.
