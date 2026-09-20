# Analysis

## Root Causes

The translation gaps came from four separate patterns:

1. Several Telegram messages called formatting functions without passing the detected Telegram locale.
2. Queue and limits helper functions returned English strings directly instead of going through locale-aware translation helpers.
3. `/version` mixed product names with section labels, but all labels were hard-coded in English.
4. `/help` and some message edits called Telegram directly with Markdown. If Telegram rejected a malformed entity, the bot surfaced a send failure instead of useful content.

## Important Findings

- Locale files were already available for `en`, `ru`, `zh`, and `hi`, but the queue/limits/version code paths did not consistently use them.
- Telegram formatting failures are recoverable when the text content is still valid plain text. The bot only needs to remove `parse_mode` and strip Markdown syntax on retry.
- Some tests import command modules without preloading locale files. User-facing text added to those modules needs an English fallback for deterministic unit tests and standalone library use.
- `src/limits.lib.mjs` was near the repository line limit. The new shared date/duration helpers were moved to `src/limits-i18n.lib.mjs` to keep lint clean.

## Related Work Checked

The related PR search artifact is stored in [related-prs.json](related-prs.json). The most relevant prior changes were:

- #384: initial terminal and Telegram i18n for `en/ru/zh/hi`.
- #388: split UI and work language tracks.
- #676: Telegram command UI localization.
- #1447 and #1638: `/limits` output and display fixes.

This fix extends those paths rather than replacing the existing i18n structure.

## Telegram Formatting Reference

The official Telegram Bot API formatting options document the message formatting mechanism and `parse_mode` selection for HTML, MarkdownV2, and Markdown: https://core.telegram.org/bots/api#formatting-options.

Implementation decision: keep the formatted send/edit as the primary path, then retry as plain text only for Telegram entity parsing errors such as “can't parse entities” or “can't find end of entity”. Non-formatting errors still propagate.
