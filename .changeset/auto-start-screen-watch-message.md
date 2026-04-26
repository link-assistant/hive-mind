---
"@link-assistant/hive-mind": minor
---

Add live terminal watch support for hive-telegram-bot

This feature adds `/terminal_watch` plus the experimental `--auto-start-screen-watch-message` option. The command watches the log reported by `$ --status <uuid>` and updates a separate Telegram message with a terminal-sized text snapshot.

Key features:
- Manual `/terminal_watch <uuid>` command, including reply-based usage
- Configurable terminal snapshot size with `--size`, `--width`, and `--height`
- Auto-freezes the watch message and attaches the full log when the session ends
- Public repository logs can update in chat; private/unknown visibility uses DM for manual watches
- Auto-start remains off by default and never starts for private or unknown-visibility repositories

Based on the proof-of-concept from konard/telegram-terminal-bot.
