---
'@link-assistant/hive-mind': patch
---

Fix auto-restart spamming PR with comments when usage limit is reached (#1356)

When the AI tool's usage limit is reached during --auto-restart-until-mergeable mode, the loop now:

1. Detects the `limitReached` flag from the tool result
2. Silently waits for the limit reset time plus a 10-minute buffer (no GitHub comment posted)
3. Resumes the session using `--resume <sessionId>` with a "Continue" prompt, preserving context

For non-limit tool failures, the loop now stops immediately instead of retrying, preventing infinite loops on unrecoverable errors.
