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
 * - `/stop <UUID>` or reply-to-message-with-UUID forwards CTRL+C to the
 *   matching isolated solve/hive session via `$ --stop <UUID>` from
 *   link-foundation/start (issue #524).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1081
 * @see https://github.com/link-assistant/hive-mind/issues/524
 * @see https://github.com/link-foundation/start/issues/112
 */

import { extractSessionIdFromText } from './telegram-log-command.lib.mjs';

// Store stopped chats: Map<chatId, { stoppedAt: Date, stoppedBy: { id, username, firstName }, reason?: string }>
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
 * @param {string} [reason] - Optional reason for stopping (only used when stopped=true)
 */
export function setChatStopped(chatId, stopped, user = null, reason = null) {
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
      reason: reason || null,
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
 * Default reason used when no custom reason is provided for /stop
 */
export const DEFAULT_STOP_REASON = 'This bot is currently not accepting new tasks.';

/**
 * Get rejection message for when a command is used on a stopped chat.
 * Matches the style of queue `rejected` mode output for consistency.
 * @param {number} chatId - The chat ID
 * @param {string} commandName - The command that was rejected (e.g., 'Solve', 'Hive')
 * @returns {string} Markdown-formatted rejection message
 */
export function getStoppedChatRejectMessage(chatId, commandName = 'Command') {
  const stopInfo = getChatStopInfo(chatId);
  const reason = stopInfo?.reason || DEFAULT_STOP_REASON;
  return `❌ ${commandName} command rejected.\n\n🚫 Reason: ${reason}\n\nUse /start to resume (chat owner only).`;
}

/**
 * Extract a session UUID for `/stop`. Priority:
 *   1. UUID literal anywhere in the `/stop` message text.
 *   2. UUID in the text/caption of the message being replied to.
 *
 * The `text` argument is the raw `/stop ...` command text. `repliedTo`, when
 * present, is the Telegram message object that the user replied to with `/stop`.
 *
 * @param {string} text
 * @param {Object|null|undefined} repliedTo
 * @returns {{ sessionId: string|null, source: 'argument'|'reply'|null }}
 */
export function extractStopSessionId(text, repliedTo) {
  // Strip the leading `/stop` (or `/stop@botname`) before looking for a UUID,
  // so we don't accidentally match digits inside the command name itself.
  const argText = String(text || '').replace(/^\/stop(?:@\w+)?\s*/i, '');
  const direct = extractSessionIdFromText(argText);
  if (direct) return { sessionId: direct, source: 'argument' };
  const replyText = repliedTo ? `${repliedTo.text || ''}\n${repliedTo.caption || ''}` : '';
  const fromReply = extractSessionIdFromText(replyText);
  if (fromReply) return { sessionId: fromReply, source: 'reply' };
  return { sessionId: null, source: null };
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
 * @param {Function} [options.isTopicAuthorized] - Topic-level authorization fallback
 * @param {Function} [options.buildAuthErrorMessage] - Builds the chat-not-authorized message
 * @param {Function} [options.stopIsolatedSession] - Override for tests; calls `$ --stop <uuid>`
 */
export function registerStartStopCommands(bot, options) {
  const { VERBOSE = false, isOldMessage, isForwardedOrReply, isGroupChat, isChatAuthorized, isTopicAuthorized, buildAuthErrorMessage } = options;
  const stopIsolatedSessionImpl = options.stopIsolatedSession || (async (...args) => (await import('./isolation-runner.lib.mjs')).stopIsolatedSession(...args));

  /**
   * Validate command context: checks old message, forwarded, group chat, authorized, and owner status.
   * @param {Object} ctx - Telegraf context
   * @param {string} cmdName - Command name for logging (e.g., '/stop', '/start')
   * @param {Object} [opts] - Options
   * @param {boolean} [opts.allowPrivate] - If true, skip group chat check (for /start welcome)
   * @returns {Promise<{valid: boolean, chatId?: number, isPrivate?: boolean}>}
   */
  async function validateOwnerCommand(ctx, cmdName, opts = {}) {
    VERBOSE && console.log(`[VERBOSE] ${cmdName} command received`);
    if (isOldMessage(ctx)) {
      VERBOSE && console.log(`[VERBOSE] ${cmdName} ignored: old message`);
      return { valid: false };
    }
    if (isForwardedOrReply(ctx)) {
      VERBOSE && console.log(`[VERBOSE] ${cmdName} ignored: forwarded or reply`);
      return { valid: false };
    }
    if (!isGroupChat(ctx)) {
      if (opts.allowPrivate) return { valid: false, isPrivate: true };
      VERBOSE && console.log(`[VERBOSE] ${cmdName} ignored: not a group chat`);
      await ctx.reply(`❌ The ${cmdName} command only works in group chats.`, { reply_to_message_id: ctx.message.message_id });
      return { valid: false };
    }
    const chatId = ctx.chat.id;
    if (!isChatAuthorized(chatId)) {
      VERBOSE && console.log(`[VERBOSE] ${cmdName} ignored: chat not authorized`);
      await ctx.reply(`❌ This chat (ID: ${chatId}) is not authorized to use this bot.`, { reply_to_message_id: ctx.message.message_id });
      return { valid: false };
    }
    try {
      const chatMember = await ctx.telegram.getChatMember(chatId, ctx.from.id);
      if (chatMember.status !== 'creator') {
        VERBOSE && console.log(`[VERBOSE] ${cmdName} ignored: user is not chat owner`);
        await ctx.reply('❌ This command is only available to the chat owner.', { reply_to_message_id: ctx.message.message_id });
        return { valid: false };
      }
    } catch (error) {
      console.error('[ERROR] Failed to check chat member status:', error);
      await ctx.reply('❌ Failed to verify permissions.', { reply_to_message_id: ctx.message.message_id });
      return { valid: false };
    }
    VERBOSE && console.log(`[VERBOSE] ${cmdName} passed all checks`);
    return { valid: true, chatId };
  }

  // /stop command. Two modes:
  //   1. `/stop <UUID>` or reply-to-message-with-UUID — forward CTRL+C to the
  //      matching isolated session via `$ --stop <UUID>` (issue #524).
  //   2. bare `/stop` (optionally with a free-text reason) — pause new task
  //      acceptance for the chat (issue #1081).
  // Only accessible by chat owner (creator) in both modes.
  bot.command('stop', async ctx => {
    VERBOSE && console.log('[VERBOSE] /stop command received');
    if (isOldMessage(ctx)) {
      VERBOSE && console.log('[VERBOSE] /stop ignored: old message');
      return;
    }

    // Detect UUID modes BEFORE the forwarded/reply rejection used by the
    // chat-level stop, because the UUID-from-reply mode is intentionally a
    // reply (issue #524).
    const message = ctx.message;
    const repliedTo = message?.reply_to_message || null;
    const { sessionId, source } = extractStopSessionId(message?.text || '', repliedTo);

    if (sessionId) {
      VERBOSE && console.log(`[VERBOSE] /stop: detected UUID ${sessionId} (source=${source})`);
      // Reuse the same auth model as /log: must be chat owner in groups; in
      // private DMs the user is implicitly the owner of their own chat.
      const chatId = ctx.chat?.id;
      const chatType = ctx.chat?.type;
      if (chatType !== 'private') {
        if (!isGroupChat(ctx)) {
          await ctx.reply('❌ The /stop command only works in group chats or private chats with the bot.', { reply_to_message_id: message.message_id });
          return;
        }
        if (!isChatAuthorized(chatId)) {
          if (!isTopicAuthorized || !isTopicAuthorized(ctx)) {
            const errMsg = buildAuthErrorMessage ? buildAuthErrorMessage(ctx) : `❌ This chat (ID: ${chatId}) is not authorized to use this bot.`;
            await ctx.reply(errMsg, { reply_to_message_id: message.message_id });
            return;
          }
        }
        try {
          const member = await ctx.telegram.getChatMember(chatId, ctx.from.id);
          if (!member || member.status !== 'creator') {
            VERBOSE && console.log('[VERBOSE] /stop <UUID> ignored: user is not chat owner');
            await ctx.reply('❌ /stop <UUID> is only available to the chat owner.', { reply_to_message_id: message.message_id });
            return;
          }
        } catch (error) {
          console.error('[ERROR] /stop <UUID>: getChatMember failed:', error);
          await ctx.reply('❌ Failed to verify permissions for /stop.', { reply_to_message_id: message.message_id });
          return;
        }
      }

      const ack = await ctx.reply(`⏹️ Asking session \`${sessionId}\` to stop (sending CTRL+C via \`$ --stop\`)…`, {
        parse_mode: 'Markdown',
        reply_to_message_id: message.message_id,
      });

      let result;
      try {
        result = await stopIsolatedSessionImpl(sessionId, VERBOSE);
      } catch (error) {
        console.error('[ERROR] /stop <UUID>: stopIsolatedSession threw:', error);
        result = { success: false, output: '', error: error?.message || String(error) };
      }

      const trimmedOutput = (result.output || '').toString().trim();
      const trimmedError = (result.error || '').toString().trim();
      const lines = [];
      if (result.success) {
        lines.push(`✅ Stop request sent to session \`${sessionId}\`.`);
        lines.push('');
        lines.push('The session should terminate shortly.');
        if (trimmedOutput) {
          lines.push('');
          lines.push('```');
          lines.push(trimmedOutput.slice(0, 1000));
          lines.push('```');
        }
      } else {
        lines.push(`❌ Failed to stop session \`${sessionId}\`.`);
        if (trimmedError) {
          lines.push('');
          lines.push('```');
          lines.push(trimmedError.slice(0, 1000));
          lines.push('```');
        }
      }

      try {
        await ctx.telegram.editMessageText(ack.chat.id, ack.message_id, undefined, lines.join('\n'), { parse_mode: 'Markdown' });
      } catch (error) {
        console.error('[ERROR] /stop <UUID>: editMessageText failed, falling back to reply:', error);
        await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown', reply_to_message_id: message.message_id });
      }
      return;
    }

    // No UUID — fall through to the chat-level pause flow. That flow rejects
    // forwards/replies on purpose (#1081) so a stray reply doesn't pause the chat.
    if (isForwardedOrReply(ctx)) {
      VERBOSE && console.log('[VERBOSE] /stop ignored: forwarded or reply');
      return;
    }

    const check = await validateOwnerCommand(ctx, '/stop');
    if (!check.valid) return;
    const chatId = check.chatId;

    // Check if already stopped
    if (isChatStopped(chatId)) {
      const stopInfo = getChatStopInfo(chatId);
      const stoppedAtStr = stopInfo?.stoppedAt ? stopInfo.stoppedAt.toISOString() : 'unknown';
      let alreadyStoppedMsg = `ℹ️ Bot is already stopped in this chat.\n\nStopped at: ${stoppedAtStr}`;
      if (stopInfo?.reason) {
        alreadyStoppedMsg += `\nReason: ${stopInfo.reason}`;
      }
      alreadyStoppedMsg += '\n\nUse /start to resume accepting tasks.';
      await ctx.reply(alreadyStoppedMsg, {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }

    // Parse optional reason from message text (anything after "/stop ")
    // Supports: /stop reason, /stop "reason", /stop 'reason'
    const messageText = ctx.message.text || '';
    let reason = messageText.replace(/^\/stop(@\w+)?\s*/i, '').trim() || null;
    // Strip surrounding quotes (single or double) from reason
    if (reason && ((reason.startsWith('"') && reason.endsWith('"')) || (reason.startsWith("'") && reason.endsWith("'")))) {
      reason = reason.slice(1, -1).trim() || null;
    }

    if (VERBOSE && reason) {
      console.log(`[VERBOSE] /stop reason: ${reason}`);
    }

    // Set chat as stopped with optional reason
    setChatStopped(chatId, true, ctx.from, reason);

    if (VERBOSE) {
      console.log(`[VERBOSE] Chat ${chatId} is now stopped`);
    }

    let stopMessage = '🛑 *Bot Stopped*\n\n' + 'This bot is now in read-only mode for this chat.\n\n';
    if (reason) {
      stopMessage += `*Reason:* ${reason}\n\n`;
    }
    stopMessage += '*Disabled commands:*\n' + '• /solve - No new issues will be accepted\n' + '• /hive - No new hive commands will be accepted\n' + '• /merge - No new merge operations will be accepted\n\n' + '*Still available:*\n' + '• /help - Show help\n' + '• /limits - Show usage limits\n' + '• /version - Show version info\n' + '• /start - Resume accepting tasks (owner only)\n\n' + '💡 Any tasks already in queue will continue to process.';

    await ctx.reply(stopMessage, {
      parse_mode: 'Markdown',
      reply_to_message_id: ctx.message.message_id,
    });
  });

  // /start command - resume accepting new tasks in this chat
  // Only accessible by chat owner (creator)
  // Note: This overrides Telegram's default /start behavior, but that's intentional
  // as in group chats we want this to control the bot's task acceptance
  bot.command('start', async ctx => {
    const check = await validateOwnerCommand(ctx, '/start', { allowPrivate: true });
    if (!check.valid) {
      // In private chats, show a welcome message instead
      if (check.isPrivate) {
        VERBOSE && console.log('[VERBOSE] /start in private chat: showing welcome');
        await ctx.reply('👋 *Welcome to SwarmMindBot!*\n\n' + 'This bot helps solve GitHub issues using AI.\n\n' + 'To use this bot:\n' + '1. Add me to a group chat\n' + '2. Make me an admin\n' + '3. Use /solve to solve GitHub issues\n\n' + 'Use /help in a group chat for more information.', { parse_mode: 'Markdown' });
      }
      return;
    }
    const chatId = check.chatId;

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

    await ctx.reply('✅ *Bot Started*\n\n' + 'This bot is now accepting tasks in this chat.\n\n' + (durationStr ? `Bot was stopped for ${durationStr}.\n\n` : '') + 'Use /help to see available commands.', {
      parse_mode: 'Markdown',
      reply_to_message_id: ctx.message.message_id,
    });
  });
}
