---
"@link-assistant/hive-mind": minor
---

Add experimental `--show-limits` virtual option to hive-telegram-bot's `/solve` and `/hive` commands. When set, the bot embeds a Claude (or Codex) usage snapshot in the executing message and a delta block (start → end, with a parallel-sessions disclaimer) in the completion message. Limits are fetched via the existing 20-minute cached helpers so the upstream usage API isn't rate-limited. The flag is stripped before the args reach `/solve` or `/hive`, and bot administrators can disable it with `TELEGRAM_SHOW_LIMITS=false`. Refs: #594.
