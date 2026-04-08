---
'@link-assistant/hive-mind': patch
---

Fix `--isolation screen` session monitoring bug where sessions were prematurely detected as completed (Issue #1545). Extract internal UUID from `$` CLI output for `$ --status` queries and add `screen -ls` fallback for screen-backend sessions to work around start-command UUID mismatch issues.
