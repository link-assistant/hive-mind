---
'@link-assistant/hive-mind': patch
---

fix: rename "attempt" to "iteration" in auto-restart messages (Issue #1456)

The auto-restart PR comment title and log message now use "iteration" instead of "attempt" to match the project's terminology. Affected messages:

- PR comment: `Auto-restart triggered (iteration N)` (was `attempt N`)
- Log: `Exiting auto-restart mode after N iterations` (was `attempts`)
