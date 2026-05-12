/**
 * Telegram /language command implementation.
 *
 * Allows each user to override the bot's reply language for the current
 * process. The override is in-memory only (resets when the bot restarts).
 *
 * Usage in chat:
 *   /language               -> show current language
 *   /language <en|ru|zh|hi> -> set language for this user
 *   /language default       -> clear the override (reset|clear also work)
 */

import { t, getSupportedLocales, normalizeLocale, setUserLocale, clearUserLocale, resolveLocaleFromTelegramCtx } from './i18n.lib.mjs';

export function registerLanguageCommand(bot, options = {}) {
  const { VERBOSE = false, isOldMessage, isForwardedOrReply } = options;

  bot.command('language', async ctx => {
    VERBOSE && console.log('[VERBOSE] /language command received');
    if (isOldMessage?.(ctx) || isForwardedOrReply?.(ctx)) return;
    const userId = ctx.from?.id;
    const locale = resolveLocaleFromTelegramCtx(ctx);
    const supported = getSupportedLocales();
    const supportedList = supported.join(', ');
    const text = ctx.message?.text || '';
    const parts = text.trim().split(/\s+/);
    const arg = parts.length > 1 ? parts[1] : null;
    if (!arg) {
      const langName = t(`language.${locale}`, {}, { locale });
      await ctx.reply(t('telegram.language_current', { language: langName, supported: supportedList }, { locale }), { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
      return;
    }
    if (['default', 'reset', 'clear'].includes(arg.toLowerCase())) {
      clearUserLocale(userId);
      const newLocale = resolveLocaleFromTelegramCtx(ctx);
      const langName = t(`language.${newLocale}`, {}, { locale: newLocale });
      await ctx.reply(t('telegram.language_set', { language: langName }, { locale: newLocale }), { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
      return;
    }
    const target = normalizeLocale(arg);
    if (!target) {
      await ctx.reply(t('telegram.language_invalid', { supported: supportedList }, { locale }), { reply_to_message_id: ctx.message.message_id });
      return;
    }
    setUserLocale(userId, target);
    const langName = t(`language.${target}`, {}, { locale: target });
    await ctx.reply(t('telegram.language_set', { language: langName }, { locale: target }), { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
  });
}
