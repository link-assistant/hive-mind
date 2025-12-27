---
'@link-assistant/hive-mind': patch
---

fix: ensure log attachment works when PR is merged during session

Fixes issue where log files would not be attached to pull requests when the PR was merged during the AI solving session. The `gh pr list` command only returns OPEN PRs by default, causing merged PRs to not be found. Added `--state all` flag to find PRs regardless of their state (OPEN, MERGED, or CLOSED), and added handling to skip operations that don't work on merged PRs (like `gh pr edit` and `gh pr ready`) while still allowing log attachment.
