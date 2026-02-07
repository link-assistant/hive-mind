---
'@link-assistant/hive-mind': patch
---

Increase limit reset buffer from 5 to 10 minutes and add random jitter (0-5 min) to avoid thundering herd problem when multiple instances wait for the same limit reset. Format reset time in PR comments with relative time and UTC timezone for better user understanding.
