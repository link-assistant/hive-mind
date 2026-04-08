---
'@link-assistant/hive-mind': patch
---

Fix `--isolation screen` session monitoring bug where sessions were prematurely detected as completed (Issue #1545). Add `screen -ls` fallback for screen-backend sessions to work around start-command UUID mismatch issues (link-foundation/start#101).
