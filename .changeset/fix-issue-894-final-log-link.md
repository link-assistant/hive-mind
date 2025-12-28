---
'@link-assistant/hive-mind': patch
---

Fix issue #894: Add final log file reference at end of solve command CLI output

Following the pattern used by Claude and other agents, the solve command now consistently displays the log file path as the final line of output. This ensures users always know where to find the complete log file, regardless of operations like log uploads, watch mode, or cleanup messages.
