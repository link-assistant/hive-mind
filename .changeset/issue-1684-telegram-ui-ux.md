---
'@link-assistant/hive-mind': patch
---

Refine the Telegram bot work-session messages: introduce `🔄 Starting...` and `⏳ Executing...` to distinguish launch from execution, change the completion headline to `✅ Work session finished successfully` / `❌ Work session failed (exit code: N)`, show duration before session, and preserve the audit infoBlock (`Requested by`, `URL`, `🛠 Options`, `🔒 Locked options`) on every state — including completion and failure paths — so admins keep a record even when users delete their original `/solve` message.
