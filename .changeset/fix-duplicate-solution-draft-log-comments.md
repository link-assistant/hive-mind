---
'@link-assistant/hive-mind': patch
---

Fix duplicate Solution Draft Log comments on GitHub PRs

When a Claude session ends with uncommitted changes and --attach-logs is enabled, the solution draft log was being uploaded twice - once by verifyResults() during normal completion, and again after temporary watch mode completes. This fix tracks whether logs were already uploaded and skips the duplicate upload.
