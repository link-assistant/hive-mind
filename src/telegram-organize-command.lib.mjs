import { normalizeThinkLevel } from './think-level.lib.mjs';
import { parseOrganizationRepositoryUrl } from './organize.github.lib.mjs';
import { formatOrganizationSummary, organizeRepository as defaultOrganizeRepository } from './organize.lib.mjs';
import { parseCommandArgs } from './telegram-solve-command.lib.mjs';
import { safeEditMessageText as defaultSafeEditMessageText, safeReply as defaultSafeReply } from './telegram-safe-reply.lib.mjs';
import { sanitizeForPublication } from './token-sanitization.lib.mjs';

export const ORGANIZE_COMMAND_NAMES = Object.freeze(['organize']);
const GITHUB_URL_PATTERN = /https?:\/\/(?:www\.)?github\.com\/[^\s<>()]+/gi;
const activeOrganizationRuns = new Set();

function optionValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`Option ${name} requires a value`);
  return value;
}

/** Parse only explicit options on line one; remaining text is untrusted notes. */
export function parseOrganizeRequest({ commandText = '', replyText = '' } = {}) {
  try {
    const [firstLine = '', ...noteLines] = String(commandText).split('\n');
    const args = parseCommandArgs(firstLine);
    const candidates = [];
    let dryRun = false;
    let tool = 'claude';
    let model = null;
    let think = null;

    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (arg === '--dry-run') dryRun = true;
      else if (arg === '--tool') tool = optionValue(args, index++, '--tool');
      else if (arg.startsWith('--tool=')) tool = arg.slice('--tool='.length);
      else if (arg === '--model') model = optionValue(args, index++, '--model');
      else if (arg.startsWith('--model=')) model = arg.slice('--model='.length);
      else if (arg === '--think') think = normalizeThinkLevel(optionValue(args, index++, '--think'));
      else if (arg.startsWith('--think=')) think = normalizeThinkLevel(arg.slice('--think='.length));
      else if (GITHUB_URL_PATTERN.test(arg)) candidates.push(arg);
      else if (arg.startsWith('-')) throw new Error(`Unknown option "${arg}"`);
      else throw new Error(`Unexpected argument "${arg}". Put operator instructions on a new line.`);
      GITHUB_URL_PATTERN.lastIndex = 0;
    }

    const reply = String(replyText || '');
    candidates.push(...(reply.match(GITHUB_URL_PATTERN) || []));
    const repositories = candidates.map(parseOrganizationRepositoryUrl);
    const distinct = new Map(repositories.map(repository => [repository.fullName.toLowerCase(), repository]));
    if (distinct.size === 0) throw new Error('Missing GitHub repository URL. Usage: /organize <github-repository-url> [--dry-run]');
    if (distinct.size > 1) throw new Error('Only one GitHub repository may be organized per command');

    const replyNotes = reply.replace(GITHUB_URL_PATTERN, '').trim();
    const operatorInstructions = [...noteLines, replyNotes].filter(Boolean).join('\n').trim();
    return { repository: [...distinct.values()][0], dryRun, tool: tool.toLowerCase(), model, think, operatorInstructions, error: null };
  } catch (error) {
    return { repository: null, dryRun: false, tool: 'claude', model: null, think: null, operatorInstructions: '', error: error.message };
  }
}

export function registerOrganizeCommand(bot, options) {
  const { VERBOSE = false, organizeEnabled = true, addBreadcrumb = async () => {}, isOldMessage, isForwarded, isGroupChat, isTopicAuthorized, buildAuthErrorMessage, isChatStopped, getStoppedChatRejectMessage, safeReply = defaultSafeReply, safeEditMessageText = async (ctx, message, text) => defaultSafeEditMessageText(ctx.telegram, message.chat.id, message.message_id, undefined, text, { verbose: VERBOSE }), organizeRepository = defaultOrganizeRepository } = options;

  async function handleOrganizeCommand(ctx) {
    await addBreadcrumb({
      category: 'telegram.command',
      message: '/organize command received',
      level: 'info',
      data: { chatId: ctx.chat?.id, chatType: ctx.chat?.type, userId: ctx.from?.id, username: ctx.from?.username },
    });
    if (!organizeEnabled) {
      await safeReply(ctx, '❌ The organize command is disabled on this bot instance.');
      return;
    }
    if (isOldMessage(ctx)) return;
    if (isForwarded?.(ctx)) return;
    if (!isGroupChat(ctx)) {
      await safeReply(ctx, '❌ The /organize command only works in group chats. Please add this bot to a group and make it an admin.', { reply_to_message_id: ctx.message.message_id });
      return;
    }
    if (!isTopicAuthorized(ctx)) {
      await safeReply(ctx, buildAuthErrorMessage(ctx), { reply_to_message_id: ctx.message.message_id });
      return;
    }
    if (isChatStopped(ctx.chat.id)) {
      await safeReply(ctx, getStoppedChatRejectMessage(ctx.chat.id, 'Organize'), { reply_to_message_id: ctx.message.message_id });
      return;
    }

    const parsed = parseOrganizeRequest({ commandText: ctx.message.text, replyText: ctx.message.reply_to_message?.text || ctx.message.reply_to_message?.caption || '' });
    if (parsed.error) {
      await safeReply(ctx, `❌ ${parsed.error}`, { reply_to_message_id: ctx.message.message_id });
      return;
    }

    const repositoryKey = parsed.repository.fullName.toLowerCase();
    if (activeOrganizationRuns.has(repositoryKey)) {
      await safeReply(ctx, `⏳ An organization run is already active for ${parsed.repository.fullName}.`, { reply_to_message_id: ctx.message.message_id });
      return;
    }

    activeOrganizationRuns.add(repositoryKey);
    let status;
    try {
      status = await safeReply(ctx, `${parsed.dryRun ? '🔎 Planning organization' : '🗂 Organizing'} ${parsed.repository.fullName}…`, { reply_to_message_id: ctx.message.message_id });
      const result = await organizeRepository({
        repositoryUrl: parsed.repository.url,
        dryRun: parsed.dryRun,
        operatorInstructions: parsed.operatorInstructions,
        tool: parsed.tool,
        model: parsed.model,
        think: parsed.think,
        requestedBy: { telegramUserId: ctx.from?.id || null, username: ctx.from?.username || null, chatId: ctx.chat?.id || null, topicId: ctx.message?.message_thread_id || null },
        progress: async update => {
          VERBOSE && console.log(`[VERBOSE] /organize: ${update.message}`);
        },
      });
      const summary = await formatOrganizationSummary(result);
      await safeEditMessageText(ctx, status, summary);
    } catch (error) {
      const safeError = await sanitizeForPublication(error?.message || String(error));
      if (status) await safeEditMessageText(ctx, status, `❌ Organization failed: ${safeError}`);
      else await safeReply(ctx, `❌ Organization failed: ${safeError}`, { reply_to_message_id: ctx.message.message_id });
    } finally {
      activeOrganizationRuns.delete(repositoryKey);
    }
  }

  bot.command(/^organize$/i, handleOrganizeCommand);
  return { handleOrganizeCommand, ORGANIZE_COMMAND_NAMES };
}
