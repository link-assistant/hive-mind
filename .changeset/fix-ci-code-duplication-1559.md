---
'@link-assistant/hive-mind': patch
---

Fix CI/CD lint failure caused by code duplication exceeding jscpd threshold (11.03% > 11%). Refactored test files to use shared `test-helpers.mjs` instead of duplicating assert/summary boilerplate, reducing duplication to 10.93%.
