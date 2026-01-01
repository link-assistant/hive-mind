---
'@link-assistant/hive-mind': patch
---

Fix --auto-continue-on-limit-reset flag not working

When Claude hit its usage limit with --auto-continue-on-limit-reset enabled, the code would exit early
via the failure branch before reaching showSessionSummary() where autoContinueWhenLimitResets() is called.

This patch adds a condition to skip the failure exit when limit is reached with auto-continue enabled,
allowing the code to properly wait for the limit to reset and resume the session.
