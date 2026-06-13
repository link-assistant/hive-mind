import { buildUserMention } from './buildUserMention.lib.mjs';
import { validateModelName } from './models/index.mjs';
import { createTaskIssue, parseTaskIssueCreationInput, resolveTaskIssueCreationInput } from './task.issue-creation.lib.mjs';
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

export function hasTaskSplitFlag(args) {
  return args.includes('--split') || args.some(arg => arg.startsWith('--split='));
}

export function applyTaskCommandDefaults(args, commandName = 'task') {
  if (commandName !== 'split') return args;
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
  const commandName = getTaskCommandNameFromText(text) || 'task';
  const args = applyTaskCommandDefaults(parseCommandArgs(text), commandName);
  const issueUrl = findTaskIssueUrl(args);
  return {
    args: issueUrl ? moveArgumentToFront(args, issueUrl) : args,
    issueUrl,
  };
}

function getReplyText(message) {
  const reply = message?.reply_to_message;
  if (!reply || reply.forum_topic_created) return '';
  return reply.text || reply.caption || '';
}

function buildTaskIssueCreationUsage(commandDisplay) {
  return [`Usage: ${commandDisplay} <github-repository-url> followed by issue text.`, '', `Or reply to a message containing a repository URL and issue text with \`${commandDisplay}\`.`, '', 'To split an existing issue, use `/split <github-issue-url>` or `/task --split <github-issue-url>`.'].join('\n');
}

async function editTelegramMessage(ctx, message, text) {
  try {
    await ctx.telegram.editMessageText(message.chat.id, message.message_id, undefined, text, { disable_web_page_preview: true });
  } catch (error) {
    console.error(`[telegram-task-command] Failed to edit status message: ${error.message}`);
  }
}

// Issue #378: inject --language LOCALE into spawn args if no language flag is
// already present, so spawned task sessions inherit the user's effective locale.
function injectLanguageIfMissing(args, locale) {
  if (!locale || !args || !Array.isArray(args)) return args;
  const langFlags = new Set(['--language', '--ui-language', '--work-language']);
  for (const arg of args) {
    const flag = arg.startsWith('--') ? arg.split('=')[0] : null;
    if (flag && langFlags.has(flag)) return args;
  }
  return [...args, '--language', locale];
}

export function registerTaskCommands(bot, options) {
  const { VERBOSE, taskEnabled, addBreadcrumb, isOldMessage, isForwarded, isGroupChat, isTopicAuthorized, buildAuthErrorMessage, isChatStopped, getStoppedChatRejectMessage, safeReply, executeAndUpdateMessage, createTaskIssue: createTaskIssueFn = createTaskIssue, resolveLocale = null } = options;

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
    // Issue #1922: a forwarded /task command must never be re-executed. Replies
    // are still allowed because /task uses them for issue creation, so we use the
    // forwarded-only filter instead of isForwardedOrReply.
    if (isForwarded && isForwarded(ctx)) {
      VERBOSE && console.log(`[VERBOSE] ${commandDisplay} ignored: forwarded message`);
      return;
    }
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

    const parsedArgs = parseCommandArgs(ctx.message.text);
    const splitMode = commandName === 'split' || hasTaskSplitFlag(parsedArgs);

    if (!splitMode) {
      const replyText = getReplyText(ctx.message);
      const creationInput = resolveTaskIssueCreationInput({
        commandText: ctx.message.text,
        replyText,
      });
      VERBOSE && console.log(`[VERBOSE] ${commandDisplay} issue creation: isReply=${Boolean(replyText)} replyChars=${replyText.length} resolvedChars=${creationInput.length}`);
      const creation = parseTaskIssueCreationInput(creationInput);

      if (!creation.valid) {
        await safeReply(ctx, `❌ ${escapeMarkdown(creation.error)}\n\n${buildTaskIssueCreationUsage(commandDisplay)}`, { reply_to_message_id: ctx.message.message_id });
        return;
      }

      const statusMessage = await ctx.reply(`Creating GitHub issue in ${creation.repository.fullName}...`, {
        reply_to_message_id: ctx.message.message_id,
        disable_web_page_preview: true,
      });

      try {
        const createdIssue = await createTaskIssueFn({
          repository: creation.repository,
          title: creation.title,
          body: creation.issueText,
        });
        await editTelegramMessage(ctx, statusMessage, `Created GitHub issue:\n${createdIssue.url}\n\nReply to this message with /solve to start a solution.`);
      } catch (error) {
        await editTelegramMessage(ctx, statusMessage, `Error creating GitHub issue:\n${error.message || String(error)}`);
      }
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
    const taskLocale = resolveLocale ? resolveLocale(ctx) : null;
    const argsForExec = injectLanguageIfMissing(filteredArgs, taskLocale);
    await executeAndUpdateMessage(ctx, startingMessage, 'task', argsForExec, infoBlock, perCommandIsolation || null, getTaskToolFromArgs(argsForExec), taskUrlContext);
  }

  bot.command(
    TASK_COMMAND_NAMES.map(command => new RegExp(`^${command}$`, 'i')),
    handleTaskCommand
  );

  return { handleTaskCommand, TASK_COMMAND_NAMES };
}
