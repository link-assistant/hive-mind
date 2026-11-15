---
'@link-assistant/hive-mind': patch
---

A red Formal AI draft is now explained from solve's own `solve-*.log` (newest first), not from whichever `*.log` in the log directory is newest (issue #4065). A caller's capture files, such as formal-ai's `attempt.log`, no longer hide the `Finished without changes: …` reason behind `docker run exited N without a session log error`. Any other `*.log` is read only when no `solve-*.log` exists.
