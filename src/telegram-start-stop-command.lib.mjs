/**
 * Telegram /start and /stop command implementation
 *
 * This module provides the /start and /stop command functionality for the Telegram bot,
 * allowing chat owners to control whether the bot accepts new tasks in a specific chat.
 *
 * Features:
 * - Per-chat stop state management
 * - Owner-only access control (creator only, not admins)
 * - Graceful stop: existing queue items continue to process
 * - Read-only commands (/help, /limits, /version) remain available when stopped
 * - Write commands (/solve, /hive) are rejected when stopped
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1081
 */

// Store stopped chats: Map<chatId, { stoppedAt: Date, stoppedBy: { id, username, firstName } }>
const stoppedChats = new Map();

/**
 * Check if a chat is currently stopped
 * @param {number} chatId - The chat ID to check
 * @returns {boolean} True if the chat is stopped
 */
export function isChatStopped(chatId) {
  return stoppedChats.has(chatId);
}

/**
 * Get stop information for a chat
 * @param {number} chatId - The chat ID
 * @returns {Object|null} Stop info or null if not stopped
 */
export function getChatStopInfo(chatId) {
  return stoppedChats.get(chatId) || null;
}

/**
 * Set chat stopped state
 * @param {number} chatId - The chat ID
 * @param {boolean} stopped - Whether to stop or start the chat
 * @param {Object} user - The user who issued the command (for stop)
 */
export function setChatStopped(chatId, stopped, user = null) {
  if (stopped) {
    stoppedChats.set(chatId, {
      stoppedAt: new Date(),
      stoppedBy: user
        ? {
            id: user.id,
            username: user.username,
            firstName: user.first_name,
          }
        : null,
    });
  } else {
    stoppedChats.delete(chatId);
  }
}

/**
 * Get all stopped chats (for debugging/admin purposes)
 * @returns {Map} Map of stopped chats
 */
export function getStoppedChats() {
  return stoppedChats;
}

/**
 * Registers the /start and /stop command handlers with the bot
 * @param {Object} bot - The Telegraf bot instance
 * @param {Object} options - Options object
 * @param {boolean} options.VERBOSE - Whether to enable verbose logging
 * @param {Function} options.isOldMessage - Function to check if message is old
 * @param {Function} options.isForwardedOrReply - Function to check if message is forwarded/reply
 * @param {Function} options.isGroupChat - Function to check if chat is a group
 * @param {Function} options.isChatAuthorized - Function to check if chat is authorized
 */
export function registerStartStopCommands(bot, options) {
  const { VERBOSE = false, isOldMessage, isForwardedOrReply, isGroupChat, isChatAuthorized } = options;

  // /stop command - stop accepting new tasks in this chat
  // Only accessible by chat owner (creator)
  bot.command('stop', async ctx => {
    if (VERBOSE) {
      console.log('[VERBOSE] /stop command received');
    }

    // Ignore messages sent before bot started
    if (isOldMessage(ctx)) {
      if (VERBOSE) {
        console.log('[VERBOSE] /stop ignored: old message');
      }
      return;
    }

    // Ignore forwarded or reply messages
    if (isForwardedOrReply(ctx)) {
      if (VERBOSE) {
        console.log('[VERBOSE] /stop ignored: forwarded or reply');
      }
      return;
    }

    if (!isGroupChat(ctx)) {
      if (VERBOSE) {
        console.log('[VERBOSE] /stop ignored: not a group chat');
      }
      await ctx.reply('❌ The /stop command only works in group chats.', {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }

    const chatId = ctx.chat.id;
    if (!isChatAuthorized(chatId)) {
      if (VERBOSE) {
        console.log('[VERBOSE] /stop ignored: chat not authorized');
      }
      await ctx.reply(`❌ This chat (ID: ${chatId}) is not authorized to use this bot.`, {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }

    // Check if user is chat owner (creator only, not admins)
    try {
      const chatMember = await ctx.telegram.getChatMember(chatId, ctx.from.id);
      if (chatMember.status !== 'creator') {
        if (VERBOSE) {
          console.log('[VERBOSE] /stop ignored: user is not chat owner');
        }
        await ctx.reply('❌ This command is only available to the chat owner.', {
          reply_to_message_id: ctx.message.message_id,
        });
        return;
      }
    } catch (error) {
      console.error('[ERROR] Failed to check chat member status:', error);
      await ctx.reply('❌ Failed to verify permissions.', { reply_to_message_id: ctx.message.message_id });
      return;
    }

    if (VERBOSE) {
      console.log('[VERBOSE] /stop passed all checks, stopping...');
    }

    // Check if already stopped
    if (isChatStopped(chatId)) {
      const stopInfo = getChatStopInfo(chatId);
      const stoppedAtStr = stopInfo?.stoppedAt ? stopInfo.stoppedAt.toISOString() : 'unknown';
      await ctx.reply(`ℹ️ Bot is already stopped in this chat.\n\nStopped at: ${stoppedAtStr}\n\nUse /start to resume accepting tasks.`, {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }

    // Set chat as stopped
    setChatStopped(chatId, true, ctx.from);

    if (VERBOSE) {
      console.log(`[VERBOSE] Chat ${chatId} is now stopped`);
    }

    await ctx.reply(
      '🛑 *Bot Stopped*\n\n' +
        'This bot is now in read-only mode for this chat.\n\n' +
        '*Disabled commands:*\n' +
        '• /solve - No new issues will be accepted\n' +
        '• /hive - No new hive commands will be accepted\n\n' +
        '*Still available:*\n' +
        '• /help - Show help\n' +
        '• /limits - Show usage limits\n' +
        '• /version - Show version info\n' +
        '• /start - Resume accepting tasks (owner only)\n\n' +
        '💡 Any tasks already in queue will continue to process.',
      {
        parse_mode: 'Markdown',
        reply_to_message_id: ctx.message.message_id,
      }
    );
  });

  // /start command - resume accepting new tasks in this chat
  // Only accessible by chat owner (creator)
  // Note: This overrides Telegram's default /start behavior, but that's intentional
  // as in group chats we want this to control the bot's task acceptance
  bot.command('start', async ctx => {
    if (VERBOSE) {
      console.log('[VERBOSE] /start command received');
    }

    // Ignore messages sent before bot started
    if (isOldMessage(ctx)) {
      if (VERBOSE) {
        console.log('[VERBOSE] /start ignored: old message');
      }
      return;
    }

    // Ignore forwarded or reply messages
    if (isForwardedOrReply(ctx)) {
      if (VERBOSE) {
        console.log('[VERBOSE] /start ignored: forwarded or reply');
      }
      return;
    }

    // In private chats, show a welcome message instead
    if (!isGroupChat(ctx)) {
      if (VERBOSE) {
        console.log('[VERBOSE] /start in private chat: showing welcome');
      }
      await ctx.reply(
        '👋 *Welcome to SwarmMindBot!*\n\n' +
          'This bot helps solve GitHub issues using AI.\n\n' +
          'To use this bot:\n' +
          '1. Add me to a group chat\n' +
          '2. Make me an admin\n' +
          '3. Use /solve to solve GitHub issues\n\n' +
          'Use /help in a group chat for more information.',
        {
          parse_mode: 'Markdown',
        }
      );
      return;
    }

    const chatId = ctx.chat.id;
    if (!isChatAuthorized(chatId)) {
      if (VERBOSE) {
        console.log('[VERBOSE] /start ignored: chat not authorized');
      }
      await ctx.reply(`❌ This chat (ID: ${chatId}) is not authorized to use this bot.`, {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }

    // Check if user is chat owner (creator only, not admins)
    try {
      const chatMember = await ctx.telegram.getChatMember(chatId, ctx.from.id);
      if (chatMember.status !== 'creator') {
        if (VERBOSE) {
          console.log('[VERBOSE] /start ignored: user is not chat owner');
        }
        await ctx.reply('❌ This command is only available to the chat owner.', {
          reply_to_message_id: ctx.message.message_id,
        });
        return;
      }
    } catch (error) {
      console.error('[ERROR] Failed to check chat member status:', error);
      await ctx.reply('❌ Failed to verify permissions.', { reply_to_message_id: ctx.message.message_id });
      return;
    }

    if (VERBOSE) {
      console.log('[VERBOSE] /start passed all checks, starting...');
    }

    // Check if already running (not stopped)
    if (!isChatStopped(chatId)) {
      await ctx.reply('ℹ️ Bot is already accepting tasks in this chat.\n\nUse /help to see available commands.', {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }

    // Get stop info for the message
    const stopInfo = getChatStopInfo(chatId);
    const stoppedDuration = stopInfo?.stoppedAt ? Math.round((Date.now() - stopInfo.stoppedAt.getTime()) / 1000) : 0;

    // Clear the stopped state
    setChatStopped(chatId, false);

    if (VERBOSE) {
      console.log(`[VERBOSE] Chat ${chatId} is now started`);
    }

    let durationStr = '';
    if (stoppedDuration > 0) {
      if (stoppedDuration < 60) {
        durationStr = `${stoppedDuration} seconds`;
      } else if (stoppedDuration < 3600) {
        durationStr = `${Math.round(stoppedDuration / 60)} minutes`;
      } else {
        durationStr = `${Math.round(stoppedDuration / 3600)} hours`;
      }
    }

    await ctx.reply(
      '✅ *Bot Started*\n\n' + 'This bot is now accepting tasks in this chat.\n\n' + (durationStr ? `Bot was stopped for ${durationStr}.\n\n` : '') + 'Use /help to see available commands.',
      {
        parse_mode: 'Markdown',
        reply_to_message_id: ctx.message.message_id,
      }
    );
  });
}
