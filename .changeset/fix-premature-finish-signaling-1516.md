---
'@link-assistant/hive-mind': patch
---

Fix premature finish signaling and leaked child processes (Issue #1516)

- Kill entire process group on stream timeout using negative PID, preventing leaked /bin/sh child processes from continuing to make commits after completion
- Move .gitkeep cleanup to after all completion signals (log upload, "Ready to merge" comment) so no new commits appear after the system reports "session ended"
- drainHandles now actively SIGTERMs surviving child processes instead of only calling .unref() which left OS processes running
