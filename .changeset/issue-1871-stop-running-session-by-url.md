---
"@link-assistant/hive-mind": patch
---

Fix `/stop <issue-or-pr-url>` so it can stop tasks that started immediately
(empty queue) or were already dispatched to a detached isolation session. The
URL lookup now also consults the session-monitor registry and forwards CTRL+C
to the tracked start-command UUID, so all three stop modes (issue URL, PR URL,
and session UUID) work end-to-end (#1871).
