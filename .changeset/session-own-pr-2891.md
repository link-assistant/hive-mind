---
'@link-assistant/hive-mind': patch
---

Kill-recovery notices, completion links and log attachments now use the session's own pull request. When an issue is linked to several pull requests (for example a parent plan pull request that lists its sub-issues), the bot picks the one on the `issue-<n>-*` branch of the session's issue and never one whose branch belongs to another issue; the session-log fallback prefers the `PR URL:` line printed by solve over the first pull request mentioned in the log. Without an own pull request, a failed recovery is reported on the session's issue (issue #2891).
