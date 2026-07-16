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

import { checkLabelPermissions, ensureReadyLabel } from './github-merge.lib.mjs';
import { extractMergeTargetUrlFromText, parseMergeTargetUrl } from './github-merge-targets.lib.mjs';
import { createMergeQueueProcessor, MergeStatus, MERGE_QUEUE_CONFIG } from './telegram-merge-queue.lib.mjs';
import { executeStartScreen } from './telegram-command-execution.lib.mjs';

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
 * Issue #1805: Parse boolean flags out of the tokenised `/merge` args.
 * Supports `--flag`, `--flag=true`, `--flag=false`, `--no-flag` and the
 * trailing positional repository URL. We keep the original positional order
 * so callers can still treat `positionals[0]` as the repo URL.
 *
 * @param {string[]} args - The output of `parseCommandArgs(text)`.
 * @returns {{ positionals: string[], flags: Record<string, boolean> }}
 */
export function parseMergeArgs(args) {
  const flags = {};
  const positionals = [];
  for (const arg of args) {
    if (typeof arg !== 'string') continue;
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      if (!body) continue;
      // --no-foo => foo=false
      if (body.startsWith('no-')) {
        const key = body.slice(3);
        if (key) flags[key] = false;
        continue;
      }
      const eqIdx = body.indexOf('=');
      if (eqIdx === -1) {
        flags[body] = true;
      } else {
        const key = body.slice(0, eqIdx);
        const value = body.slice(eqIdx + 1).toLowerCase();
        flags[key] = !(value === 'false' || value === '0' || value === 'no' || value === 'off');
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

/**
 * A real user reply can carry the issue/PR URL for `/merge`; forwarded
 * commands still must not be replayed by the bot.
 *
 * @param {Object} ctx - Telegraf context
 * @param {Object} filters - Message filter callbacks
 * @returns {boolean}
 */
export function shouldIgnoreMergeCommand(ctx, filters = {}) {
  if (filters.isOldMessage && filters.isOldMessage(ctx)) {
    return true;
  }
  if (typeof filters.isForwarded === 'function') {
    return filters.isForwarded(ctx);
  }
  if (typeof filters.isForwardedOrReply === 'function') {
    return filters.isForwardedOrReply(ctx);
  }
  return false;
}

function getMergeReplyText(message) {
  const reply = message?.reply_to_message;
  if (!reply || reply.forum_topic_created) {
    return '';
  }
  return reply.text || reply.caption || '';
}

function getMergeUsageMessage() {
  return "Missing merge target\\.\n\nUsage: `/merge <repository-url|issue-url|pull-request-url> [--auto-resolve]`\n\nYou can also reply with `/merge` to a message containing one GitHub repository, issue, or pull request link\\.\n\nExamples:\n`/merge https://github.com/owner/repo`\n`/merge https://github.com/owner/repo/issues/123`\n`/merge https://github.com/owner/repo/pull/456`\n\nRepository targets merge all PRs with the 'ready' label\\. Issue and pull request targets wait until the target PR is mergeable, then merge it\\.\n\nWith `--auto-resolve` the bot also dispatches `/solve <pr> --auto-merge` for every PR that was skipped because of merge conflicts\\.";
}

function getTargetFoundText(target, count) {
  if (target.mode === 'repository') {
    return `Found ${count} PRs with 'ready' label\\.`;
  }
  const plural = count === 1 ? '' : 's';
  return `Found ${count} target PR${plural} to merge\\.`;
}

/**
 * Resolve the merge target from explicit args, or from a replied message when
 * `/merge` is sent without a URL.
 *
 * @param {string[]} positionals
 * @param {Object} message
 * @returns {{target: Object|null, targetUrl: string|null, fromReply: boolean, error: string|null}}
 */
export function resolveMergeCommandTarget(positionals, message) {
  if (positionals.length > 0) {
    const targetUrl = positionals[0];
    const target = parseMergeTargetUrl(targetUrl);
    return {
      target,
      targetUrl,
      fromReply: false,
      error: target.valid ? null : target.error,
    };
  }

  const replyText = getMergeReplyText(message);
  if (!replyText) {
    return { target: null, targetUrl: null, fromReply: false, error: null };
  }

  const extracted = extractMergeTargetUrlFromText(replyText);
  return {
    target: extracted.target,
    targetUrl: extracted.url,
    fromReply: true,
    error: extracted.valid ? null : extracted.error,
  };
}

/**
 * Issue #1805: Spawner used by the merge queue's auto-resolve pass. For each
 * skipped PR we dispatch a `solve <pr-url> --auto-merge` session through
 * the same `start-screen` runtime the bot uses everywhere else. Keeping this
 * in one place means the per-PR sessions behave exactly like any other
 * `/solve` invocation (same logs, same /watch, same isolation backend).
 *
 * @param {Object} target - Info for the conflicted PR.
 * @param {string} target.url - PR HTML URL passed to `solve`.
 * @param {boolean} verbose - Forwarded to the underlying spawn.
 * @returns {Promise<{ success: boolean, sessionName: string|null, error: string|null, warning: string|null }>}
 */
async function spawnAutoResolveSolve(target, verbose) {
  if (!target || !target.url) {
    return { success: false, sessionName: null, error: 'missing PR URL', warning: null };
  }
  const args = [target.url, '--auto-merge'];
  try {
    const result = await executeStartScreen('solve', args, { verbose });
    if (result.warning) {
      return { success: false, sessionName: null, error: null, warning: result.warning };
    }
    if (!result.success) {
      return { success: false, sessionName: null, error: result.error || 'spawn failed', warning: null };
    }
    const match = result.output && (result.output.match(/session:\s*(\S+)/i) || result.output.match(/screen -R\s+(\S+)/));
    const sessionName = match ? match[1] : null;
    return { success: true, sessionName, error: null, warning: null };
  } catch (error) {
    return { success: false, sessionName: null, error: error.message || String(error), warning: null };
  }
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
 * @param {Function} [options.isTopicAuthorized] - Function to check if topic is authorized (issue #1100)
 * @param {Function} [options.buildAuthErrorMessage] - Function to build authorization error message
 * @param {Function} options.addBreadcrumb - Function to add breadcrumbs for monitoring
 * @param {Function} [options.isChatStopped] - Function to check if chat is stopped (issue #1081)
 * @param {Function} [options.getStoppedChatRejectMessage] - Function to get stopped chat rejection message
 */
export function registerMergeCommand(bot, options) {
  const { VERBOSE = false, isOldMessage, isForwarded, isForwardedOrReply, isGroupChat, isChatAuthorized, isTopicAuthorized, buildAuthErrorMessage, addBreadcrumb, isChatStopped, getStoppedChatRejectMessage } = options;

  bot.command(/^merge$/i, async ctx => {
    VERBOSE && console.log('[VERBOSE] /merge command received');

    await addBreadcrumb({
      category: 'telegram.command',
      message: '/merge command received',
      level: 'info',
      data: { chatId: ctx.chat?.id, chatType: ctx.chat?.type, userId: ctx.from?.id, username: ctx.from?.username },
    });

    // Standard checks
    if (shouldIgnoreMergeCommand(ctx, { isOldMessage, isForwarded, isForwardedOrReply })) return;

    if (!isGroupChat(ctx)) {
      return await ctx.reply('The /merge command only works in group chats. Please add this bot to a group and make it an admin.', {
        reply_to_message_id: ctx.message.message_id,
      });
    }

    const authorize = isTopicAuthorized || (ctx => isChatAuthorized(ctx.chat.id));
    if (!authorize(ctx)) {
      const errMsg = buildAuthErrorMessage ? buildAuthErrorMessage(ctx) : `This chat (ID: ${ctx.chat.id}) is not authorized.`;
      return await ctx.reply(errMsg, { reply_to_message_id: ctx.message.message_id });
    }

    const chatId = ctx.chat.id;

    // Check if chat is stopped (issue #1081) - reject with same style as queue rejected mode
    if (isChatStopped && isChatStopped(chatId)) {
      VERBOSE && console.log('[VERBOSE] /merge rejected: chat is stopped');
      const rejectMsg = getStoppedChatRejectMessage ? getStoppedChatRejectMessage(chatId, 'Merge') : '❌ Merge command rejected.';
      return await ctx.reply(rejectMsg, { reply_to_message_id: ctx.message.message_id });
    }

    // Parse arguments
    const args = parseCommandArgs(ctx.message.text);
    // Issue #1805: split positional args from `--auto-resolve` style flags so
    // the repository URL parsing still sees only the URL token.
    const { positionals, flags } = parseMergeArgs(args);
    const autoResolve = flags['auto-resolve'] === true;

    const targetResult = resolveMergeCommandTarget(positionals, ctx.message);

    if (!targetResult.target && !targetResult.error) {
      return await ctx.reply(getMergeUsageMessage(), { parse_mode: 'MarkdownV2', reply_to_message_id: ctx.message.message_id });
    }

    if (!targetResult.target || !targetResult.target.valid) {
      const invalidPrefix = targetResult.fromReply ? 'Invalid merge target in replied message' : 'Invalid merge target';
      return await ctx.reply(`${invalidPrefix}: ${escapeMarkdownV2(targetResult.error || targetResult.target?.error || 'Unknown target error')}\n\nPlease provide a valid GitHub repository, issue, or pull request URL\\.`, {
        parse_mode: 'MarkdownV2',
        reply_to_message_id: ctx.message.message_id,
      });
    }

    const target = targetResult.target;
    const targetUrl = targetResult.targetUrl || target.url;
    const { owner, repo } = target;
    const repoKey = getRepoKey(owner, repo);
    VERBOSE && console.log(`[VERBOSE] /merge: Processing ${target.mode} target ${targetUrl} in ${owner}/${repo}`);

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
        target,
        // Issue #1805: forward the --auto-resolve flag and inject the spawner.
        // The processor only sees the callback, so unit tests can stub it
        // without spawning real screen sessions.
        autoResolve,
        spawnSolveSession: autoResolve ? target => spawnAutoResolveSolve(target, VERBOSE) : null,
        onProgress: async () => {
          // Update message with progress and cancel button
          try {
            const message = processor.formatProgressMessage();
            // Issue #1588: Do not show cancel button once cancellation has been requested.
            // Without this check, progress updates from CI wait loops would re-add
            // the cancel button after the cancel handler had already removed it.
            const replyMarkup = processor.isCancelled ? undefined : { inline_keyboard: [[{ text: '🛑 Cancel', callback_data: `merge_cancel_${repoKey}` }]] };
            await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, message, {
              parse_mode: 'MarkdownV2',
              ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
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
            VERBOSE && console.log(`[VERBOSE] /merge: Merge queue completed successfully for ${repoKey}`);
          } catch (err) {
            // Issue #1269: Always log completion failures (critical for debugging)
            console.error(`[ERROR] /merge: Error sending final message for ${repoKey}: ${err.message}`);
          }
          activeMergeOperations.delete(repoKey);
        },
        onError: async error => {
          // Issue #1269: Always log errors (not just in verbose mode)
          console.error(`[ERROR] /merge: Queue error for ${repoKey}:`, error.message);
          VERBOSE && console.error(`[VERBOSE] /merge: Full error:`, error);
          try {
            const userMessage = formatUserError(error, VERBOSE);
            const finalReport = processor.formatFinalMessage();
            // Issue #1269: Show error in the reply message with immediate feedback
            // Keep a button so users know the error was displayed and can dismiss
            await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, `❌ *Merge queue failed*\n\n⚠️ *Error:* ${escapeMarkdownV2(userMessage)}\n\n${finalReport}`, {
              parse_mode: 'MarkdownV2',
              reply_markup: {
                inline_keyboard: [[{ text: '❌ Failed - Click to dismiss', callback_data: `merge_dismiss_${repoKey}` }]],
              },
            });
          } catch (err) {
            // Issue #1269: Always log notification failures
            console.error(`[ERROR] /merge: Error sending error message for ${repoKey}: ${err.message}`);
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
        // No PRs to merge
        await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, `*Merge Queue \\- ${escapeMarkdownV2(owner)}/${escapeMarkdownV2(repo)}*${labelMsg}\n\n${escapeMarkdownV2(initResult.message)}\n\nTo use the merge queue:\n1\\. Add the \`ready\` label to repository PRs, or ensure the issue has a linked open PR\n2\\. Run \`/merge ${escapeMarkdownV2(targetUrl)}\` again`, { parse_mode: 'MarkdownV2' });
        return;
      }

      // Update message with PR list and cancel button, start processing
      const truncatedMsg = initResult.truncated ? `\n\n_Note: Only processing first ${MERGE_QUEUE_CONFIG.MAX_PRS_PER_SESSION} PRs_` : '';

      await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, `*Merge Queue \\- ${escapeMarkdownV2(owner)}/${escapeMarkdownV2(repo)}*${labelMsg}\n\n${getTargetFoundText(target, initResult.count)}${escapeMarkdownV2(truncatedMsg)}\n\nStarting merge process\\.\\.\\.`, {
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
      // Issue #1269: Improved error handling - always log errors and notify users
      processor
        .run()
        .then(() => {
          VERBOSE && console.log(`[VERBOSE] /merge: Merge queue completed for ${repoKey}`);
        })
        .catch(async error => {
          // Always log errors (not just in verbose mode) - critical for debugging stuck queues
          console.error(`[ERROR] /merge: Unhandled error in run() for ${repoKey}:`, error.message);
          if (error.stack) {
            console.error(`[ERROR] /merge: Stack trace: ${error.stack.split('\n').slice(0, 5).join('\n')}`);
          }

          // Always notify user about failure (Issue #1269)
          // Show error in the reply message with immediate feedback
          try {
            const userMessage = formatUserError(error, VERBOSE);
            await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, `❌ *Merge queue failed unexpectedly*\n\n⚠️ *Error:* ${escapeMarkdownV2(userMessage)}\n\n_The queue processing has stopped\\. Please try again or check server logs\\._`, {
              parse_mode: 'MarkdownV2',
              reply_markup: {
                inline_keyboard: [[{ text: '❌ Failed - Click to dismiss', callback_data: `merge_dismiss_${repoKey}` }]],
              },
            });
          } catch (notifyError) {
            // Log notification failure but don't throw
            console.error(`[ERROR] /merge: Failed to notify user about error: ${notifyError.message}`);
          }

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
    // Issue #1407: Acknowledge the cancel with a short toast message
    await ctx.answerCbQuery('Cancellation requested.');

    // Issue #1407: Immediately hide the cancel button and update the message to show
    // that the queue is being cancelled. Without this, the button stays visible until
    // the current PR finishes processing (which can take hours if waiting for CI).
    try {
      const cancellingMessage = operation.processor.formatProgressMessage();
      await ctx.editMessageText(cancellingMessage, {
        parse_mode: 'MarkdownV2',
        // No reply_markup = cancel button is removed immediately
      });
    } catch (err) {
      // If the full message edit fails, fall back to just removing the button
      if (!err.message?.includes('message is not modified')) {
        VERBOSE && console.log(`[VERBOSE] /merge: Error updating message on cancel: ${err.message}`);
      }
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      } catch {
        // Ignore errors - the button will be removed when the operation completes
      }
    }

    VERBOSE && console.log(`[VERBOSE] /merge: Cancelled operation for ${repoKey}`);
  });

  // Handle dismiss button callback (Issue #1269: for error acknowledgement)
  bot.action(/^merge_dismiss_(.+)$/, async ctx => {
    const repoKey = ctx.match[1];
    VERBOSE && console.log(`[VERBOSE] /merge dismiss callback received for ${repoKey}`);

    // Remove the inline keyboard button after user acknowledges the error
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      await ctx.answerCbQuery('Error acknowledged.');
    } catch {
      // Ignore errors (message might have been edited already)
      await ctx.answerCbQuery('Error acknowledged.');
    }
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
