/**
 * Telegram /subscribe and /unsubscribe command implementation (experimental).
 *
 * In-memory store of users who want to receive a private notification when
 * a /solve (or alias) work session completes. Storage is intentionally
 * volatile: subscriptions are cleared on bot restart since we do not yet
 * have a database (issue #1688).
 *
 * /subscribe and /unsubscribe work in both private chats and public group
 * chats. They store the Telegram user ID (not the chat ID) so a single
 * user only ever receives one private notification, regardless of which
 * chat they ran the command in.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1688
 */

// Map<userId, { username, firstName, subscribedAt, sourceChatId }>
const subscribers = new Map();

export function isSubscribed(userId) {
  if (userId === null || userId === undefined) return false;
  return subscribers.has(userId);
}

export function addSubscriber(userId, info = {}) {
  if (userId === null || userId === undefined) return false;
  const existed = subscribers.has(userId);
  subscribers.set(userId, {
    username: info.username || null,
    firstName: info.firstName || null,
    subscribedAt: existed ? subscribers.get(userId).subscribedAt : new Date(),
    sourceChatId: info.sourceChatId ?? null,
  });
  return !existed;
}

export function removeSubscriber(userId) {
  if (userId === null || userId === undefined) return false;
  return subscribers.delete(userId);
}

export function getSubscribers() {
  return Array.from(subscribers.entries()).map(([userId, info]) => ({ userId, ...info }));
}

export function getSubscriberCount() {
  return subscribers.size;
}

export function resetSubscribersForTests() {
  subscribers.clear();
}

/**
 * Forward (or send) a session-completion notification to every subscribed user
 * in their private chat with the bot.
 *
 * Strategy:
 *   1. Try forwardMessage(userId, sourceChatId, messageId) — preserves the
 *      original visual style of the reply Telegram users already see in chat.
 *   2. If that fails (e.g. the user has never started a private chat with
 *      the bot, or the message can't be forwarded), fall back to
 *      sendMessage(userId, fallbackText) so the notification still arrives
 *      when possible.
 *
 * Returns a summary so callers can log delivery results.
 *
 * @param {Object} params
 * @param {Object} params.bot - Telegraf bot instance
 * @param {number} params.fromChatId - Chat ID of the original /solve reply
 * @param {number} params.messageId - Message ID of the (now-edited) reply
 * @param {string} [params.fallbackText] - Plain-text body to send when forwardMessage is rejected
 * @param {Object} [params.fallbackOptions] - Telegram sendMessage options for fallback
 * @param {Set<number>} [params.skipUserIds] - Users that should not receive the notification (e.g. requester is already in the chat)
 * @param {boolean} [params.verbose]
 * @returns {Promise<{forwarded: number, sent: number, skipped: number, failures: Array}>}
 */
export async function notifySubscribers({ bot, fromChatId, messageId, fallbackText = '', fallbackOptions = {}, skipUserIds = null, verbose = false } = {}) {
  const summary = { forwarded: 0, sent: 0, skipped: 0, failures: [] };
  if (!bot || !bot.telegram) {
    if (verbose) console.log('[VERBOSE] notifySubscribers: missing bot/telegram, skipping');
    return summary;
  }

  for (const [userId, info] of subscribers.entries()) {
    if (skipUserIds && skipUserIds.has(userId)) {
      summary.skipped += 1;
      if (verbose) console.log(`[VERBOSE] notifySubscribers: skipping user ${userId} (in skip set)`);
      continue;
    }

    let forwarded = false;
    if (fromChatId !== null && fromChatId !== undefined && messageId !== null && messageId !== undefined) {
      try {
        await bot.telegram.forwardMessage(userId, fromChatId, messageId);
        summary.forwarded += 1;
        forwarded = true;
        if (verbose) {
          console.log(`[VERBOSE] notifySubscribers: forwarded to user ${userId} (${info.username || info.firstName || 'unknown'})`);
        }
      } catch (error) {
        if (verbose) {
          console.log(`[VERBOSE] notifySubscribers: forwardMessage to ${userId} failed: ${error?.message || error}`);
        }
      }
    }

    if (forwarded) continue;

    if (!fallbackText) {
      summary.failures.push({ userId, reason: 'forwardMessage failed and no fallback text supplied' });
      continue;
    }

    try {
      await bot.telegram.sendMessage(userId, fallbackText, fallbackOptions);
      summary.sent += 1;
      if (verbose) {
        console.log(`[VERBOSE] notifySubscribers: sent fallback message to user ${userId}`);
      }
    } catch (error) {
      summary.failures.push({ userId, reason: error?.message || String(error) });
      if (verbose) {
        console.log(`[VERBOSE] notifySubscribers: sendMessage to ${userId} failed: ${error?.message || error}`);
      }
    }
  }

  return summary;
}

const SUBSCRIBE_CONFIRMATION = '🔔 *Subscribed* (experimental)\n\n' + 'You will receive a private notification each time a /solve command finishes (in any chat where this bot runs).\n\n' + '⚠️ Subscriptions are kept in memory and are cleared whenever the bot restarts.\n\n' + '💡 If notifications never arrive, open a private chat with the bot and send /start so Telegram lets the bot DM you.\n\n' + 'Use /unsubscribe to stop receiving these notifications.';

const UNSUBSCRIBE_CONFIRMATION = '🔕 *Unsubscribed*\n\n' + 'You will no longer receive private notifications when /solve commands finish.\n\n' + 'Use /subscribe to resume notifications.';

const NOT_SUBSCRIBED_MESSAGE = 'ℹ️ You are not subscribed.\n\nUse /subscribe to start receiving private notifications when /solve commands finish.';

/**
 * Register /subscribe and /unsubscribe handlers.
 *
 * @param {Object} bot - Telegraf bot instance
 * @param {Object} options - Shared command options (VERBOSE, isOldMessage, ...)
 */
export function registerSubscribeCommands(bot, options = {}) {
  const { VERBOSE = false, isOldMessage, isForwardedOrReply, isTopicAuthorized, buildAuthErrorMessage, addBreadcrumb } = options;

  async function shouldHandle(ctx, cmdName) {
    VERBOSE && console.log(`[VERBOSE] ${cmdName} command received`);
    if (addBreadcrumb) {
      await addBreadcrumb({
        category: 'telegram.command',
        message: `${cmdName} command received`,
        level: 'info',
        data: { chatId: ctx.chat?.id, chatType: ctx.chat?.type, userId: ctx.from?.id, username: ctx.from?.username },
      });
    }
    if (isOldMessage && isOldMessage(ctx)) {
      VERBOSE && console.log(`[VERBOSE] ${cmdName} ignored: old message`);
      return false;
    }
    if (isForwardedOrReply && isForwardedOrReply(ctx)) {
      VERBOSE && console.log(`[VERBOSE] ${cmdName} ignored: forwarded or reply`);
      return false;
    }
    // Issue #1688: /subscribe and /unsubscribe work in both private and group chats.
    // In group chats we still require chat/topic authorization so unauthorized
    // chats cannot use the bot to spam.
    const chatType = ctx.chat?.type;
    const isPrivateChat = chatType === 'private';
    if (!isPrivateChat && isTopicAuthorized && !isTopicAuthorized(ctx)) {
      VERBOSE && console.log(`[VERBOSE] ${cmdName} ignored: not authorized`);
      if (buildAuthErrorMessage) {
        await ctx.reply(buildAuthErrorMessage(ctx), { reply_to_message_id: ctx.message?.message_id });
      }
      return false;
    }
    if (!ctx.from?.id) {
      VERBOSE && console.log(`[VERBOSE] ${cmdName} ignored: no user id on update`);
      return false;
    }
    return true;
  }

  bot.command('subscribe', async ctx => {
    if (!(await shouldHandle(ctx, '/subscribe'))) return;

    const userId = ctx.from.id;
    const wasNew = addSubscriber(userId, {
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      sourceChatId: ctx.chat?.id ?? null,
    });

    let message = SUBSCRIBE_CONFIRMATION;
    if (!wasNew) {
      message = 'ℹ️ You are already subscribed.\n\nUse /unsubscribe to stop receiving private notifications when /solve commands finish.';
    }

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_to_message_id: ctx.message?.message_id,
    });

    VERBOSE && console.log(`[VERBOSE] Subscriber ${userId} (${ctx.from.username || ctx.from.first_name || 'unknown'}) added (new=${wasNew}); total=${getSubscriberCount()}`);
  });

  bot.command('unsubscribe', async ctx => {
    if (!(await shouldHandle(ctx, '/unsubscribe'))) return;

    const userId = ctx.from.id;
    const wasRemoved = removeSubscriber(userId);

    await ctx.reply(wasRemoved ? UNSUBSCRIBE_CONFIRMATION : NOT_SUBSCRIBED_MESSAGE, {
      parse_mode: 'Markdown',
      reply_to_message_id: ctx.message?.message_id,
    });

    VERBOSE && console.log(`[VERBOSE] Subscriber ${userId} (${ctx.from.username || ctx.from.first_name || 'unknown'}) removed=${wasRemoved}; total=${getSubscriberCount()}`);
  });
}
