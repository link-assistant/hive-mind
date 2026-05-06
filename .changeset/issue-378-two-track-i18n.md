---
'@link-assistant/hive-mind': minor
---

Add `--ui-language` and `--work-language` flags for two-track i18n (issue #378). The existing `--language LOCALE` continues to set both tracks at once; `--ui-language LOCALE` overrides only UI/log strings, and `--work-language LOCALE` overrides only the language the AI uses for free-form output (PR/issue comments, commit messages, chat replies). Code, identifiers, and CLI strings stay in their original form. Supported locales: `en` (default), `ru`, `zh`, `hi`. The Telegram bot now resolves the user's effective locale and propagates it as `--language` to spawned solve/hive/task processes when no language flag is already present.
