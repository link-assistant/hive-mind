---
"@link-assistant/hive-mind": patch
---

Fix two defects in the Telegram `/stop` command. (1) When `/stop` cancels a queued task by URL or reply, the original "⏳ Waiting (… queue #N)" card is now edited in place to show the task was cancelled (instead of leaving it stale). (2) Allow the user who originally ran `/solve` or `/hive` to `/stop` their own task by UUID or URL in a group chat, mirroring the requester authorization already used by `/terminal_watch` and `/watch` (PR #1779). The chat-creator fallback is preserved, so chat owners can still stop any task.
