---
'@link-assistant/hive-mind': patch
---

`--auto-restart-until-mergeable` no longer posts `🛑 Automation stopped: the AI session failed` after `🚨 Solution Draft Failed` for the same failed session (issue #4087). The failure comment already holds the error, the models and the log, and says the session ended, so one failure now gives one comment.

- The `tool_failure` and `tool_failure_after_resume` stop comments are skipped when the `Solution Draft Failed` comment reached the pull request. This covers both the comment with the attached log and the `Log Upload Failed` variant, which has the same heading and error.
- The stop comment is still posted when no failure comment reached the pull request (`--attach-logs` is off, or nothing could be posted), so every failure is still reported once.
- The terminal log lines and the recorded loop failure are unchanged.
