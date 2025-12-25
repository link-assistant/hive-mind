---
'@link-assistant/hive-mind': patch
---

Fix Docker publish jobs being skipped after successful npm releases by adding always() to job conditions and explicit result checks
