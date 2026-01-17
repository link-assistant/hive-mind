/**
 * Telegram /accept_invites command implementation
 *
 * This module provides the /accept_invites command functionality for the Telegram bot,
 * allowing users to accept all pending GitHub repository and organization invitations.
 *
 * Features:
 * - Accepts all pending repository invitations
 * - Accepts all pending organization invitations
 * - Provides detailed feedback on accepted invitations
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

    const fetchingMessage = await ctx.reply('🔄 Fetching pending GitHub invitations...', { reply_to_message_id: ctx.message.message_id });
    const accepted = [];
    const errors = [];

    try {
      // Fetch repository invitations
      const { stdout: repoInvJson } = await exec('gh api /user/repository_invitations 2>/dev/null || echo "[]"');
      const repoInvitations = JSON.parse(repoInvJson.trim() || '[]');
      VERBOSE && console.log(`[VERBOSE] Found ${repoInvitations.length} pending repo invitations`);

      // Accept each repo invitation
      for (const inv of repoInvitations) {
        const repoName = inv.repository?.full_name || 'unknown';
        try {
          await exec(`gh api -X PATCH /user/repository_invitations/${inv.id}`);
          accepted.push(`📦 Repository: ${repoName}`);
          VERBOSE && console.log(`[VERBOSE] Accepted repo invitation: ${repoName}`);
        } catch (e) {
          errors.push(`📦 ${repoName}: ${e.message}`);
          VERBOSE && console.log(`[VERBOSE] Failed to accept repo invitation ${repoName}: ${e.message}`);
        }
      }

      // Fetch organization invitations
      const { stdout: orgMemJson } = await exec('gh api /user/memberships/orgs 2>/dev/null || echo "[]"');
      const orgMemberships = JSON.parse(orgMemJson.trim() || '[]');
      const pendingOrgs = orgMemberships.filter(m => m.state === 'pending');
      VERBOSE && console.log(`[VERBOSE] Found ${pendingOrgs.length} pending org invitations`);

      // Accept each org invitation
      for (const membership of pendingOrgs) {
        const orgName = membership.organization?.login || 'unknown';
        try {
          await exec(`gh api -X PATCH /user/memberships/orgs/${orgName} -f state=active`);
          accepted.push(`🏢 Organization: ${orgName}`);
          VERBOSE && console.log(`[VERBOSE] Accepted org invitation: ${orgName}`);
        } catch (e) {
          errors.push(`🏢 ${orgName}: ${e.message}`);
          VERBOSE && console.log(`[VERBOSE] Failed to accept org invitation ${orgName}: ${e.message}`);
        }
      }

      // Build response message
      let message = '✅ *GitHub Invitations Processed*\n\n';
      if (accepted.length === 0 && errors.length === 0) {
        message += 'No pending invitations found.';
      } else {
        if (accepted.length > 0) {
          message += '*Accepted:*\n' + accepted.map(a => `  • ${escapeMarkdown(a)}`).join('\n') + '\n\n';
        }
        if (errors.length > 0) {
          message += '*Errors:*\n' + errors.map(e => `  • ${escapeMarkdown(e)}`).join('\n');
        }
        if (accepted.length > 0 && errors.length === 0) {
          message += `\n🎉 Successfully accepted ${accepted.length} invitation(s)!`;
        }
      }

      await ctx.telegram.editMessageText(fetchingMessage.chat.id, fetchingMessage.message_id, undefined, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error in /accept-invites:', error);
      await ctx.telegram.editMessageText(fetchingMessage.chat.id, fetchingMessage.message_id, undefined, `❌ Error fetching invitations: ${escapeMarkdown(error.message)}\n\nMake sure \`gh\` CLI is installed and authenticated.`, { parse_mode: 'Markdown' });
    }
  });
}
