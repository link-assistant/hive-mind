/**
 * Telegram /stop command implementation
 *
 * This module provides the /stop command functionality for the Telegram bot,
 * allowing users to forcefully stop running commands by sending CTRL+C to screen sessions.
 *
 * Features:
 * - Stop all active sessions in current chat with `/stop`
 * - Stop specific session with `/stop <session-name>`
 * - Session tracking integrated with /solve and /hive commands
 * - Clear success/failure reporting
 * - Each screen session is stopped separately as per issue #524 requirements
 */

/**
 * Registers the /stop command handler with the bot
 * @param {Object} bot - The Telegraf bot instance
 * @param {Object} options - Options object
 * @param {boolean} options.VERBOSE - Whether to enable verbose logging
 * @param {Function} options.isOldMessage - Function to check if message is old
 * @param {Function} options.isForwardedOrReply - Function to check if message is forwarded/reply
 * @param {Function} options.isGroupChat - Function to check if chat is a group
 * @param {Function} options.isChatAuthorized - Function to check if chat is authorized
 * @param {Function} options.parseCommandArgs - Function to parse command arguments
 * @param {Function} options.getActiveSessions - Function to get active sessions for a chat
 * @param {Function} options.sendCtrlCToScreen - Function to send CTRL+C to a screen session
 * @param {Function} options.buildUserMention - Function to build user mention string
 */
export function registerStopCommand(bot, options) {
  const {
    VERBOSE,
    isOldMessage,
    isForwardedOrReply,
    isGroupChat,
    isChatAuthorized,
    parseCommandArgs,
    getActiveSessions,
    sendCtrlCToScreen,
    buildUserMention
  } = options;

  bot.command('stop', async (ctx) => {
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
      await ctx.reply('❌ The /stop command only works in group chats. Please add this bot to a group and make it an admin.', { reply_to_message_id: ctx.message.message_id });
      return;
    }

    const chatId = ctx.chat.id;
    if (!isChatAuthorized(chatId)) {
      if (VERBOSE) {
        console.log('[VERBOSE] /stop ignored: chat not authorized');
      }
      await ctx.reply(`❌ This chat (ID: ${chatId}) is not authorized to use this bot. Please contact the bot administrator.`, { reply_to_message_id: ctx.message.message_id });
      return;
    }

    if (VERBOSE) {
      console.log('[VERBOSE] /stop passed all checks, executing...');
    }

    const userArgs = parseCommandArgs(ctx.message.text);
    const activeSessions = getActiveSessions(chatId);

    if (activeSessions.length === 0) {
      await ctx.reply('ℹ️ No active sessions found in this chat.\n\nStart a command with /solve or /hive first.', { reply_to_message_id: ctx.message.message_id });
      return;
    }

    // If user provides a session name, stop that specific session
    if (userArgs.length > 0) {
      const sessionName = userArgs[0];
      const requester = buildUserMention({ user: ctx.from, parseMode: 'Markdown' });

      await ctx.reply(`⏹️ Stopping session \`${sessionName}\`...\nRequested by: ${requester}`, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });

      const result = await sendCtrlCToScreen(sessionName);

      if (result.success) {
        await ctx.reply(`✅ CTRL+C sent to session \`${sessionName}\`\n\nThe command should stop shortly.`, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
      } else {
        await ctx.reply(`❌ Failed to stop session \`${sessionName}\`\n\nError: ${result.error}`, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
      }
      return;
    }

    // No session name provided - stop all active sessions in this chat
    // Each screen session that was started is stopped separately (issue #524 requirement)
    const requester = buildUserMention({ user: ctx.from, parseMode: 'Markdown' });
    let statusMsg = `⏹️ Stopping ${activeSessions.length} active session(s)...\nRequested by: ${requester}\n\n`;

    await ctx.reply(statusMsg, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });

    const results = [];
    for (const session of activeSessions) {
      const result = await sendCtrlCToScreen(session.sessionName);
      results.push({
        session,
        result
      });
    }

    // Build summary message
    const successCount = results.filter(r => r.result.success).length;
    const failureCount = results.length - successCount;

    let summaryMsg = '📊 *Stop Results:*\n\n';
    summaryMsg += `✅ Successfully stopped: ${successCount}\n`;
    summaryMsg += `❌ Failed to stop: ${failureCount}\n\n`;

    if (successCount > 0) {
      summaryMsg += '*Stopped sessions:*\n';
      for (const { session, result } of results) {
        if (result.success) {
          summaryMsg += `• \`${session.sessionName}\` (${session.command})\n`;
        }
      }
    }

    if (failureCount > 0) {
      summaryMsg += '\n*Failed sessions:*\n';
      for (const { session, result } of results) {
        if (!result.success) {
          summaryMsg += `• \`${session.sessionName}\`: ${result.error}\n`;
        }
      }
    }

    await ctx.reply(summaryMsg, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
  });
}
