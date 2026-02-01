/**
 * Message filtering functions for Telegram bot.
 * Extracted from telegram-bot.mjs for testability and reuse.
 *
 * These filters determine whether incoming messages should be processed
 * or silently ignored by the bot's command handlers.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1207
 * @see https://core.telegram.org/bots/features#privacy-mode
 */

/**
 * Check if a message was sent before the bot started.
 * Prevents processing old/pending messages from before the current bot instance startup.
 *
 * @param {Object} ctx - Telegraf context object
 * @param {number} botStartTime - Unix timestamp (seconds) of when bot started
 * @param {Object} [options] - Options
 * @param {boolean} [options.verbose] - Enable verbose logging
 * @returns {boolean} true if message is old and should be ignored
 */
export function isOldMessage(ctx, botStartTime, options = {}) {
  const messageDate = ctx.message?.date;
  if (!messageDate) {
    return false;
  }
  const isOld = messageDate < botStartTime;
  if (options.verbose && isOld) {
    console.log(`[VERBOSE] isOldMessage: TRUE - message date ${messageDate} < bot start ${botStartTime}`);
  }
  return isOld;
}

/**
 * Check if the chat is a group or supergroup.
 *
 * @param {Object} ctx - Telegraf context object
 * @returns {boolean} true if chat is a group or supergroup
 */
export function isGroupChat(ctx) {
  const chatType = ctx.chat?.type;
  return chatType === 'group' || chatType === 'supergroup';
}

/**
 * Check if a chat ID is in the allowed chats whitelist.
 *
 * @param {number} chatId - The chat ID to check
 * @param {number[]|null} allowedChats - Array of allowed chat IDs, or null for no restrictions
 * @returns {boolean} true if chat is authorized
 */
export function isChatAuthorized(chatId, allowedChats) {
  if (!allowedChats) {
    return true;
  }
  return allowedChats.includes(chatId);
}

/**
 * Check if a message is forwarded or a reply to another user's message.
 *
 * This function distinguishes between:
 * 1. Forwarded messages (should be ignored)
 * 2. User replies to other messages (should be ignored, except for /solve reply feature)
 * 3. Forum topic messages (should NOT be ignored - they have reply_to_message pointing
 *    to the topic's first message with forum_topic_created)
 * 4. Normal messages (should NOT be ignored)
 *
 * @param {Object} ctx - Telegraf context object
 * @param {Object} [options] - Options
 * @param {boolean} [options.verbose] - Enable verbose logging
 * @returns {boolean} true if message is forwarded or a reply (and should be filtered)
 */
export function isForwardedOrReply(ctx, options = {}) {
  const message = ctx.message;
  if (!message) {
    if (options.verbose) {
      console.log('[VERBOSE] isForwardedOrReply: No message object');
    }
    return false;
  }

  if (options.verbose) {
    console.log('[VERBOSE] isForwardedOrReply: Checking message fields...');
    console.log('[VERBOSE]   message.forward_origin:', JSON.stringify(message.forward_origin));
    console.log('[VERBOSE]   message.forward_origin?.type:', message.forward_origin?.type);
    console.log('[VERBOSE]   message.forward_from:', JSON.stringify(message.forward_from));
    console.log('[VERBOSE]   message.forward_from_chat:', JSON.stringify(message.forward_from_chat));
    console.log('[VERBOSE]   message.forward_from_message_id:', message.forward_from_message_id);
    console.log('[VERBOSE]   message.forward_signature:', message.forward_signature);
    console.log('[VERBOSE]   message.forward_sender_name:', message.forward_sender_name);
    console.log('[VERBOSE]   message.forward_date:', message.forward_date);
    console.log('[VERBOSE]   message.reply_to_message:', JSON.stringify(message.reply_to_message));
    console.log('[VERBOSE]   message.reply_to_message?.message_id:', message.reply_to_message?.message_id);
  }

  // Check if message is forwarded (has forward_origin field with actual content)
  // Note: We check for .type because Telegram might send empty objects {}
  // which are truthy in JavaScript but don't indicate a forwarded message
  if (message.forward_origin && message.forward_origin.type) {
    if (options.verbose) {
      console.log('[VERBOSE] isForwardedOrReply: TRUE - forward_origin.type exists:', message.forward_origin.type);
    }
    return true;
  }
  // Also check old forwarding API fields for backward compatibility
  if (message.forward_from || message.forward_from_chat || message.forward_from_message_id || message.forward_signature || message.forward_sender_name || message.forward_date) {
    if (options.verbose) {
      console.log('[VERBOSE] isForwardedOrReply: TRUE - old forwarding API field detected');
    }
    return true;
  }
  // Check if message is a reply (has reply_to_message field with actual content)
  // Note: We check for .message_id because Telegram might send empty objects {}
  // IMPORTANT: In forum groups, messages in topics have reply_to_message pointing to the topic's
  // first message (with forum_topic_created). These are NOT user replies, just part of the thread.
  // We must exclude these to allow commands in forum topics.
  if (message.reply_to_message && message.reply_to_message.message_id) {
    // If the reply_to_message is a forum topic creation message, this is NOT a user reply
    if (message.reply_to_message.forum_topic_created) {
      if (options.verbose) {
        console.log('[VERBOSE] isForwardedOrReply: FALSE - reply is to forum topic creation, not user reply');
        console.log('[VERBOSE]   Forum topic:', message.reply_to_message.forum_topic_created);
      }
      // This is just a message in a forum topic, not a reply to another user
      // Allow the message to proceed
    } else {
      // This is an actual reply to another user's message
      if (options.verbose) {
        console.log('[VERBOSE] isForwardedOrReply: TRUE - reply_to_message.message_id exists:', message.reply_to_message.message_id);
      }
      return true;
    }
  }

  if (options.verbose) {
    console.log('[VERBOSE] isForwardedOrReply: FALSE - no forwarding or reply detected');
  }
  return false;
}
