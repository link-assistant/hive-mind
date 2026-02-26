---
'@link-assistant/hive-mind': patch
---

Fix auto-restart spamming PR with comments when usage limit is reached (#1356)

When the AI tool's usage limit is reached during --auto-restart-until-mergeable mode, the loop now detects the `limitReached` flag from the tool result and silently waits for the limit reset time plus a 10-minute buffer (consistent with how other parts of the codebase handle limit resets). No GitHub comment is posted during the wait. After the wait completes, the loop resumes automatically.
