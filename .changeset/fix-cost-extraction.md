---
'@link-assistant/hive-mind': patch
---

Fix Anthropic cost extraction from JSON stream when session has error_during_execution

- Added anthropicTotalCostUSD to all failure return paths in executeClaudeCommand
- Changed cost capture logic to only extract from `subtype === 'success'` results
- This is explicit and reliable - error_during_execution results have zero cost
- Added case study documentation for issue #1104

Fixes #1104
