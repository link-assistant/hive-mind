---
"@link-assistant/hive-mind": patch
---

Stop the auto-restart-until-mergeable and watch loops from treating the AI agent's own session comments (e.g. free-form "CI now green" status updates posted through the authenticated account) as new human feedback, which caused an endless restart loop until the iteration limit (issue #1827). The check window is now advanced monotonically, every comment the authenticated account posts during a session is tracked by ID, and watch-mode feedback counting excludes tool-generated comments by marker and tracked ID.
