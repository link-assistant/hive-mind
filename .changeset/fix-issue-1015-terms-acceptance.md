---
'@link-assistant/hive-mind': patch
---

Fix Claude Code terms acceptance treated as success

- Detect Claude CLI terms acceptance messages and treat as error requiring human intervention
- Hide cost estimation section when all values are unknown
- Fix code block escaping in log comments using zero-width spaces
