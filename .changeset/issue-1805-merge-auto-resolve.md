---
'@link-assistant/hive-mind': minor
---

Add `--auto-resolve` to the `/merge` Telegram command. After the normal queue finishes, the bot now iterates every PR that was skipped because of merge conflicts and dispatches a `solve <pr-url> --auto-merge` session through `start-screen` — the same path other commands use — so conflict resolution runs with the default `sonnet` model and the PR is merged once the session finishes. Each PR/issue reference in the `/merge` progress and final messages is now rendered as a clickable MarkdownV2 link to the actual pull request or issue. Resolves #1805.
