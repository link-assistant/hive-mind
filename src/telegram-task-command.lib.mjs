import { buildUserMention } from './buildUserMention.lib.mjs';
import { validateModelName } from './models/index.mjs';
import { parseTaskIssueUrl } from './task.split.lib.mjs';
import { escapeMarkdown } from './telegram-markdown.lib.mjs';
import { extractIsolationFromArgs, isValidPerCommandIsolation } from './telegram-isolation.lib.mjs';
import { moveArgumentToFront, parseCommandArgs } from './telegram-solve-command.lib.mjs';
import { formatStartingWorkSessionMessage } from './work-session-formatting.lib.mjs';

export const TASK_COMMAND_NAMES = Object.freeze(['task', 'split']);

export function getTaskCommandNameFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const firstLine = text.split('\n')[0].trim();
  const match = firstLine.match(/^\/(\w+)(?:@\S+)?(?:\s|$)/);
  const command = match ? match[1].toLowerCase() : null;
  return TASK_COMMAND_NAMES.includes(command) ? command : null;
}

export function applyTaskCommandDefaults(args) {
  const hasSplit = args.includes('--split') || args.some(arg => arg.startsWith('--split='));
  return hasSplit ? args : [...args, '--split'];
}

export function findTaskIssueUrl(args) {
  return args.find(arg => !arg.startsWith('-') && parseTaskIssueUrl(arg).valid) || null;
}

export function getTaskToolFromArgs(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tool' && i + 1 < args.length) return args[i + 1];
    if (args[i].startsWith('--tool=')) return args[i].substring('--tool='.length);
  }
  return 'claude';
}

function getModelFromArgs(args) {
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--model' || args[i] === '-m') && i + 1 < args.length) return args[i + 1];
    if (args[i].startsWith('--model=')) return args[i].substring('--model='.length);
  }
  return null;
}

function validateTaskModel(args) {
  const model = getModelFromArgs(args);
  if (!model) return null;
  const validation = validateModelName(model, getTaskToolFromArgs(args));
  return validation.valid ? null : validation.message;
}

export function buildTaskCommandArgs(text) {
  const args = applyTaskCommandDefaults(parseCommandArgs(text));
  const issueUrl = findTaskIssueUrl(args);
  return {
    args: issueUrl ? moveArgumentToFront(args, issueUrl) : args,
    issueUrl,
  };
}

export function registerTaskCommands(bot, options) {
  const { VERBOSE, taskEnabled, addBreadcrumb, isOldMessage, isGroupChat, isTopicAuthorized, buildAuthErrorMessage, isChatStopped, getStoppedChatRejectMessage, safeReply, executeAndUpdateMessage } = options;

  async function handleTaskCommand(ctx) {
    const commandName = getTaskCommandNameFromText(ctx.message?.text) || 'task';
    const commandDisplay = `/${commandName}`;
    VERBOSE && console.log(`[VERBOSE] ${commandDisplay} command received`);

    await addBreadcrumb({
      category: 'telegram.command',
      message: `${commandDisplay} command received`,
      level: 'info',
      data: { chatId: ctx.chat?.id, chatType: ctx.chat?.type, userId: ctx.from?.id, username: ctx.from?.username },
    });

    if (!taskEnabled) {
      await ctx.reply('❌ The task command is disabled on this bot instance.');
      return;
    }
    if (isOldMessage(ctx)) return;
    if (!isGroupChat(ctx)) {
      await ctx.reply(`❌ The ${commandDisplay} command only works in group chats. Please add this bot to a group and make it an admin.`, { reply_to_message_id: ctx.message.message_id });
      return;
    }
    if (!isTopicAuthorized(ctx)) {
      await ctx.reply(buildAuthErrorMessage(ctx), { reply_to_message_id: ctx.message.message_id });
      return;
    }
    if (isChatStopped(ctx.chat.id)) {
      await safeReply(ctx, getStoppedChatRejectMessage(ctx.chat.id, 'Task'), { reply_to_message_id: ctx.message.message_id });
      return;
    }

    const built = buildTaskCommandArgs(ctx.message.text);
    if (!built.issueUrl) {
      await safeReply(ctx, `❌ Missing GitHub issue URL. Usage: \`${commandDisplay} <github-issue-url> [options]\`\n\nExample: \`${commandDisplay} https://github.com/owner/repo/issues/123\``, { reply_to_message_id: ctx.message.message_id });
      return;
    }

    const parsedIssue = parseTaskIssueUrl(built.issueUrl);
    if (!parsedIssue.valid) {
      await safeReply(ctx, `❌ ${escapeMarkdown(parsedIssue.error || 'Invalid GitHub issue URL')}`, { reply_to_message_id: ctx.message.message_id });
      return;
    }

    const { backend: perCommandIsolation, filteredArgs } = extractIsolationFromArgs(built.args);
    if (perCommandIsolation && !isValidPerCommandIsolation(perCommandIsolation)) {
      await safeReply(ctx, `❌ Invalid --isolation value '${escapeMarkdown(perCommandIsolation)}'. Must be: screen, tmux, or docker`, { reply_to_message_id: ctx.message.message_id });
      return;
    }

    const modelError = validateTaskModel(filteredArgs);
    if (modelError) {
      await safeReply(ctx, `❌ ${escapeMarkdown(modelError)}`, { reply_to_message_id: ctx.message.message_id });
      return;
    }

    const requester = buildUserMention({ user: ctx.from, parseMode: 'Markdown' });
    const userOptionsRaw = built.args.slice(1).join(' ');
    let infoBlock = `Requested by: ${requester}\nIssue: ${escapeMarkdown(built.issueUrl)}`;
    if (userOptionsRaw) infoBlock += `\n\n🛠 Options: ${escapeMarkdown(userOptionsRaw)}`;

    const taskUrlContext = { owner: parsedIssue.owner, repo: parsedIssue.repo, number: parsedIssue.number, type: parsedIssue.type, normalized: parsedIssue.normalized || built.issueUrl };
    const startingMessage = await safeReply(ctx, formatStartingWorkSessionMessage({ infoBlock }), { reply_to_message_id: ctx.message.message_id });
    await executeAndUpdateMessage(ctx, startingMessage, 'task', filteredArgs, infoBlock, perCommandIsolation || null, getTaskToolFromArgs(filteredArgs), taskUrlContext);
  }

  bot.command(
    TASK_COMMAND_NAMES.map(command => new RegExp(`^${command}$`, 'i')),
    handleTaskCommand
  );

  return { handleTaskCommand, TASK_COMMAND_NAMES };
}
