---
'@link-assistant/hive-mind': patch
---

Fix merge queue to wait for target branch CI before merging (Issue #1307). The merge queue now checks for active CI runs on the target branch (main) before processing the first PR in the queue. This prevents cancelled workflows, incomplete releases, and failed post-merge checks when multiple PRs are merged in quick succession.
