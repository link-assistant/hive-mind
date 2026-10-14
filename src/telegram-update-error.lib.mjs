/**
 * Error handling for Telegram updates.
 *
 * One handler serves two callers: Telegraf's `bot.catch` (errors thrown while
 * an update is handled) and the background jobs that command handlers hand
 * their slow work to (see telegram-background-task.lib.mjs). Both report the
 * error and tell the user in the chat the update came from.
 *
 * @module telegram-update-error.lib
 * @see https://github.com/link-assistant/hive-mind/issues/3206
 */

import { extractCommandFromText } from './telegram-message-filters.lib.mjs';
import { isTelegramFormattingError, isTelegramMessageTooLongError, safeReply as defaultSafeReply, TELEGRAM_TEXT_LIMIT } from './telegram-safe-reply.lib.mjs';
import { isTelegramRateLimitError } from './telegram-rate-limit.lib.mjs';
import { cleanNonPrintableChars, escapeMarkdown, makeSpecialCharsVisible } from './telegram-markdown.lib.mjs';

/**
 * Telegraf rejects an update that runs longer than `handlerTimeout` with
 * `TimeoutError: Promise timed out after <n> milliseconds`. The handler keeps
 * running; only the polling loop stops waiting for it.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isTelegrafHandlerTimeoutError(error) {
  if (!error || typeof error !== 'object') return false;
  const message = typeof error.message === 'string' ? error.message : '';
  if (!/^Promise timed out after \d+ milliseconds$/.test(message)) return false;
  return error.name === 'TimeoutError' || error.constructor?.name === 'TimeoutError' || error.name === 'Error';
}

function redactSecrets(text) {
  return text
    .replace(/token[s]?\s*[:=]\s*[\w-]+/gi, 'token: [REDACTED]')
    .replace(/password[s]?\s*[:=]\s*[\w-]+/gi, 'password: [REDACTED]')
    .replace(/api[_-]?key[s]?\s*[:=]\s*[\w-]+/gi, 'api_key: [REDACTED]');
}

function logInputContext({ ctx, errorKind, failedCommand, logger }) {
  const userInfo = ctx.from ? { id: ctx.from.id, username: ctx.from.username, first_name: ctx.from.first_name, last_name: ctx.from.last_name } : 'unknown';
  logger.error(`[telegram-bot] ${errorKind} context - user: ${JSON.stringify(userInfo)}, command: ${failedCommand ? `/${failedCommand.command}` : 'unknown'}`);
  logger.error(`[telegram-bot] User input text: ${ctx.message?.text || 'none'}`);
  if (!ctx.message?.text) return;
  logger.error(`[telegram-bot] User input (special chars visible): ${makeSpecialCharsVisible(ctx.message.text, { maxLength: 500 })}`);
  const cleanedInput = cleanNonPrintableChars(ctx.message.text);
  if (cleanedInput !== ctx.message.text) {
    logger.error(`[telegram-bot] ${ctx.message.text.length - cleanedInput.length} hidden character(s) detected in input`);
  }
}

/**
 * Build the user-facing text for an error raised while handling `ctx`.
 *
 * @returns {string}
 */
export function buildUpdateErrorMessage(error, ctx, { verbose = false, failedCommand = null, logger = console } = {}) {
  const updateId = ctx.update?.update_id;
  const isTelegramParsingError = isTelegramFormattingError(error);
  const isTelegramTextLimitError = isTelegramMessageTooLongError(error);
  if (isTelegramParsingError || isTelegramTextLimitError) {
    // Issue #1460: detailed context for root cause analysis (always logged, not just in verbose mode)
    const errorKind = isTelegramTextLimitError ? 'Message length error' : 'Parsing error';
    logger.error(`[telegram-bot] ${errorKind}: ${error.message}`);
    logInputContext({ ctx, errorKind, failedCommand, logger });
    if (isTelegramTextLimitError) {
      return `❌ Telegram rejected an oversized bot message.\n\nThe bot splits messages above ${TELEGRAM_TEXT_LIMIT} characters automatically. Please try your command again.\n\nIf the issue persists, contact support with Update ID: ${updateId}`;
    }
    return `❌ Telegram rejected a formatted bot message, and the fallback handler could not recover automatically.\n\nPlease try your command again.\n\nIf the issue persists, contact support with Update ID: ${updateId}`;
  }
  let errorMessage = '❌ An error occurred while processing your request.\n\n';
  if (error?.message) {
    // Filter out sensitive info and escape markdown
    errorMessage += `Details: ${escapeMarkdown(redactSecrets(error.message))}\n`;
  }
  errorMessage += '\n💡 Troubleshooting:\n• Try running the command again\n• Check if all required parameters are correct\n• Use /help to see command examples\n• If the issue persists, contact support with the error details above';
  if (verbose) errorMessage += `\n\n🔍 Debug info: Update ID: ${updateId}`;
  return errorMessage;
}

/**
 * Create the handler for errors raised while an update is handled.
 *
 * @param {object} [deps]
 * @param {boolean} [deps.verbose]
 * @param {Function} [deps.reportError] - `(error, context) => void` (Sentry).
 * @param {Function} [deps.resolveLocale] - `ctx => locale` for the plain-text fallback.
 * @param {Function} [deps.safeReply]
 * @param {Console} [deps.logger]
 * @returns {(error: Error, ctx: object) => void}
 */
export function createUpdateErrorHandler({ verbose = false, reportError = () => {}, resolveLocale = () => null, safeReply = defaultSafeReply, logger = console } = {}) {
  return function handleUpdateError(error, ctx) {
    const updateId = ctx?.update?.update_id;
    if (isTelegrafHandlerTimeoutError(error)) {
      // The handler is still running and will report its own outcome; the
      // user has nothing to act on, so only the log hears about it.
      logger.warn(`[telegram-bot] Update ${updateId} is still being handled after Telegraf's handlerTimeout (${error.message}); polling continues without it.`);
      return;
    }
    logger.error('Unhandled error while processing update', updateId);
    logger.error('Error:', error);
    logger.error('Error details:', {
      name: error?.name,
      message: error?.message,
      stack: error?.stack?.split('\n').slice(0, 10).join('\n'),
    });
    const failedCommand = extractCommandFromText(ctx?.message?.text);
    if (verbose) {
      logger.log('[VERBOSE] Error context:', {
        chatId: ctx?.chat?.id,
        chatType: ctx?.chat?.type,
        messageText: ctx?.message?.text?.substring(0, 100),
        fromUser: ctx?.from?.username || ctx?.from?.id,
        updateId,
      });
    }

    // Report error to Sentry with context
    reportError(error, {
      telegramContext: {
        chatId: ctx?.chat?.id,
        chatType: ctx?.chat?.type,
        updateId,
        command: failedCommand ? `/${failedCommand.command}` : undefined,
        userId: ctx?.from?.id,
        username: ctx?.from?.username,
      },
    });
    // Issue #2571: a reply about a 429 goes to the chat Telegram just told the bot to
    // leave alone, so it was refused too (six 3×429 cascades in the production log).
    // The rate-limit warning above the stack already names the chat and retry_after.
    if (isTelegramRateLimitError(error)) {
      logger.error(`[telegram-bot] Not replying about update ${updateId}: Telegram rate limit in chat ${ctx?.chat?.id ?? 'unknown'} (${error.response?.description || error.message})`);
      return;
    }
    if (!ctx?.reply) return;
    // Try to notify the user about the error with more details
    const errorMessage = buildUpdateErrorMessage(error, ctx, { verbose, failedCommand, logger });
    safeReply(ctx, errorMessage, { fallbackLocale: resolveLocale(ctx), verbose }).catch(replyError => {
      logger.error('Failed to send error message to user:', replyError);
      const plainMessage = `An error occurred while processing your request. Please try again or contact support.\n\nError: ${error?.message || 'Unknown error'}`;
      Promise.resolve(ctx.reply(plainMessage)).catch(fallbackError => {
        logger.error('Failed to send fallback error message:', fallbackError);
      });
    });
  };
}
