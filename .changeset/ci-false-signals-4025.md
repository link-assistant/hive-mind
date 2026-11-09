---
'@link-assistant/hive-mind': patch
---

Fix false failures, false passes and noisy warnings in CI/CD (issue #4025): install lychee with retries and a checksum check, keep the lychee cache between runs and fail when lychee writes no report, keep the fixture cleanup inside its timeout, run the full unit suite on pull requests, report "finished without changes" for Formal AI drafts instead of a recovered log-upload 403, and refresh stale dependency pins (agent 0.27.2, jscpd 5.4.3, create-pull-request v8.1.2).
