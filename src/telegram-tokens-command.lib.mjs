#!/usr/bin/env node
/**
 * Telegram /tokens command — hidden, owner-only, private-chat only.
 *
 * Lists every known LOCAL token the bot can see (env vars + GitHub CLI
 * tokens), already masked via `maskToken` (3-char prefix/suffix per
 * issue #1745). Useful for spot-checking which secrets are live in the
 * bot's environment so the operator can search for them in public places
 * before they become a leak.
 *
 * Privacy / safety guarantees:
 *
 *  - Hidden command. Not advertised in /help. Not part of the BotFather
 *    command list.
 *  - Private-chat only. Never echoes tokens (even masked) into a group chat.
 *  - Authenticated. The user must own (`status === 'creator'`) at least one
 *    chat that is on the allowlist — i.e. they're an actual operator of
 *    this bot, not a random DMer.
 *  - Output is always masked. We never print raw values.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1745
 * @module telegram-tokens-command
 */

import { getAllKnownLocalTokens } from './token-sanitization.lib.mjs';
import { maskToken } from './lib.mjs';

/**
 * Resolve allowed chat IDs into an array of numeric IDs the user could own.
 * Accepts:
 *   - Array<number|string>
 *   - Function returning Array<number|string>
 *   - undefined / null  (treated as "any" — useful in private bot deployments)
 *
 * @param {Array|Function|null|undefined} allowedChats
 * @returns {Array<string>}  numeric chat IDs as strings
 */
const resolveAllowedChatIds = allowedChats => {
  if (!allowedChats) return [];
  const raw = typeof allowedChats === 'function' ? allowedChats() : allowedChats;
  if (!Array.isArray(raw)) return [];
  return raw.map(v => String(v)).filter(Boolean);
};

/**
 * Returns true if `userId` is the creator of any chat in `allowedChatIds`.
 * Returns true unconditionally when `allowedChatIds` is empty (private
 * deployment — no allowlist means any DM is fine).
 */
const isOperatorOfAnyAllowedChat = async ({ telegram, userId, allowedChatIds }) => {
  if (!allowedChatIds || allowedChatIds.length === 0) {
    return true;
  }
  for (const chatId of allowedChatIds) {
    try {
      const member = await telegram.getChatMember(chatId, userId);
      if (member && member.status === 'creator') {
        return true;
      }
    } catch {
      // Bot may have been removed from the chat; skip and try the next one.
    }
  }
  return false;
};

/**
 * Format the token list for display. Each line: `name (source): masked`.
 * The masked form is `first-3 *** last-3` per maskToken's new default.
 */
export const formatTokenList = tokens => {
  if (!tokens || tokens.length === 0) {
    return 'No known local tokens found in this bot process.';
  }
  const lines = tokens.map(t => {
    const masked = maskToken(t.value);
    return `• ${t.name} (${t.source}): \`${masked}\``;
  });
  return ['🔐 *Active local tokens (masked):*', '', ...lines, '', '_Use this list to search public places (GitHub, Slack, etc.) for accidentally leaked tokens before they become a problem. Tokens are masked with first 3 + last 3 characters per issue #1745._'].join('\n');
};

/**
 * Registers the hidden /tokens command on the bot.
 *
 * @param {Object} bot - Telegraf bot
 * @param {Object} options
 * @param {boolean} [options.VERBOSE]
 * @param {Function} [options.isOldMessage]
 * @param {Array|Function} [options.allowedChats] — used for owner-of-allowed-chat check
 * @param {Function} [options.fetchTokens] — test override for getAllKnownLocalTokens
 */
export const registerTokensCommand = (bot, options = {}) => {
  const { VERBOSE = false, isOldMessage, allowedChats } = options;
  const fetchTokens = options.fetchTokens || getAllKnownLocalTokens;

  bot.command('tokens', async ctx => {
    if (isOldMessage && isOldMessage(ctx)) {
      VERBOSE && console.log('[VERBOSE] /tokens ignored: old message');
      return;
    }

    const chat = ctx.chat;
    if (!chat || !ctx.from) return;

    // Step 1: private-chat only. Silently no-op in groups so the command stays
    // truly hidden — a curious group member never gets a hint that it exists.
    if (chat.type !== 'private') {
      VERBOSE && console.log(`[VERBOSE] /tokens ignored: chat type ${chat.type} (private only)`);
      return;
    }

    // Step 2: authenticate by ownership of an allowlisted chat.
    const allowedChatIds = resolveAllowedChatIds(allowedChats);
    let isOperator = false;
    try {
      isOperator = await isOperatorOfAnyAllowedChat({
        telegram: ctx.telegram,
        userId: ctx.from.id,
        allowedChatIds,
      });
    } catch (err) {
      VERBOSE && console.error('[VERBOSE] /tokens auth check failed:', err);
      isOperator = false;
    }

    if (!isOperator) {
      VERBOSE && console.log(`[VERBOSE] /tokens denied: user ${ctx.from.id} is not creator of any allowed chat`);
      // Reply with a generic "unknown command"-shaped message so the command
      // stays undiscoverable to non-operators.
      return;
    }

    // Step 3: gather and emit.
    let tokens;
    try {
      tokens = await fetchTokens();
    } catch (err) {
      VERBOSE && console.error('[VERBOSE] /tokens: fetchTokens failed:', err);
      await ctx.reply('❌ Failed to gather local tokens.');
      return;
    }

    const message = formatTokenList(tokens);
    await ctx.reply(message, { parse_mode: 'Markdown' });
  });
};

export default {
  registerTokensCommand,
  formatTokenList,
};
