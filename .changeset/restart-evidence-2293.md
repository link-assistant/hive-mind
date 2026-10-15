---
'@link-assistant/hive-mind': patch
---

Every auto-restart reason now comes with evidence (issue #2293). The "Auto-restart N/M" comment used to say only "CI failures detected" or "Issue title and description edited", so nobody could check from the pull request whether a restart was justified. It now lists each failing check with the URL of its run, each triggering comment with its author, time and link, and each issue title or description edit with what changed. The same lines are written to the log. When the same checks fail on consecutive restarts, both the comment and the next session's prompt say so, and the session is told to re-read the failing job logs and change approach. A repeated CI failure is flagged rather than stopped, because a session can make real progress on a check that is still failing. A session that changed nothing is already stopped by the existing no-progress guard.
