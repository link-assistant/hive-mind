---
"@link-assistant/hive-mind": patch
---

Telegram Bot API calls are now governed instead of only counted (#2571): chats refused with `retry_after` are held, requests are paced to the documented per-chat, per-group and broadcast windows, and low-priority refreshes (queue cards, `/top`, `/merge`) yield to replies and are skipped rather than retried. Waiting cards are edited only for news, so a big queue no longer triggers 429s. `/limits` shows the last 429 with its age and `retry_after`, and how much the bot held back. Also fixes, from the production log: usage-API 429/401 responses are cached (honouring `Retry-After`) and shared between concurrent callers, `bot.catch` no longer replies into a throttled chat, the `/stop` "Cancelled" card escapes user names, a truncated `gh` comment response no longer loses or duplicates the log-link comment, and the agentic CLI updater logs why an update failed.
