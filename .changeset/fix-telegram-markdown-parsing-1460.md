---
'@link-assistant/hive-mind': patch
---

Fix /solve command "can't parse entities" error by escaping special characters in user mentions, options text, and server overrides. Add automatic plain text fallback when Telegram rejects Markdown formatting. Improve error messages to always show debug info for parsing errors.
