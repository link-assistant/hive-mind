---
'@link-assistant/hive-mind': patch
---

Fix auto-restart spamming PR with comments when usage limit is reached (#1356)

When the AI tool's usage limit is reached during --auto-restart-until-mergeable mode, the loop now detects the `limitReached` flag from the tool result and exits gracefully instead of continuing to post repeated "Auto-restart triggered" comments. A single "Usage Limit Reached" notification is posted with deduplication to prevent spam.
