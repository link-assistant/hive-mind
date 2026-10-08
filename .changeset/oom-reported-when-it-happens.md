---
"@link-assistant/hive-mind": patch
---

Report a container OOM event on the pull request when it happens instead of after the session finishes (issue #2809). While the session is still running, the session monitor posts one "Container OOM event" comment. If `--attach-logs` is set, it uploads the working-session log first. When more processes are OOM-killed, it edits that comment, throttled, and never posts a new one. If the OOM stops the session, a separate kill/restart comment follows. A session that completes after an OOM event no longer posts a post-factum comment under "Ready to merge". Telegram still reports the event at completion and shows the number of OOM kills when there was more than one.

Refresh `@sentry/node` and `@sentry/profiling-node` to 11.6.0 to satisfy the dependency freshness gate after their release during validation.
