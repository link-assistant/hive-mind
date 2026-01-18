---
'@link-assistant/hive-mind': patch
---

Fix CLAUDE_WEEKLY_THRESHOLD not enforcing one-at-a-time mode when external Claude processes are running

- Fixed oneAtATime mode to also consider externally running Claude processes (detected via pgrep), not just queue-internal processing
- Standardized all threshold comparisons to use >= (inclusive) instead of mixed > and >= operators
- Updated documentation comments to accurately reflect inclusive threshold behavior
- Added README recommendation to capture bot logs using tee for post-incident analysis
- Added case study documentation for issue #1133
