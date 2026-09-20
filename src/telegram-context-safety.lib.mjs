/**
 * Per-update Telegram instrumentation (issue #2166).
 *
 * Telegraf does **not** reuse `bot.telegram` when handling an update. Every
 * update gets a brand new `Telegram` client so that `webhookReply` can answer on
 * the open HTTP response:
 *
 * ```js
 * // telegraf/lib/telegraf.js — handleUpdate()
 * const tg = new telegram_1.default(this.token, this.telegram.options, webhookResponse);
 * const ctx = new TelegrafContext(update, tg, this.botInfo);
 * ```
 *
 * Consequently `ctx.telegram !== bot.telegram`, and anything installed on
 * `bot.telegram` (the plain-text formatting fallback, the rate-limit tracker) is
 * invisible to `ctx.reply()`, `ctx.telegram.sendMessage()` and
 * `ctx.telegram.editMessageText()` — which is how *every* command handler talks
 * to Telegram. That is why the `/stop` confirmation in issue #2166 died with an
 * unhandled `Can't find end of the entity starting at byte offset 65` instead of
 * degrading to plain text.
 *
 * This module re-installs the instrumentation on each freshly created context,
 * so a single send path — `installTelegramFormattingFallback` — covers the whole
 * bot regardless of which object a handler happens to call.
 *
 * @module telegram-context-safety.lib
 * @see https://github.com/link-assistant/hive-mind/issues/2166
 */

import { installTelegramFormattingFallback } from './telegram-safe-reply.lib.mjs';
import { installTelegramRateLimitTracker } from './telegram-rate-limit.lib.mjs';

/**
 * Install the formatting fallback and rate-limit tracker on one Telegram client.
 * Both installers are idempotent (guarded by a symbol), so calling this on an
 * already-protected client is a no-op.
 *
 * @param {object} telegram - A Telegraf `Telegram` client instance.
 * @param {{verbose?: boolean, fallbackLocale?: string|null, tracker?: object}} [options]
 * @returns {object|null} The same client, or `null` when there is nothing to protect.
 */
export function protectTelegramClient(telegram, options = {}) {
  if (!telegram) return null;
  const { verbose = false, fallbackLocale = null, tracker } = options;
  installTelegramFormattingFallback(telegram, { verbose, fallbackLocale });
  installTelegramRateLimitTracker(telegram, tracker ? { verbose, tracker } : { verbose });
  return telegram;
}

/**
 * Register the per-update protection as the very first middleware of a bot.
 *
 * Must run before any command handler so that handlers which call `ctx.reply()`
 * directly still get the plain-text fallback and the send audit log.
 *
 * @param {object} bot - A Telegraf bot instance.
 * @param {{verbose?: boolean, fallbackLocale?: string|null, tracker?: object}} [options]
 * @returns {object} The bot, for chaining.
 */
export function installTelegramContextSafety(bot, options = {}) {
  if (!bot) return bot;
  protectTelegramClient(bot.telegram, options);
  if (typeof bot.use === 'function') {
    bot.use((ctx, next) => {
      protectTelegramClient(ctx?.telegram, options);
      return next();
    });
  }
  return bot;
}
