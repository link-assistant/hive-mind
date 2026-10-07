---
'@link-assistant/hive-mind': patch
---

Stop appending a generated "Changes" section (file and line counts, file list) to a pull request description after the agent has written it, on both normal completion and restarts. Missing issue-closing links are still appended, now after a separator. The initial placeholder description and its replacement when the agent never updated it are unchanged.
