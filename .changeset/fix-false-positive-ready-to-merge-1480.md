---
'@link-assistant/hive-mind': patch
---

fix false positive "Ready to merge" by cross-validating CI success status with GitHub Actions workflow runs API and removing unreliable commit-age-based grace period (Issue #1480)
