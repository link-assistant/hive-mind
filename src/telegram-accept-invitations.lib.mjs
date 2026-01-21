/**
 * Telegram /accept_invites command implementation
 *
 * This module provides the /accept_invites command functionality for the Telegram bot,
 * allowing users to accept all pending GitHub repository and organization invitations.
 *
 * Features:
 * - Accepts all pending repository invitations
 * - Accepts all pending organization invitations
 * - Groups output by Repositories and Organizations
 * - Provides clickable links to repositories and organizations
 * - Real-time progress updates during processing
 * - Error handling with detailed error messages
 *
 * @see https://docs.github.com/en/rest/collaborators/invitations
 * @see https://docs.github.com/en/rest/orgs/members
 */

import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const exec = promisify(execCallback);

/**
 * Escapes special characters in text for Telegram Markdown formatting
 * @param {string} text - The text to escape
 * @returns {string} The escaped text
 */
function escapeMarkdown(text) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

/**
 * Build progress message from current state
 * @param {Object} state - Current state object
 * @param {string[]} state.acceptedRepos - List of accepted repo names
 * @param {string[]} state.acceptedOrgs - List of accepted org names
 * @param {string[]} state.errors - List of errors
 * @param {number} state.totalRepos - Total number of repo invitations
 * @param {number} state.totalOrgs - Total number of org invitations
 * @param {number} state.processedRepos - Number of processed repo invitations
 * @param {number} state.processedOrgs - Number of processed org invitations
 * @param {boolean} state.isComplete - Whether processing is complete
 * @returns {string} Formatted message
 */
function buildProgressMessage(state) {
  const { acceptedRepos, acceptedOrgs, errors, totalRepos, totalOrgs, processedRepos, processedOrgs, isComplete } = state;

  // Calculate totals
  const totalInvitations = totalRepos + totalOrgs;
  const processedTotal = processedRepos + processedOrgs;
  const acceptedTotal = acceptedRepos.length + acceptedOrgs.length;

  // Build header with progress indicator
  let message = isComplete ? '✅ *GitHub Invitations Processed*\n\n' : `🔄 *Processing GitHub Invitations* \\(${processedTotal}/${totalInvitations}\\)\n\n`;

  // Show Repositories section if any
  if (acceptedRepos.length > 0 || (!isComplete && totalRepos > 0)) {
    message += '*Repositories:*\n';
    for (const repoName of acceptedRepos) {
      // Create clickable link: [owner/repo](https://github.com/owner/repo)
      const escapedName = escapeMarkdown(repoName);
      const escapedLink = escapeMarkdown(`https://github.com/${repoName}`);
      message += `  • 📦 [${escapedName}](${escapedLink})\n`;
    }
    // Show pending indicator if still processing repos
    if (!isComplete && processedRepos < totalRepos) {
      const remaining = totalRepos - processedRepos;
      message += `  • _\\.\\.\\. ${remaining} more pending_\n`;
    }
    message += '\n';
  }

  // Show Organizations section if any
  if (acceptedOrgs.length > 0 || (!isComplete && totalOrgs > 0)) {
    message += '*Organizations:*\n';
    for (const orgName of acceptedOrgs) {
      // Create clickable link: [org](https://github.com/org)
      const escapedName = escapeMarkdown(orgName);
      const escapedLink = escapeMarkdown(`https://github.com/${orgName}`);
      message += `  • 🏢 [${escapedName}](${escapedLink})\n`;
    }
    // Show pending indicator if still processing orgs
    if (!isComplete && processedOrgs < totalOrgs) {
      const remaining = totalOrgs - processedOrgs;
      message += `  • _\\.\\.\\. ${remaining} more pending_\n`;
    }
    message += '\n';
  }

  // Show errors if any
  if (errors.length > 0) {
    message += '*Errors:*\n' + errors.map(e => `  • ${escapeMarkdown(e)}`).join('\n') + '\n\n';
  }

  // Show summary
  if (isComplete) {
    if (acceptedTotal === 0 && errors.length === 0) {
      message += 'No pending invitations found\\.';
    } else if (acceptedTotal > 0 && errors.length === 0) {
      message += `\n🎉 Successfully accepted ${acceptedTotal} invitation\\(s\\)\\!`;
    } else if (acceptedTotal > 0 && errors.length > 0) {
      message += `\n⚠️ Accepted ${acceptedTotal} invitation\\(s\\), ${errors.length} error\\(s\\)\\.`;
    }
  }

  return message;
}

/**
 * Registers the /accept_invites command handler with the bot
 * @param {Object} bot - The Telegraf bot instance
 * @param {Object} options - Options object
 * @param {boolean} options.VERBOSE - Whether to enable verbose logging
 * @param {Function} options.isOldMessage - Function to check if message is old
 * @param {Function} options.isForwardedOrReply - Function to check if message is forwarded/reply
 * @param {Function} options.isGroupChat - Function to check if chat is a group
 * @param {Function} options.isChatAuthorized - Function to check if chat is authorized
 * @param {Function} options.addBreadcrumb - Function to add breadcrumbs for monitoring
 */
export function registerAcceptInvitesCommand(bot, options) {
  const { VERBOSE = false, isOldMessage, isForwardedOrReply, isGroupChat, isChatAuthorized, addBreadcrumb } = options;

  bot.command(/^accept[_-]?invites$/i, async ctx => {
    VERBOSE && console.log('[VERBOSE] /accept-invites command received');
    await addBreadcrumb({
      category: 'telegram.command',
      message: '/accept-invites command received',
      level: 'info',
      data: { chatId: ctx.chat?.id, chatType: ctx.chat?.type, userId: ctx.from?.id, username: ctx.from?.username },
    });
    if (isOldMessage(ctx) || isForwardedOrReply(ctx)) return;
    if (!isGroupChat(ctx))
      return await ctx.reply('❌ The /accept_invites command only works in group chats. Please add this bot to a group and make it an admin.', {
        reply_to_message_id: ctx.message.message_id,
      });
    const chatId = ctx.chat.id;
    if (!isChatAuthorized(chatId))
      return await ctx.reply(`❌ This chat (ID: ${chatId}) is not authorized to use this bot. Please contact the bot administrator.`, {
        reply_to_message_id: ctx.message.message_id,
      });

    const fetchingMessage = await ctx.reply('🔄 Fetching pending GitHub invitations\\.\\.\\.', {
      reply_to_message_id: ctx.message.message_id,
      parse_mode: 'MarkdownV2',
    });

    // State for tracking progress
    const state = {
      acceptedRepos: [],
      acceptedOrgs: [],
      errors: [],
      totalRepos: 0,
      totalOrgs: 0,
      processedRepos: 0,
      processedOrgs: 0,
      isComplete: false,
    };

    // Helper to update the message safely
    const updateMessage = async () => {
      try {
        const message = buildProgressMessage(state);
        await ctx.telegram.editMessageText(fetchingMessage.chat.id, fetchingMessage.message_id, undefined, message, { parse_mode: 'MarkdownV2' });
      } catch (err) {
        // Ignore "message not modified" errors
        if (!err.message?.includes('message is not modified')) {
          VERBOSE && console.log(`[VERBOSE] /accept-invites: Error updating message: ${err.message}`);
        }
      }
    };

    try {
      // Fetch repository invitations
      const { stdout: repoInvJson } = await exec('gh api /user/repository_invitations 2>/dev/null || echo "[]"');
      const repoInvitations = JSON.parse(repoInvJson.trim() || '[]');
      state.totalRepos = repoInvitations.length;
      VERBOSE && console.log(`[VERBOSE] Found ${repoInvitations.length} pending repo invitations`);

      // Fetch organization invitations
      const { stdout: orgMemJson } = await exec('gh api /user/memberships/orgs 2>/dev/null || echo "[]"');
      const orgMemberships = JSON.parse(orgMemJson.trim() || '[]');
      const pendingOrgs = orgMemberships.filter(m => m.state === 'pending');
      state.totalOrgs = pendingOrgs.length;
      VERBOSE && console.log(`[VERBOSE] Found ${pendingOrgs.length} pending org invitations`);

      // Check if there are any invitations
      if (state.totalRepos === 0 && state.totalOrgs === 0) {
        state.isComplete = true;
        await updateMessage();
        return;
      }

      // Update to show we found invitations
      await updateMessage();

      // Accept each repo invitation with progress updates
      for (const inv of repoInvitations) {
        const repoName = inv.repository?.full_name || 'unknown';
        try {
          await exec(`gh api -X PATCH /user/repository_invitations/${inv.id}`);
          state.acceptedRepos.push(repoName);
          VERBOSE && console.log(`[VERBOSE] Accepted repo invitation: ${repoName}`);
        } catch (e) {
          state.errors.push(`📦 ${repoName}: ${e.message}`);
          VERBOSE && console.log(`[VERBOSE] Failed to accept repo invitation ${repoName}: ${e.message}`);
        }
        state.processedRepos++;
        await updateMessage();
      }

      // Accept each org invitation with progress updates
      for (const membership of pendingOrgs) {
        const orgName = membership.organization?.login || 'unknown';
        try {
          await exec(`gh api -X PATCH /user/memberships/orgs/${orgName} -f state=active`);
          state.acceptedOrgs.push(orgName);
          VERBOSE && console.log(`[VERBOSE] Accepted org invitation: ${orgName}`);
        } catch (e) {
          state.errors.push(`🏢 ${orgName}: ${e.message}`);
          VERBOSE && console.log(`[VERBOSE] Failed to accept org invitation ${orgName}: ${e.message}`);
        }
        state.processedOrgs++;
        await updateMessage();
      }

      // Final update
      state.isComplete = true;
      await updateMessage();
    } catch (error) {
      console.error('Error in /accept-invites:', error);
      const escapedError = escapeMarkdown(error.message);
      await ctx.telegram.editMessageText(fetchingMessage.chat.id, fetchingMessage.message_id, undefined, `❌ Error fetching invitations: ${escapedError}\n\nMake sure \`gh\` CLI is installed and authenticated\\.`, { parse_mode: 'MarkdownV2' });
    }
  });
}
