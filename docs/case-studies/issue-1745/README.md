# Case Study: Telegram Bot Token Leak (#1745)

Investigation, root cause, and fix for the leak documented in
[xlab2016/space_db_private#20 (comment 4104547747)](https://github.com/xlab2016/space_db_private/pull/20#issuecomment-4104547747),
where the bot's `TELEGRAM_BOT_TOKEN` ended up in a publicly visible PR comment.

See [`analysis.md`](analysis.md) for the full timeline, root cause, and fix.

## Files

- `analysis.md` — full report
- `data/issue-1745.json` — original bug report (issue body)
- `data/leaked-comment.txt` — the leaked PR comment body retrieved via `gh api`
