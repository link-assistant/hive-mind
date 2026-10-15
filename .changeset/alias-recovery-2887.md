---
'@link-assistant/hive-mind': patch
---

Kill recovery of a task started with a Telegram alias such as `/codex` runs `solve`, never the alias (issue #2887). A regression test replays the router#728 incident and checks both the in-place `$ --resume` command and the fresh-launch fallback. If an in-place recovery session still exits with 126 or 127 and that exit is only noticed when the session completes, the session is no longer dropped. Recovery starts again as a fresh isolated session under the same attempt number. A fresh session that fails this way is not retried again. The completion message for an exit of 127 or 126 now says "command not found" or "command not executable" in every locale. A recovery container's own exit 127 is still reported as a failure, not as its predecessor's `oom-killed`.
