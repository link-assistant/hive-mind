/**
 * Telegram /merge command implementation
 *
 * This module provides the /merge command functionality for the Telegram bot,
 * allowing users to process a repository's merge queue - merging all PRs
 * with the 'ready' label sequentially.
 *
 * Features:
 * - Accepts repository URL
 * - Checks and creates 'ready' label if needed
 * - Fetches all PRs/issues with 'ready' label
 * - Merges PRs sequentially (oldest first)
 * - Monitors CI/CD between merges
 * - Provides progress updates via Telegram
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1143
 */

import { parseRepositoryUrl, checkLabelPermissions, ensureReadyLabel } from './github-merge.lib.mjs';
import { createMergeQueueProcessor, MergeStatus, MERGE_QUEUE_CONFIG } from './telegram-merge-queue.lib.mjs';

/**
 * Active merge operations map (chatId -> processor)
 * Used to prevent multiple merge operations in the same chat
 */
const activeMergeOperations = new Map();

/**
 * Escapes special characters in text for Telegram Markdown formatting
 * @param {string} text - The text to escape
 * @returns {string} The escaped text
 */
function escapeMarkdown(text) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

/**
 * Parse command arguments for /merge
 * @param {string} text - Message text
 * @returns {string[]} Array of arguments
 */
function parseCommandArgs(text) {
  const firstLine = text.split('\n')[0].trim();
  const argsText = firstLine.replace(/^\/\w+\s*/, '');

  if (!argsText.trim()) {
    return [];
  }

  const args = [];
  let currentArg = '';
  let inQuotes = false;
  let quoteChar = null;

  for (let i = 0; i < argsText.length; i++) {
    const char = argsText[i];

    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = null;
    } else if (char === ' ' && !inQuotes) {
      if (currentArg) {
        args.push(currentArg);
        currentArg = '';
      }
    } else {
      currentArg += char;
    }
  }

  if (currentArg) {
    args.push(currentArg);
  }

  return args;
}

/**
 * Registers the /merge command handler with the bot
 * @param {Object} bot - The Telegraf bot instance
 * @param {Object} options - Options object
 * @param {boolean} options.VERBOSE - Whether to enable verbose logging
 * @param {Function} options.isOldMessage - Function to check if message is old
 * @param {Function} options.isForwardedOrReply - Function to check if message is forwarded/reply
 * @param {Function} options.isGroupChat - Function to check if chat is a group
 * @param {Function} options.isChatAuthorized - Function to check if chat is authorized
 * @param {Function} options.addBreadcrumb - Function to add breadcrumbs for monitoring
 */
export function registerMergeCommand(bot, options) {
  const { VERBOSE = false, isOldMessage, isForwardedOrReply, isGroupChat, isChatAuthorized, addBreadcrumb } = options;

  bot.command(/^merge$/i, async ctx => {
    VERBOSE && console.log('[VERBOSE] /merge command received');

    await addBreadcrumb({
      category: 'telegram.command',
      message: '/merge command received',
      level: 'info',
      data: { chatId: ctx.chat?.id, chatType: ctx.chat?.type, userId: ctx.from?.id, username: ctx.from?.username },
    });

    // Standard checks
    if (isOldMessage(ctx) || isForwardedOrReply(ctx)) return;

    if (!isGroupChat(ctx)) {
      return await ctx.reply('The /merge command only works in group chats. Please add this bot to a group and make it an admin.', {
        reply_to_message_id: ctx.message.message_id,
      });
    }

    const chatId = ctx.chat.id;
    if (!isChatAuthorized(chatId)) {
      return await ctx.reply(`This chat (ID: ${chatId}) is not authorized to use this bot. Please contact the bot administrator.`, {
        reply_to_message_id: ctx.message.message_id,
      });
    }

    // Check if a merge operation is already running in this chat
    if (activeMergeOperations.has(chatId)) {
      const existingOp = activeMergeOperations.get(chatId);
      if (existingOp.status === MergeStatus.RUNNING) {
        return await ctx.reply('A merge operation is already running in this chat. Please wait for it to complete or cancel it first.', {
          reply_to_message_id: ctx.message.message_id,
        });
      }
    }

    // Parse arguments
    const args = parseCommandArgs(ctx.message.text);

    if (args.length === 0) {
      return await ctx.reply("Missing repository URL.\n\nUsage: `/merge <repository-url>`\n\nExample: `/merge https://github.com/owner/repo`\n\nThis will merge all PRs with the 'ready' label, one by one, waiting for CI/CD between each merge.", { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
    }

    // Parse and validate repository URL
    const repoUrl = args[0];
    const parsedUrl = parseRepositoryUrl(repoUrl);

    if (!parsedUrl.valid) {
      return await ctx.reply(`Invalid repository URL: ${escapeMarkdown(parsedUrl.error)}\n\nPlease provide a valid GitHub repository URL.`, {
        parse_mode: 'Markdown',
        reply_to_message_id: ctx.message.message_id,
      });
    }

    const { owner, repo } = parsedUrl;
    VERBOSE && console.log(`[VERBOSE] /merge: Processing repository ${owner}/${repo}`);

    // Send initial status message
    const statusMessage = await ctx.reply(`Initializing merge queue for ${escapeMarkdown(owner)}/${escapeMarkdown(repo)}...\n\nThis may take a moment.`, {
      parse_mode: 'Markdown',
      reply_to_message_id: ctx.message.message_id,
    });

    try {
      // Check permissions
      const permCheck = await checkLabelPermissions(owner, repo, VERBOSE);
      if (!permCheck.canManageLabels) {
        await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, `No permission to manage repository ${escapeMarkdown(owner)}/${escapeMarkdown(repo)}.\n\nPlease ensure you have write access to this repository.`, { parse_mode: 'Markdown' });
        return;
      }

      // Ensure ready label exists
      const labelResult = await ensureReadyLabel(owner, repo, VERBOSE);
      if (!labelResult.success) {
        await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, `Failed to setup 'ready' label: ${escapeMarkdown(labelResult.error)}`, {
          parse_mode: 'Markdown',
        });
        return;
      }

      const labelMsg = labelResult.created ? "\nCreated 'ready' label in repository." : '';

      // Create the merge queue processor
      const processor = await createMergeQueueProcessor(owner, repo, {
        verbose: VERBOSE,
        onProgress: async () => {
          // Update message periodically
          try {
            const message = processor.formatProgressMessage();
            await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, message, { parse_mode: 'Markdown' });
          } catch (err) {
            // Ignore message edit errors (e.g., message not modified)
            if (!err.message?.includes('message is not modified')) {
              VERBOSE && console.log(`[VERBOSE] /merge: Error updating message: ${err.message}`);
            }
          }
        },
        onComplete: async () => {
          try {
            const message = processor.formatFinalMessage();
            await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, message, { parse_mode: 'Markdown' });
          } catch (err) {
            VERBOSE && console.log(`[VERBOSE] /merge: Error sending final message: ${err.message}`);
          }
          activeMergeOperations.delete(chatId);
        },
        onError: async error => {
          try {
            await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, `Merge queue failed: ${escapeMarkdown(error.message)}\n\n${processor.formatFinalMessage()}`, { parse_mode: 'Markdown' });
          } catch (err) {
            VERBOSE && console.log(`[VERBOSE] /merge: Error sending error message: ${err.message}`);
          }
          activeMergeOperations.delete(chatId);
        },
      });

      // Initialize the processor
      const initResult = await processor.initialize();

      if (!initResult.success) {
        await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, `Failed to initialize merge queue: ${escapeMarkdown(initResult.error)}`, {
          parse_mode: 'Markdown',
        });
        return;
      }

      if (initResult.message) {
        // No PRs to merge
        await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, `*Merge Queue - ${escapeMarkdown(owner)}/${escapeMarkdown(repo)}*${labelMsg}\n\n${escapeMarkdown(initResult.message)}\n\nTo use the merge queue:\n1. Add the \`ready\` label to PRs you want to merge\n2. Run \`/merge ${escapeMarkdown(repoUrl)}\` again`, { parse_mode: 'Markdown' });
        return;
      }

      // Update message with PR list and start processing
      const truncatedMsg = initResult.truncated ? `\n\n_Note: Only processing first ${MERGE_QUEUE_CONFIG.MAX_PRS_PER_SESSION} PRs_` : '';

      await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, `*Merge Queue - ${escapeMarkdown(owner)}/${escapeMarkdown(repo)}*${labelMsg}\n\nFound ${initResult.count} PRs with 'ready' label.${truncatedMsg}\n\nStarting merge process...`, { parse_mode: 'Markdown' });

      // Store processor for this chat
      activeMergeOperations.set(chatId, processor);

      // Run the merge queue (this runs asynchronously)
      processor.run().catch(error => {
        VERBOSE && console.error(`[VERBOSE] /merge: Unhandled error in run(): ${error.message}`);
        activeMergeOperations.delete(chatId);
      });
    } catch (error) {
      VERBOSE && console.error('[VERBOSE] /merge error:', error);

      try {
        await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, `Error processing merge queue: ${escapeMarkdown(error.message)}\n\nPlease check the repository URL and try again.`, { parse_mode: 'Markdown' });
      } catch (editError) {
        VERBOSE && console.error('[VERBOSE] /merge: Failed to edit error message:', editError);
      }
    }
  });

  // Register /merge_cancel command to cancel running merge operations
  bot.command(/^merge[_-]?cancel$/i, async ctx => {
    VERBOSE && console.log('[VERBOSE] /merge_cancel command received');

    if (isOldMessage(ctx) || isForwardedOrReply(ctx)) return;
    if (!isGroupChat(ctx)) {
      return await ctx.reply('The /merge_cancel command only works in group chats.', { reply_to_message_id: ctx.message.message_id });
    }

    const chatId = ctx.chat.id;
    if (!isChatAuthorized(chatId)) {
      return await ctx.reply(`This chat is not authorized.`, { reply_to_message_id: ctx.message.message_id });
    }

    const processor = activeMergeOperations.get(chatId);
    if (!processor || processor.status !== MergeStatus.RUNNING) {
      return await ctx.reply('No active merge operation to cancel.', { reply_to_message_id: ctx.message.message_id });
    }

    processor.cancel();
    await ctx.reply('Merge operation cancellation requested. The current PR will finish processing.', { reply_to_message_id: ctx.message.message_id });
  });

  // Register /merge_status command to check merge queue status
  bot.command(/^merge[_-]?status$/i, async ctx => {
    VERBOSE && console.log('[VERBOSE] /merge_status command received');

    if (isOldMessage(ctx) || isForwardedOrReply(ctx)) return;
    if (!isGroupChat(ctx)) {
      return await ctx.reply('The /merge_status command only works in group chats.', { reply_to_message_id: ctx.message.message_id });
    }

    const chatId = ctx.chat.id;
    if (!isChatAuthorized(chatId)) {
      return await ctx.reply(`This chat is not authorized.`, { reply_to_message_id: ctx.message.message_id });
    }

    const processor = activeMergeOperations.get(chatId);
    if (!processor) {
      return await ctx.reply('No merge operation is currently running in this chat.\n\nUse `/merge <repository-url>` to start one.', {
        parse_mode: 'Markdown',
        reply_to_message_id: ctx.message.message_id,
      });
    }

    const message = processor.status === MergeStatus.RUNNING ? processor.formatProgressMessage() : processor.formatFinalMessage();

    await ctx.reply(message, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
  });
}

/**
 * Get active merge operation for a chat
 * @param {number} chatId - Telegram chat ID
 * @returns {MergeQueueProcessor|null}
 */
export function getActiveMergeOperation(chatId) {
  return activeMergeOperations.get(chatId) || null;
}

/**
 * Clear all active merge operations (useful for testing)
 */
export function clearAllMergeOperations() {
  for (const [, processor] of activeMergeOperations) {
    if (processor.status === MergeStatus.RUNNING) {
      processor.cancel();
    }
  }
  activeMergeOperations.clear();
}

export default {
  registerMergeCommand,
  getActiveMergeOperation,
  clearAllMergeOperations,
};
