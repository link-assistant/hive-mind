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
 * - Monitors CI/CD between merges (every 5 minutes)
 * - Provides progress updates via single updated Telegram message
 * - Cancel via inline button
 * - Per-repository concurrency control (not per-chat)
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1143
 */

import { parseRepositoryUrl, checkLabelPermissions, ensureReadyLabel, autoLabelEligiblePRs } from './github-merge.lib.mjs';
import { createMergeQueueProcessor, MergeStatus, MERGE_QUEUE_CONFIG } from './telegram-merge-queue.lib.mjs';

/**
 * Active merge operations map (repoKey -> { processor, chatId, messageId })
 * Uses repository key (owner/repo) for per-repository concurrency control
 */
const activeMergeOperations = new Map();

/**
 * Generate repository key for the operations map
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {string} Repository key
 */
function getRepoKey(owner, repo) {
  return `${owner}/${repo}`.toLowerCase();
}

/**
 * Escapes special characters in text for Telegram MarkdownV2 formatting
 * @param {string} text - The text to escape
 * @returns {string} The escaped text
 */
function escapeMarkdownV2(text) {
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
 * Format user-friendly error message
 * Hides debug info unless verbose mode is enabled
 * @param {Error} error - The error object
 * @param {boolean} verbose - Whether verbose logging is enabled
 * @returns {string} User-friendly error message
 */
function formatUserError(error, verbose) {
  // Map common errors to user-friendly messages
  const errorMessage = error.message || String(error);

  if (errorMessage.includes('rate limit')) {
    return 'GitHub API rate limit exceeded. Please try again later.';
  }
  if (errorMessage.includes('permission') || errorMessage.includes('403')) {
    return 'Insufficient permissions to access this repository. Please check access rights.';
  }
  if (errorMessage.includes('not found') || errorMessage.includes('404')) {
    return 'Repository not found. Please check the URL and try again.';
  }
  if (errorMessage.includes('network') || errorMessage.includes('ECONNREFUSED')) {
    return 'Network error. Please check your connection and try again.';
  }

  // For unknown errors, show generic message (detailed logs are in verbose mode)
  if (verbose) {
    return `Error: ${errorMessage}`;
  }
  return 'An error occurred. Please try again or contact support.';
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

    // Parse arguments
    const args = parseCommandArgs(ctx.message.text);

    if (args.length === 0) {
      return await ctx.reply("Missing repository URL\\.\n\nUsage: `/merge <repository-url>`\n\nExample: `/merge https://github.com/owner/repo`\n\nThis will merge all PRs with the 'ready' label, one by one, waiting for CI/CD between each merge\\.", { parse_mode: 'MarkdownV2', reply_to_message_id: ctx.message.message_id });
    }

    // Parse and validate repository URL
    const repoUrl = args[0];
    const parsedUrl = parseRepositoryUrl(repoUrl);

    if (!parsedUrl.valid) {
      return await ctx.reply(`Invalid repository URL: ${escapeMarkdownV2(parsedUrl.error)}\n\nPlease provide a valid GitHub repository URL\\.`, {
        parse_mode: 'MarkdownV2',
        reply_to_message_id: ctx.message.message_id,
      });
    }

    const { owner, repo } = parsedUrl;
    const repoKey = getRepoKey(owner, repo);
    VERBOSE && console.log(`[VERBOSE] /merge: Processing repository ${owner}/${repo}`);

    // Check if a merge operation is already running for this repository (per-repository concurrency)
    if (activeMergeOperations.has(repoKey)) {
      const existingOp = activeMergeOperations.get(repoKey);
      if (existingOp.processor.status === MergeStatus.RUNNING) {
        return await ctx.reply(`A merge operation is already running for ${escapeMarkdownV2(owner)}/${escapeMarkdownV2(repo)}\\.\n\nPlease wait for it to complete or cancel it\\.`, {
          parse_mode: 'MarkdownV2',
          reply_to_message_id: ctx.message.message_id,
        });
      }
    }

    // Send initial status message (reply to the /merge command)
    const statusMessage = await ctx.reply(`Initializing merge queue for ${escapeMarkdownV2(owner)}/${escapeMarkdownV2(repo)}\\.\\.\\.\n\nThis may take a moment\\.`, {
      parse_mode: 'MarkdownV2',
      reply_to_message_id: ctx.message.message_id,
    });

    try {
      // Check permissions
      const permCheck = await checkLabelPermissions(owner, repo, VERBOSE);
      if (!permCheck.canManageLabels) {
        await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, `No permission to manage repository ${escapeMarkdownV2(owner)}/${escapeMarkdownV2(repo)}\\.\n\nPlease ensure you have write access to this repository\\.`, { parse_mode: 'MarkdownV2' });
        return;
      }

      // Ensure ready label exists
      const labelResult = await ensureReadyLabel(owner, repo, VERBOSE);
      if (!labelResult.success) {
        await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, `Failed to setup 'ready' label: ${escapeMarkdownV2(labelResult.error)}`, {
          parse_mode: 'MarkdownV2',
        });
        return;
      }

      const labelMsg = labelResult.created ? "\nCreated 'ready' label in repository\\." : '';

      // Create the merge queue processor
      const processor = await createMergeQueueProcessor(owner, repo, {
        verbose: VERBOSE,
        onProgress: async () => {
          // Update message with progress and cancel button
          try {
            const message = processor.formatProgressMessage();
            await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, message, {
              parse_mode: 'MarkdownV2',
              reply_markup: {
                inline_keyboard: [[{ text: '🛑 Cancel', callback_data: `merge_cancel_${repoKey}` }]],
              },
            });
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
            // Remove cancel button on completion
            await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, message, {
              parse_mode: 'MarkdownV2',
            });
          } catch (err) {
            VERBOSE && console.log(`[VERBOSE] /merge: Error sending final message: ${err.message}`);
          }
          activeMergeOperations.delete(repoKey);
        },
        onError: async error => {
          VERBOSE && console.error(`[VERBOSE] /merge error for ${repoKey}:`, error);
          try {
            const userMessage = formatUserError(error, VERBOSE);
            const finalReport = processor.formatFinalMessage();
            await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, `❌ *Merge queue failed*\n\n${escapeMarkdownV2(userMessage)}\n\n${finalReport}`, {
              parse_mode: 'MarkdownV2',
            });
          } catch (err) {
            VERBOSE && console.log(`[VERBOSE] /merge: Error sending error message: ${err.message}`);
          }
          activeMergeOperations.delete(repoKey);
        },
      });

      // Initialize the processor
      const initResult = await processor.initialize();

      if (!initResult.success) {
        const userMessage = formatUserError(new Error(initResult.error), VERBOSE);
        await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, `Failed to initialize merge queue: ${escapeMarkdownV2(userMessage)}`, {
          parse_mode: 'MarkdownV2',
        });
        return;
      }

      if (initResult.message) {
        // No PRs with 'ready' label found - try to auto-label eligible PRs
        VERBOSE && console.log('[VERBOSE] /merge: No PRs with ready label, attempting auto-labeling');

        await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, `*Merge Queue \\- ${escapeMarkdownV2(owner)}/${escapeMarkdownV2(repo)}*${labelMsg}\n\n${escapeMarkdownV2(initResult.message)}\n\nSearching for eligible PRs to auto\\-label\\.\\.\\.`, { parse_mode: 'MarkdownV2' });

        const autoLabelResult = await autoLabelEligiblePRs(owner, repo, VERBOSE);

        if (autoLabelResult.error) {
          await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, `*Merge Queue \\- ${escapeMarkdownV2(owner)}/${escapeMarkdownV2(repo)}*${labelMsg}\n\nFailed to auto\\-label PRs: ${escapeMarkdownV2(autoLabelResult.error)}`, { parse_mode: 'MarkdownV2' });
          return;
        }

        if (autoLabelResult.labeled.length === 0) {
          // No eligible PRs found - show detailed message
          let skipReasons = '';
          if (autoLabelResult.skipped.length > 0) {
            const reasonCounts = {};
            for (const { reason } of autoLabelResult.skipped) {
              reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
            }
            const reasonLines = Object.entries(reasonCounts)
              .map(([reason, count]) => `• ${count} PR\\(s\\): ${escapeMarkdownV2(reason)}`)
              .join('\n');
            skipReasons = `\n\n*Skipped PRs:*\n${reasonLines}`;
          }

          await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, `*Merge Queue \\- ${escapeMarkdownV2(owner)}/${escapeMarkdownV2(repo)}*${labelMsg}\n\nNo eligible PRs found to auto\\-label\\.${skipReasons}\n\n*Tips:*\n• Ensure PRs are not drafts\n• Ensure CI checks are passing\n• Ensure there are no merge conflicts`, { parse_mode: 'MarkdownV2' });
          return;
        }

        // PRs were auto-labeled, show which ones
        const labeledList = autoLabelResult.labeled.map(pr => `• \\#${pr.number}: ${escapeMarkdownV2(pr.title)}`).join('\n');

        await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, `*Merge Queue \\- ${escapeMarkdownV2(owner)}/${escapeMarkdownV2(repo)}*${labelMsg}\n\n✅ Auto\\-labeled ${autoLabelResult.labeled.length} eligible PR\\(s\\):\n${labeledList}\n\nRe\\-initializing merge queue\\.\\.\\.`, { parse_mode: 'MarkdownV2' });

        // Re-initialize the processor to pick up the newly labeled PRs
        const reinitResult = await processor.initialize();

        if (!reinitResult.success || reinitResult.message) {
          // This shouldn't happen since we just labeled PRs, but handle it
          await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, `*Merge Queue \\- ${escapeMarkdownV2(owner)}/${escapeMarkdownV2(repo)}*\n\nAuto\\-labeled PRs but failed to initialize queue\\. Please try again\\.`, { parse_mode: 'MarkdownV2' });
          return;
        }

        // Update initResult to continue with the merge process
        Object.assign(initResult, reinitResult);
      }

      // Update message with PR list and cancel button, start processing
      const truncatedMsg = initResult.truncated ? `\n\n_Note: Only processing first ${MERGE_QUEUE_CONFIG.MAX_PRS_PER_SESSION} PRs_` : '';

      await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, `*Merge Queue \\- ${escapeMarkdownV2(owner)}/${escapeMarkdownV2(repo)}*${labelMsg}\n\nFound ${initResult.count} PRs with 'ready' label\\.${escapeMarkdownV2(truncatedMsg)}\n\nStarting merge process\\.\\.\\.`, {
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [[{ text: '🛑 Cancel', callback_data: `merge_cancel_${repoKey}` }]],
        },
      });

      // Store processor for this repository
      activeMergeOperations.set(repoKey, {
        processor,
        chatId,
        messageId: statusMessage.message_id,
      });

      // Run the merge queue (this runs asynchronously)
      processor.run().catch(error => {
        VERBOSE && console.error(`[VERBOSE] /merge: Unhandled error in run(): ${error.message}`);
        activeMergeOperations.delete(repoKey);
      });
    } catch (error) {
      VERBOSE && console.error('[VERBOSE] /merge error:', error);

      try {
        const userMessage = formatUserError(error, VERBOSE);
        await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, `Error processing merge queue: ${escapeMarkdownV2(userMessage)}\n\nPlease check the repository URL and try again\\.`, { parse_mode: 'MarkdownV2' });
      } catch (editError) {
        VERBOSE && console.error('[VERBOSE] /merge: Failed to edit error message:', editError);
      }
    }
  });

  // Handle cancel button callback
  bot.action(/^merge_cancel_(.+)$/, async ctx => {
    const repoKey = ctx.match[1];
    VERBOSE && console.log(`[VERBOSE] /merge cancel callback received for ${repoKey}`);

    const operation = activeMergeOperations.get(repoKey);
    if (!operation || operation.processor.status !== MergeStatus.RUNNING) {
      await ctx.answerCbQuery('No active merge operation found.');
      return;
    }

    // Cancel the operation
    operation.processor.cancel();
    await ctx.answerCbQuery('Merge operation cancellation requested. The current PR will finish processing.');

    VERBOSE && console.log(`[VERBOSE] /merge: Cancelled operation for ${repoKey}`);
  });
}

/**
 * Get active merge operation for a repository
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Object|null} Operation object or null
 */
export function getActiveMergeOperation(owner, repo) {
  const repoKey = getRepoKey(owner, repo);
  return activeMergeOperations.get(repoKey) || null;
}

/**
 * Clear all active merge operations (useful for testing)
 */
export function clearAllMergeOperations() {
  for (const [, operation] of activeMergeOperations) {
    if (operation.processor.status === MergeStatus.RUNNING) {
      operation.processor.cancel();
    }
  }
  activeMergeOperations.clear();
}

export default {
  registerMergeCommand,
  getActiveMergeOperation,
  clearAllMergeOperations,
};
