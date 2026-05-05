---
'@link-assistant/hive-mind': minor
---

Add internationalisation (i18n) for user-facing terminal output and the Telegram bot. Translations are stored in `links-notation` files under `src/locales/` (`en`, `ru`, `zh`, `hi`) and loaded via `lino-objects-codec`. Adds a `--language <en|ru|zh|hi>` option to `solve`, `hive`, `task`, and `review` (defaults to detected system locale). The Telegram bot picks each user's language from `ctx.from.language_code` with a per-user override settable through a new `/language <code|default>` command (in-memory, resets on bot restart). Built-in commands `/limits`, `/version`, `/solve`, `/hive`, and `/language` now reply in the user's selected language. AI prompts are intentionally untouched - only human-facing strings are translated.
