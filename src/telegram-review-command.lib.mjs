import { buildUserMention } from './buildUserMention.lib.mjs';
import { getLinoYargsFactory } from './cli-arguments.lib.mjs';
import { createYargsConfig } from './review.config.lib.mjs';
import { parseReviewUrl } from './review.lib.mjs';
import { detectMalformedFlags } from './option-suggestions.lib.mjs';
import { injectLanguageIfMissing, validateRuntimeModelInArgs } from './telegram-command-args.lib.mjs';
import { moveArgumentToFront, parseArgsWithYargs, parseCommandArgs } from './telegram-solve-command.lib.mjs';
import { extractIsolationFromArgs, isValidPerCommandIsolation } from './telegram-isolation.lib.mjs';
import { escapeMarkdown } from './telegram-markdown.lib.mjs';
import { buildTelegramInfoBlock } from './telegram-ui-messages.lib.mjs';
import { formatStartingWorkSessionMessage } from './work-session-formatting.lib.mjs';

export function buildReviewCommandArgs(text, replyText = '') {
  let args = parseCommandArgs(text);
  const urls = args.filter(arg => /^https?:\/\//i.test(arg));
  if (!urls.length) urls.push(...(replyText.match(/https:\/\/github\.com\/[^\s<>()]+/gi) || []));
  const targets = new Map(
    urls.map(url => {
      const target = parseReviewUrl(url);
      return [target.url, target];
    })
  );
  if (targets.size !== 1) throw new Error('Provide one GitHub pull request URL. Usage: /review <pr-url> [options], or reply to a message containing a PR link');
  const target = [...targets.values()][0];
  if (!args.some(arg => /^https?:\/\//i.test(arg))) args = [target.url, ...args];
  else args = moveArgumentToFront(args, target.url, value => (urls.includes(value) ? parseReviewUrl(value).url : value));
  return { args, target };
}

export function registerReviewCommand(bot, options) {
  const { reviewEnabled = true, isOldMessage, isForwarded, isGroupChat, isTopicAuthorized, buildAuthErrorMessage, isChatStopped, getStoppedChatRejectMessage, safeReply, executeAndUpdateMessage, resolveLocale = () => null, validateModel = validateRuntimeModelInArgs } = options;
  async function handleReviewCommand(ctx) {
    const replyOptions = { reply_to_message_id: ctx.message.message_id };
    if (!reviewEnabled) return safeReply(ctx, '❌ The review command is disabled on this bot instance.', replyOptions);
    if (isOldMessage(ctx) || isForwarded?.(ctx)) return;
    if (!isGroupChat(ctx)) return safeReply(ctx, '❌ The /review command only works in group chats.', replyOptions);
    if (!isTopicAuthorized(ctx)) return safeReply(ctx, buildAuthErrorMessage(ctx), replyOptions);
    if (isChatStopped(ctx.chat.id)) return safeReply(ctx, getStoppedChatRejectMessage(ctx.chat.id, 'Review'), replyOptions);
    let request;
    let parsed;
    let isolation;
    let args;
    try {
      const reply = ctx.message.reply_to_message;
      request = buildReviewCommandArgs(ctx.message.text, reply?.text || reply?.caption || '');
      const malformed = detectMalformedFlags(request.args);
      if (malformed.malformed.length) throw new Error(malformed.errors.join('\n'));
      const extracted = extractIsolationFromArgs(request.args);
      isolation = extracted.backend;
      args = extracted.filteredArgs;
      if (isolation && !isValidPerCommandIsolation(isolation)) throw new Error('Invalid --isolation. Use screen, tmux, or docker');
      parsed = await parseArgsWithYargs(args, getLinoYargsFactory(), createYargsConfig);
      const modelError = await validateModel(args, parsed.tool);
      if (modelError) throw new Error(modelError);
    } catch (error) {
      return safeReply(ctx, `❌ ${escapeMarkdown(error.message)}`, replyOptions);
    }
    const locale = resolveLocale(ctx);
    const infoBlock = buildTelegramInfoBlock({ locale, requester: buildUserMention({ user: ctx.from, parseMode: 'Markdown' }), urlKind: 'pullRequest', url: escapeMarkdown(request.target.url), optionsRaw: escapeMarkdown(args.slice(1).join(' ')) });
    const startingMessage = await safeReply(ctx, formatStartingWorkSessionMessage({ infoBlock, locale }), replyOptions);
    const target = { ...request.target, number: request.target.prNumber, type: 'pull', normalized: request.target.url };
    return executeAndUpdateMessage(ctx, startingMessage, 'review', injectLanguageIfMissing(args, locale), infoBlock, isolation || null, parsed.tool, target, { locale });
  }
  bot.command(/^review$/i, handleReviewCommand);
  return { handleReviewCommand };
}
