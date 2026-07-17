/**
 * Telegram `/fix` command (issue #1733).
 *
 * Spawns the `fix` CLI in a work session, exactly like `/solve` and `/task` do
 * for their own CLIs. `fix` creates the CI/CD remediation issue and then hands
 * it off to `/solve --development-log --deep-analysis --auto-merge` itself, so
 * this handler only has to validate the request and start the session.
 */

import { buildUserMention } from './buildUserMention.lib.mjs';
import { validateModelName } from './models/index.mjs';
import { parseFixRepository } from './fix.ci-cd.lib.mjs';
import { escapeMarkdown } from './telegram-markdown.lib.mjs';
import { extractIsolationFromArgs, isValidPerCommandIsolation } from './telegram-isolation.lib.mjs';
import { moveArgumentToFront, parseCommandArgs } from './telegram-solve-command.lib.mjs';
import { formatStartingWorkSessionMessage } from './work-session-formatting.lib.mjs';

export const FIX_COMMAND_NAMES = Object.freeze(['fix']);

export function getFixCommandNameFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const firstLine = text.split('\n')[0].trim();
  const match = firstLine.match(/^\/(\w+)(?:@\S+)?(?:\s|$)/);
  const command = match ? match[1].toLowerCase() : null;
  return FIX_COMMAND_NAMES.includes(command) ? command : null;
}

/**
 * `--ci-cd` is the only mode `fix` supports today and it is required by the
 * CLI, so the chat command implies it instead of making every user type it.
 */
export function applyFixCommandDefaults(args) {
  const hasCiCd = args.includes('--ci-cd');
  return hasCiCd ? args : [...args, '--ci-cd'];
}

export function findFixRepositoryArg(args) {
  return args.find(arg => !arg.startsWith('-') && parseFixRepository(arg)) || null;
}

export function getFixToolFromArgs(args) {
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

function validateFixModel(args) {
  const model = getModelFromArgs(args);
  if (!model) return null;
  const validation = validateModelName(model, getFixToolFromArgs(args));
  return validation.valid ? null : validation.message;
}

export function buildFixCommandArgs(text) {
  const args = applyFixCommandDefaults(parseCommandArgs(text));
  const repositoryRaw = findFixRepositoryArg(args);
  const repository = repositoryRaw ? parseFixRepository(repositoryRaw) : null;
  return {
    // `fix` reads the repository from the first bare argument, so normalize the
    // shorthand (`owner/repo`) to a full URL and move it to the front.
    args: repository ? moveArgumentToFront(args, repository.url, value => parseFixRepository(value)?.url || value) : args,
    repositoryRaw,
    repository,
  };
}

// Issue #378: inject --language LOCALE into spawn args if no language flag is
// already present, so spawned fix sessions inherit the user's effective locale.
function injectLanguageIfMissing(args, locale) {
  if (!locale || !args || !Array.isArray(args)) return args;
  const langFlags = new Set(['--language', '--ui-language', '--work-language']);
  for (const arg of args) {
    const flag = arg.startsWith('--') ? arg.split('=')[0] : null;
    if (flag && langFlags.has(flag)) return args;
  }
  return [...args, '--language', locale];
}

export function registerFixCommand(bot, options) {
  const { VERBOSE, fixEnabled, addBreadcrumb, isOldMessage, isForwardedOrReply, isGroupChat, isTopicAuthorized, buildAuthErrorMessage, isChatStopped, getStoppedChatRejectMessage, safeReply, executeAndUpdateMessage, resolveLocale = null } = options;

  async function handleFixCommand(ctx) {
    const commandDisplay = '/fix';
    VERBOSE && console.log(`[VERBOSE] ${commandDisplay} command received`);

    await addBreadcrumb({
      category: 'telegram.command',
      message: `${commandDisplay} command received`,
      level: 'info',
      data: { chatId: ctx.chat?.id, chatType: ctx.chat?.type, userId: ctx.from?.id, username: ctx.from?.username },
    });

    if (!fixEnabled) {
      await ctx.reply('❌ The fix command is disabled on this bot instance.');
      return;
    }
    if (isOldMessage(ctx)) return;
    // Issue #1922: a forwarded or replied-to /fix command must never be
    // re-executed. Unlike /task, /fix takes no input from the replied message,
    // so both cases are ignored.
    if (isForwardedOrReply && isForwardedOrReply(ctx)) {
      VERBOSE && console.log(`[VERBOSE] ${commandDisplay} ignored: forwarded or reply message`);
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
      await safeReply(ctx, getStoppedChatRejectMessage(ctx.chat.id, 'Fix'), { reply_to_message_id: ctx.message.message_id });
      return;
    }

    const built = buildFixCommandArgs(ctx.message.text);
    if (!built.repository) {
      await safeReply(ctx, `❌ Missing GitHub repository URL. Usage: \`${commandDisplay} <github-repository-url> [options]\`\n\nExample: \`${commandDisplay} https://github.com/owner/repo\``, { reply_to_message_id: ctx.message.message_id });
      return;
    }

    const { backend: perCommandIsolation, filteredArgs } = extractIsolationFromArgs(built.args);
    if (perCommandIsolation && !isValidPerCommandIsolation(perCommandIsolation)) {
      await safeReply(ctx, `❌ Invalid --isolation value '${escapeMarkdown(perCommandIsolation)}'. Must be: screen, tmux, or docker`, { reply_to_message_id: ctx.message.message_id });
      return;
    }

    const modelError = validateFixModel(filteredArgs);
    if (modelError) {
      await safeReply(ctx, `❌ ${escapeMarkdown(modelError)}`, { reply_to_message_id: ctx.message.message_id });
      return;
    }

    const requester = buildUserMention({ user: ctx.from, parseMode: 'Markdown' });
    const userOptionsRaw = built.args.slice(1).join(' ');
    let infoBlock = `Requested by: ${requester}\nRepository: ${escapeMarkdown(built.repository.url)}`;
    if (userOptionsRaw) infoBlock += `\n\n🛠 Options: ${escapeMarkdown(userOptionsRaw)}`;

    const fixUrlContext = { owner: built.repository.owner, repo: built.repository.repo, normalized: built.repository.url };
    const startingMessage = await safeReply(ctx, formatStartingWorkSessionMessage({ infoBlock }), { reply_to_message_id: ctx.message.message_id });
    const fixLocale = resolveLocale ? resolveLocale(ctx) : null;
    const argsForExec = injectLanguageIfMissing(filteredArgs, fixLocale);
    await executeAndUpdateMessage(ctx, startingMessage, 'fix', argsForExec, infoBlock, perCommandIsolation || null, getFixToolFromArgs(argsForExec), fixUrlContext);
  }

  bot.command(
    FIX_COMMAND_NAMES.map(command => new RegExp(`^${command}$`, 'i')),
    handleFixCommand
  );

  return { handleFixCommand, FIX_COMMAND_NAMES };
}
