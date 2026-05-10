---
'@link-assistant/hive-mind': patch
---

Stabilize the version-info timing test that broke CI/CD by using the same 30 second reasonable bound as the broader version-info structure test. The version collector still runs commands in parallel, but individual commands can legally spend 5 seconds on a timeout and then another 5 seconds on a fallback, so the previous 10 second wall-clock assertion was too tight for GitHub-hosted runners.
