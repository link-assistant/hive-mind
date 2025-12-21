/**
 * Telegram /top command implementation
 *
 * This module provides the /top command functionality for the Telegram bot,
 * allowing chat owners to view live system monitor output in an auto-updating message.
 *
 * Features:
 * - Live system monitoring using GNU screen and top command
 * - Auto-updates every 2 seconds
 * - Owner-only access control
 * - Session management per chat
 * - Clean cleanup on stop
 *
 * @experimental This feature is marked as experimental
 */

import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const exec = promisify(execCallback);

// Store active top sessions: Map<chatId, { messageId, screenName, intervalId }>
const activeTopSessions = new Map();

/**
 * Captures top output from the file for a given chat
 * @param {number} chatId - The chat ID
 * @returns {Promise<string|null>} The formatted top output or null on error
 */
async function captureTopOutput(chatId) {
  try {
    const outputFile = `/tmp/top-output-${chatId}.txt`;
    const { readFile } = await import('fs/promises');
    const output = await readFile(outputFile, 'utf-8');

    // Format output for Telegram (limit to first 30 lines to fit in message)
    const lines = output.split('\n').slice(0, 30);
    return lines.join('\n');
  } catch (error) {
    console.error('[ERROR] Failed to capture top output:', error);
    return null;
  }
}

/**
 * Registers the /top command handler with the bot
 * @param {Object} bot - The Telegraf bot instance
 * @param {Object} options - Options object
 * @param {boolean} options.VERBOSE - Whether to enable verbose logging
 * @param {Function} options.isOldMessage - Function to check if message is old
 * @param {Function} options.isForwardedOrReply - Function to check if message is forwarded/reply
 * @param {Function} options.isGroupChat - Function to check if chat is a group
 * @param {Function} options.isChatAuthorized - Function to check if chat is authorized
 */
export function registerTopCommand(bot, options) {
  const { VERBOSE = false, isOldMessage, isForwardedOrReply, isGroupChat, isChatAuthorized } = options;

  // /top command - show system top output in an auto-updating message (EXPERIMENTAL)
  // Only accessible by chat owner
  // Not documented in /help as requested in issue #500
  bot.command('top', async ctx => {
    if (VERBOSE) {
      console.log('[VERBOSE] /top command received');
    }

    // Ignore messages sent before bot started
    if (isOldMessage(ctx)) {
      if (VERBOSE) {
        console.log('[VERBOSE] /top ignored: old message');
      }
      return;
    }

    // Ignore forwarded or reply messages
    if (isForwardedOrReply(ctx)) {
      if (VERBOSE) {
        console.log('[VERBOSE] /top ignored: forwarded or reply');
      }
      return;
    }

    if (!isGroupChat(ctx)) {
      if (VERBOSE) {
        console.log('[VERBOSE] /top ignored: not a group chat');
      }
      await ctx.reply('❌ The /top command only works in group chats.', {
        reply_to_message_id: ctx.message.message_id
      });
      return;
    }

    const chatId = ctx.chat.id;
    if (!isChatAuthorized(chatId)) {
      if (VERBOSE) {
        console.log('[VERBOSE] /top ignored: chat not authorized');
      }
      await ctx.reply(`❌ This chat (ID: ${chatId}) is not authorized to use this bot.`, {
        reply_to_message_id: ctx.message.message_id
      });
      return;
    }

    // Check if user is chat owner
    try {
      const chatMember = await ctx.telegram.getChatMember(chatId, ctx.from.id);
      if (chatMember.status !== 'creator') {
        if (VERBOSE) {
          console.log('[VERBOSE] /top ignored: user is not chat owner');
        }
        await ctx.reply('❌ This command is only available to the chat owner.', {
          reply_to_message_id: ctx.message.message_id
        });
        return;
      }
    } catch (error) {
      console.error('[ERROR] Failed to check chat member status:', error);
      await ctx.reply('❌ Failed to verify permissions.', { reply_to_message_id: ctx.message.message_id });
      return;
    }

    if (VERBOSE) {
      console.log('[VERBOSE] /top passed all checks, starting...');
    }

    // Show experimental feature warning
    await ctx.reply(
      '🧪 *EXPERIMENTAL FEATURE*\n\nThis command is experimental and may have issues. Use with caution.',
      {
        parse_mode: 'Markdown',
        reply_to_message_id: ctx.message.message_id
      }
    );

    // Check if there's already an active top session for this chat
    if (activeTopSessions.has(chatId)) {
      await ctx.reply('❌ A top session is already running for this chat. Stop it first using the button.', {
        reply_to_message_id: ctx.message.message_id
      });
      return;
    }

    // Generate screen session name with chat ID
    const screenName = `top-chat-${chatId}`;

    // Check if screen session already exists
    let sessionExists = false;
    try {
      const { stdout } = await exec('screen -ls');
      sessionExists = stdout.includes(screenName);
    } catch {
      // screen -ls returns non-zero when no sessions exist
      sessionExists = false;
    }

    // Create screen session if it doesn't exist
    // We'll use a different approach: run top in batch mode with output redirected to a file
    // that we continuously read instead of using screen hardcopy
    const outputFile = `/tmp/top-output-${chatId}.txt`;

    if (!sessionExists) {
      try {
        // Start top in a screen session with batch mode, outputting to a file
        // -b: batch mode, -d 2: 2 second delay between updates, -n: number of iterations (unlimited)
        await exec(`screen -dmS ${screenName} bash -c 'while true; do top -b -n 1 > ${outputFile}; sleep 2; done'`);
        if (VERBOSE) {
          console.log(`[VERBOSE] Created screen session: ${screenName}`);
        }
        // Give top a moment to start and produce first output
        await new Promise(resolve => setTimeout(resolve, 1500));
      } catch (error) {
        console.error('[ERROR] Failed to create screen session:', error);
        await ctx.reply('❌ Failed to start top command.', { reply_to_message_id: ctx.message.message_id });
        return;
      }
    }

    // Send initial message with loading indicator
    const initialMessage = await ctx.reply('🧪 📊 Loading system monitor... (EXPERIMENTAL)', {
      reply_to_message_id: ctx.message.message_id,
      reply_markup: {
        inline_keyboard: [[{ text: '🛑 Stop', callback_data: `stop_top_${chatId}` }]]
      }
    });

    // Capture and display first output
    const firstOutput = await captureTopOutput(chatId);
    if (firstOutput) {
      try {
        await ctx.telegram.editMessageText(
          chatId,
          initialMessage.message_id,
          undefined,
          `\`\`\`\n${firstOutput}\n\`\`\``,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[{ text: '🛑 Stop', callback_data: `stop_top_${chatId}` }]]
            }
          }
        );
      } catch (error) {
        console.error('[ERROR] Failed to update message:', error);
      }
    }

    // Set up periodic update (every 2 seconds)
    const intervalId = setInterval(async () => {
      const output = await captureTopOutput(chatId);
      if (output) {
        try {
          await ctx.telegram.editMessageText(
            chatId,
            initialMessage.message_id,
            undefined,
            `\`\`\`\n${output}\n\`\`\``,
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [[{ text: '🛑 Stop', callback_data: `stop_top_${chatId}` }]]
              }
            }
          );
        } catch (error) {
          // Ignore "message is not modified" errors
          if (!error.message?.includes('message is not modified')) {
            console.error('[ERROR] Failed to update message:', error);
          }
        }
      }
    }, 2000);

    // Store session info
    activeTopSessions.set(chatId, {
      messageId: initialMessage.message_id,
      screenName,
      intervalId
    });

    if (VERBOSE) {
      console.log(`[VERBOSE] Top session started for chat ${chatId}`);
    }
  });

  // Handle stop button callback
  bot.action(/^stop_top_(.+)$/, async ctx => {
    const chatId = parseInt(ctx.match[1]);

    if (VERBOSE) {
      console.log(`[VERBOSE] Stop top callback received for chat ${chatId}`);
    }

    // Check if user is chat owner
    try {
      const chatMember = await ctx.telegram.getChatMember(chatId, ctx.from.id);
      if (chatMember.status !== 'creator') {
        await ctx.answerCbQuery('❌ Only the chat owner can stop the top session.');
        return;
      }
    } catch (error) {
      console.error('[ERROR] Failed to check chat member status:', error);
      await ctx.answerCbQuery('❌ Failed to verify permissions.');
      return;
    }

    const session = activeTopSessions.get(chatId);
    if (!session) {
      await ctx.answerCbQuery('❌ No active top session found.');
      return;
    }

    // Stop the update interval
    clearInterval(session.intervalId);

    // Kill the screen session
    try {
      await exec(`screen -S ${session.screenName} -X quit`);
      if (VERBOSE) {
        console.log(`[VERBOSE] Killed screen session: ${session.screenName}`);
      }
    } catch (error) {
      console.error('[ERROR] Failed to kill screen session:', error);
    }

    // Clean up the output file
    try {
      const { unlink } = await import('fs/promises');
      await unlink(`/tmp/top-output-${chatId}.txt`);
      if (VERBOSE) {
        console.log(`[VERBOSE] Cleaned up output file for chat ${chatId}`);
      }
    } catch (error) {
      // Ignore file cleanup errors
      if (VERBOSE) {
        console.log(`[VERBOSE] Could not clean up output file: ${error.message}`);
      }
    }

    // Remove from active sessions
    activeTopSessions.delete(chatId);

    // Update the message to show it's stopped
    try {
      await ctx.editMessageText('🛑 Top session stopped.', {
        parse_mode: 'Markdown'
      });
    } catch (error) {
      console.error('[ERROR] Failed to edit message:', error);
    }

    await ctx.answerCbQuery('✅ Top session stopped successfully.');

    if (VERBOSE) {
      console.log(`[VERBOSE] Top session stopped for chat ${chatId}`);
    }
  });
}

/**
 * Gets information about active top sessions
 * @returns {Map} Map of active sessions
 */
export function getActiveTopSessions() {
  return activeTopSessions;
}
