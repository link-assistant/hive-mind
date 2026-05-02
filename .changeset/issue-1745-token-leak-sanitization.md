---
"@link-assistant/hive-mind": patch
---

Sanitize interactive-mode PR/issue comment bodies to prevent Telegram bot token leaks (#1745). `postComment`/`editComment` now run every body through `sanitizeAndWarn`, a `KNOWN_LOCAL_TOKEN_ENV_VARS` registry catches tokens by exact env value, the bot DMs chat owners with masked summaries when a leak is detected, a hidden owner-only `/tokens` Telegram command lists configured tokens (always masked), and `maskToken` now defaults to 3+3 characters per issue requirements.
