---
'@link-assistant/hive-mind': patch
---

feat: track sub-agent calls and show per-call stats in budget display (#1590)

- Split budget usage statistics per sub-agent call when working sessions contain multiple sub-agent invocations
- Extract and display individual sub-agent call metrics from Claude API session data
- Add budget stats library for parsing and formatting per-call usage information
