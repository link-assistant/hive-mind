---
'@link-assistant/hive-mind': patch
---

Fix missing final solution log after auto-restart completion (Issue #1256)

When the solve command triggers auto-restart due to uncommitted changes, the final "Solution Draft Log" was not being uploaded to the PR after all auto-restarts completed. Only the "Auto-restart X/Y Log" comments were uploaded.

Root cause: The `logsAlreadyUploaded` flag was set to `true` after the initial session's log upload (before auto-restart), preventing the final log upload due to the duplicate prevention logic from Issue #1154.

Fix: Reset `logsAlreadyUploaded` to `false` when entering temporary watch mode (auto-restart), allowing the final log to be uploaded after all restarts complete successfully. This ensures users always get a final "Solution Draft Log" confirming the entire solve process finished.
