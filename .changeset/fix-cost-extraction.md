---
'@link-assistant/hive-mind': patch
---

Fix Anthropic cost extraction from JSON stream when session has error_during_execution

- Added anthropicTotalCostUSD to all failure return paths in executeClaudeCommand
- Changed cost capture logic to keep maximum non-zero cost instead of overwriting
- Prevents zero-cost error results from overwriting valid cost data
- Added case study documentation for issue #1104

Fixes #1104
