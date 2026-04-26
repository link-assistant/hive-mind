---
'@link-assistant/hive-mind': patch
---

Telegram bot: add experimental `/subscribe` + `/unsubscribe` commands so users can opt in to receive a private DM forward of the `/solve` work-session completion message (commands work in both private and group chats; subscriptions are kept in memory and reset on bot restart). The completion message now includes both an `Issue:` line (the original URL passed to `/solve`) and, when the agent created a pull request for that issue, a follow-up `Pull request:` line so reviewers see both links without leaving the chat. (#1688)
