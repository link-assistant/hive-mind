---
"@link-assistant/hive-mind": patch
---

Extend Telegram `/stop` to accept a GitHub issue or pull-request URL (passed as the argument or contained in the replied-to message). The bot looks the URL up in the in-memory solve queue and either cancels the queued item or forwards CTRL+C via `$ --stop <UUID>` to the running isolated session. The UUID flow from #524 and the chat-level pause flow from #1081 are preserved.
