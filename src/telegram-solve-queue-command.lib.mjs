/**
 * Telegram /solve_queue command implementation
 *
 * This module provides the /solve_queue command functionality for the Telegram bot,
 * allowing users to view the current solve queue status.
 *
 * Features:
 * - Shows pending, processing, completed, and failed queue items
 * - Per-tool queue breakdown (claude, opencode, codex, agent, gemini, etc.)
 * - Lists currently processing and waiting items
 * - Running Claude process count
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1232
 */

import { t } from './i18n.lib.mjs';

const GROUP_ONLY_MESSAGE = '❌ The /solve_queue command only works in group chats. Please add this bot to a group and make it an admin.';

function commandText(key, params = {}, locale = null, fallback = key) {
  const translated = t(key, params, locale ? { locale } : {});
  return translated === key ? fallback : translated;
}

/**
 * Registers the /solve_queue command handler with the bot
 * @param {Object} bot - The Telegraf bot instance
 * @param {Object} options - Options object
 * @param {boolean} options.VERBOSE - Whether to enable verbose logging
 * @param {Function} options.isOldMessage - Function to check if message is old
 * @param {Function} options.isForwardedOrReply - Function to check if message is forwarded/reply
 * @param {Function} options.isGroupChat - Function to check if chat is a group
 * @param {Function} options.isChatAuthorized - Function to check if chat is authorized
 * @param {Function} [options.isTopicAuthorized] - Function to check if topic is authorized (issue #1100)
 * @param {Function} [options.buildAuthErrorMessage] - Function to build authorization error message
 * @param {Function} options.addBreadcrumb - Function to add breadcrumbs for monitoring
 * @param {Function} options.getSolveQueue - Function to get the solve queue instance
 * @returns {{ handleSolveQueueCommand: Function }} The command handler for use in text fallback
 */
export function registerSolveQueueCommand(bot, options) {
  const { VERBOSE = false, isOldMessage, isForwardedOrReply, isGroupChat, isChatAuthorized, isTopicAuthorized, buildAuthErrorMessage, addBreadcrumb, getSolveQueue, safeReply, resolveLocale } = options;

  async function handleSolveQueueCommand(ctx) {
    VERBOSE && console.log('[VERBOSE] /solve_queue command received');

    await addBreadcrumb({
      category: 'telegram.command',
      message: '/solve_queue command received',
      level: 'info',
      data: { chatId: ctx.chat?.id, chatType: ctx.chat?.type, userId: ctx.from?.id, username: ctx.from?.username },
    });
    const locale = resolveLocale ? resolveLocale(ctx) : null;
    const replyWithFallback = (text, replyOptions = {}) => (safeReply ? safeReply(ctx, text, replyOptions) : ctx.reply(text, { parse_mode: 'Markdown', ...replyOptions }));

    // Ignore messages sent before bot started
    if (isOldMessage(ctx)) {
      VERBOSE && console.log('[VERBOSE] /solve_queue ignored: old message');
      return;
    }

    // Ignore forwarded or reply messages
    if (isForwardedOrReply(ctx)) {
      VERBOSE && console.log('[VERBOSE] /solve_queue ignored: forwarded or reply');
      return;
    }

    if (!isGroupChat(ctx)) {
      VERBOSE && console.log('[VERBOSE] /solve_queue ignored: not a group chat');
      await replyWithFallback(commandText('telegram.solve_queue_only_in_groups', {}, locale, GROUP_ONLY_MESSAGE), {
        reply_to_message_id: ctx.message.message_id,
        fallbackLocale: locale,
      });
      return;
    }

    const authorize = isTopicAuthorized || (ctx => isChatAuthorized(ctx.chat.id));
    if (!authorize(ctx)) {
      VERBOSE && console.log('[VERBOSE] /solve_queue ignored: not authorized');
      const errMsg = buildAuthErrorMessage ? buildAuthErrorMessage(ctx) : `❌ This chat (ID: ${ctx.chat.id}) is not authorized.`;
      await replyWithFallback(errMsg, { reply_to_message_id: ctx.message.message_id, fallbackLocale: locale });
      return;
    }

    VERBOSE && console.log('[VERBOSE] /solve_queue passed all checks, generating status...');

    const solveQueue = getSolveQueue({ verbose: VERBOSE });

    // Use the queue's built-in detailed status formatter
    // Shows per-queue breakdown with first 5 items per queue and human-readable times
    // Processing counts are actual running system processes (via pgrep)
    // See: https://github.com/link-assistant/hive-mind/issues/1267
    const message = await solveQueue.formatDetailedStatus({ locale });

    await replyWithFallback(message, {
      reply_to_message_id: ctx.message.message_id,
      fallbackLocale: locale,
    });
  }

  // Match /solve_queue, /solve-queue, or /solvequeue (case-insensitive)
  // Note: Telegram Bot API only supports underscores in command names, not hyphens.
  // The entity-based matching handles /solve_queue and /solvequeue.
  // /solve-queue is handled by the text-based fallback in telegram-bot.mjs (issue #1232).
  bot.command(/^solve[_-]?queue$/i, handleSolveQueueCommand);

  return { handleSolveQueueCommand };
}
