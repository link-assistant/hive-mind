---
'@link-assistant/hive-mind': patch
---

Fix session finish message update not working (#1530): pass --auto-terminate to start-screen so screen sessions terminate when the command finishes, enabling completion detection via session monitoring. Remove misleading notification promise text. Add verbose logging to session monitoring.
