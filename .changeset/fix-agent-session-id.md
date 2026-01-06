---
'@link-assistant/hive-mind': patch
---

Fix session ID extraction error for --tool agent

- Fixed JSON parsing logic in agent tool to extract session IDs from NDJSON output
- Modified session summary to show informational message for agent tool instead of error
