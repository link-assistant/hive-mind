---
"@link-assistant/hive-mind": minor
---

Add --auto-start-screen-watch-message option for hive-telegram-bot

This feature adds live terminal monitoring for screen sessions in Telegram. When enabled, the bot creates a message that updates every 2.5 seconds with the latest terminal output from the running screen session.

Key features:
- Real-time terminal monitoring with automatic message updates
- Displays last 25 lines of terminal output in code block format
- Automatically detects when screen session ends and freezes the message
- Attempts to attach full log file as document when session completes
- Automatically disabled for private repositories for security
- Off by default (opt-in with --auto-start-screen-watch-message flag)

Based on the proof-of-concept from konard/telegram-terminal-bot.
