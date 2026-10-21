---
'@link-assistant/hive-mind': patch
---

Guard the bot against broad process kills from AI sessions without Docker isolation (#744, #733): every tool's system prompt now says to stop only processes started by the session (by recorded PID) and never to run `pkill node`, `killall`, `kill -9 -1` or `kill 0`; Claude sessions always get `--disallowedTools 'Bash(pkill:*)' 'Bash(killall:*)'`; and the Telegram bot sets `process.title = 'hive-telegram-bot'` so `pkill node` and `killall node` no longer match it.
