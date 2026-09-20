# Technical Summary

## Changed Areas

- `src/telegram-safe-reply.lib.mjs`
  - Adds detection for Telegram formatting/entity parsing errors.
  - Retries formatted replies, sends, and edits as plain text.
  - Prepends a localized warning before fallback text.
  - Provides `installTelegramFormattingFallback()` for global `sendMessage` and `editMessageText` coverage.

- `src/telegram-bot.mjs`
  - Installs the global formatting fallback on bot startup.
  - Sends `/help`, `/limits`, and `/version` through safe reply/edit paths.
  - Passes the detected Telegram locale into `/limits`, `/version`, queue status, and solve rejection checks.

- `src/limits-i18n.lib.mjs` and `src/limits.lib.mjs`
  - Localize reset dates, reset durations, queue labels, waiting reasons, and compact duration units.
  - Preserve English default output for existing callers.

- `src/telegram-solve-queue.helpers.lib.mjs` and `src/telegram-solve-queue.lib.mjs`
  - Localize resource and API waiting reasons.
  - Localize queue status summaries, detailed queue output, item statuses, durations, and rejection reasons.

- `src/version-info.lib.mjs`
  - Localizes user-facing `/version` section titles, labels, restart state, and Playwright MCP connection state.
  - Keeps product, runtime, language, and tool names unchanged.

- `src/locales/*.lino`
  - Adds the new keys for English, Russian, Chinese, and Hindi.
  - Updates the Russian `/version` title to `Информация о версиях`.

## Regression Tests

Focused tests were added or extended for:

- Telegram formatting fallback and global send/edit wrapping.
- Russian `/version` labels.
- Russian `/limits` reset dates, reset durations, queue labels, and queue status words.
- Russian solve queue waiting reasons and duration units.
- Existing `/solve_queue` command behavior without preloaded locales.

The final verification log shows:

- `npm run lint`: passed.
- `npm test`: all 205 selected test files passed.
