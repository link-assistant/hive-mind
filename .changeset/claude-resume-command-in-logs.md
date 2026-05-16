---
'@link-assistant/hive-mind': patch
---

Fix: Move Claude CLI resume command from GitHub comment to logs

When usage limit is reached, the GitHub comment now only mentions the
`--auto-continue-on-limit-reset` option instead of showing bash commands.
This is more user-friendly for Telegram bot users who don't use CLI commands directly.

The Claude CLI resume command is still available in the logs (in the collapsed
block or gist link), allowing advanced users to resume manually if needed:

```bash
(cd "/tmp/gh-issue-solver-..." && claude --resume session-id)
```

Changes:

- GitHub comments now only suggest using the `--auto-continue-on-limit-reset` option
- Resume commands are kept in logs only (not in the visible comment)
- Session ID is still shown for reference

Fixes #942
