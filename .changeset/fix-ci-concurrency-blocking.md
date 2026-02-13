---
'@link-assistant/hive-mind': patch
---

fix: prevent CI/CD release blocking by enabling cancel-in-progress for main branch (Issue #1274)

When multiple commits are pushed to main quickly (e.g., multiple PRs merged in succession),
the old concurrency configuration would queue newer runs indefinitely until older runs complete.
This caused releases to be blocked when Docker ARM64 builds took too long.

Changes:

- Add `cancel-in-progress: true` for main branch to allow newer releases to proceed
- PR branches still queue runs to avoid cancelling checks during development
- Document the issue and solution in docs/case-studies/issue-1274/
