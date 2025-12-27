---
'@link-assistant/hive-mind': patch
---

Fix URL hash fragment parsing - URLs with hash fragments like #issuecomment-123 are now correctly parsed. Previously, solving a PR with a comment URL like /pull/9#issuecomment-123 would fail because the PR number was extracted as "9#issuecomment-123" instead of "9".
