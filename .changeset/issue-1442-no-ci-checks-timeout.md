---
'@link-assistant/hive-mind': patch
---

Use workflow runs API to detect when CI is not triggered, preventing infinite loop (Issue #1442)

When `--auto-restart-until-mergeable` monitors a PR in a repo that has active GitHub Actions workflows but CI checks never start (e.g., fork PRs needing maintainer approval, `paths-ignore` filtering all changed files, workflow trigger conditions not matching), the monitoring loop now exits immediately instead of waiting indefinitely.

Instead of using a timeout-based approach, the fix uses the GitHub Actions workflow runs API (`repos/{owner}/{repo}/actions/runs?head_sha={sha}`) to definitively determine if any workflow runs were triggered for the PR's commit. If zero workflow runs exist, CI was not triggered and there is nothing to wait for — the system exits immediately with a diagnostic PR comment.
