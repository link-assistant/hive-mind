/** Shared authorization, validation and work-session launch for repository tasks. */
import { buildUserMention } from './buildUserMention.lib.mjs';
import { validateRuntimeModelName } from './models/index.mjs';
import { getModelFromArgs } from './model-args.lib.mjs';
import { escapeMarkdown } from './telegram-markdown.lib.mjs';
import { extractIsolationFromArgs, isValidPerCommandIsolation } from './telegram-isolation.lib.mjs';
import { mergeArgsWithOverrides } from './args-overrides.lib.mjs';
import { safeReply as defaultSafeReply } from './telegram-safe-reply.lib.mjs';
import { formatStartingWorkSessionMessage } from './work-session-formatting.lib.mjs';

export function getRepositoryTaskToolFromArgs(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tool' && i + 1 < args.length) return args[i + 1];
    if (args[i].startsWith('--tool=')) return args[i].substring('--tool='.length);
  }
  return 'claude';
}

async function validateRepositoryTaskModel(args) {
  const model = getModelFromArgs(args);
  if (!model) return null;
  const useRouter = args.some(arg => arg === '--use-router' || arg === '--use-router=true');
  const validation = await validateRuntimeModelName(model, getRepositoryTaskToolFromArgs(args), { useRouter });
  return validation.valid ? null : validation.message;
}

// Issue #378: inject --language LOCALE into spawn args if no language flag is
// already present, so spawned sessions inherit the user's effective locale.
function injectLanguageIfMissing(args, locale) {
  if (!locale || !args || !Array.isArray(args)) return args;
  const langFlags = new Set(['--language', '--ui-language', '--work-language']);
  for (const arg of args) {
    const flag = arg.startsWith('--') ? arg.split('=')[0] : null;
    if (flag && langFlags.has(flag)) return args;
  }
  return [...args, '--language', locale];
}

export function registerRepositoryTaskCommand(bot, options) {
  const { VERBOSE, enabled, commandName, executionCommand = commandName, commandNames = [commandName], buildCommandArgs, validateCommandOptions, addBreadcrumb, isOldMessage, isForwardedOrReply, isGroupChat, isTopicAuthorized, buildAuthErrorMessage, isChatStopped, getStoppedChatRejectMessage, safeReply = defaultSafeReply, executeAndUpdateMessage, resolveLocale = null, solveOverrides = [] } = options;

  async function handleRepositoryCommand(ctx) {
    const commandDisplay = `/${commandName}`;
    VERBOSE && console.log(`[VERBOSE] ${commandDisplay} command received`);

    await addBreadcrumb({
      category: 'telegram.command',
      message: `${commandDisplay} command received`,
      level: 'info',
      data: { chatId: ctx.chat?.id, chatType: ctx.chat?.type, userId: ctx.from?.id, username: ctx.from?.username },
    });

    if (!enabled) {
      await safeReply(ctx, `❌ The ${commandName} command is disabled on this bot instance.`);
      return;
    }
    if (isOldMessage(ctx)) return;
    // Repository commands take all input from the command message.
    if (isForwardedOrReply && isForwardedOrReply(ctx)) {
      VERBOSE && console.log(`[VERBOSE] ${commandDisplay} ignored: forwarded or reply message`);
      return;
    }
    if (!isGroupChat(ctx)) {
      await safeReply(ctx, `❌ The ${commandDisplay} command only works in group chats. Please add this bot to a group and make it an admin.`, { reply_to_message_id: ctx.message.message_id });
      return;
    }
    if (!isTopicAuthorized(ctx)) {
      await safeReply(ctx, buildAuthErrorMessage(ctx), { reply_to_message_id: ctx.message.message_id });
      return;
    }
    if (isChatStopped(ctx.chat.id)) {
      await safeReply(ctx, getStoppedChatRejectMessage(ctx.chat.id, commandName[0].toUpperCase() + commandName.slice(1)), { reply_to_message_id: ctx.message.message_id });
      return;
    }

    const built = buildCommandArgs(ctx.message.text);
    if (!built.repository) {
      await safeReply(ctx, `❌ Missing GitHub repository URL. Usage: \`${commandDisplay} <github-repository-url> [options]\`\n\nExample: \`${commandDisplay} https://github.com/owner/repo\``, { reply_to_message_id: ctx.message.message_id });
      return;
    }

    const { backend: perCommandIsolation, filteredArgs } = extractIsolationFromArgs(built.args);
    if (perCommandIsolation && !isValidPerCommandIsolation(perCommandIsolation)) {
      await safeReply(ctx, `❌ Invalid --isolation value '${escapeMarkdown(perCommandIsolation)}'. Must be: screen, tmux, or docker`, { reply_to_message_id: ctx.message.message_id });
      return;
    }

    // Validate before launching so invalid requests receive an immediate reply.
    const optionsError = await validateCommandOptions(filteredArgs);
    if (optionsError) {
      await safeReply(ctx, `❌ Invalid options: ${escapeMarkdown(optionsError)}\n\nUse /help to see available options`, { reply_to_message_id: ctx.message.message_id });
      return;
    }

    // Operator overrides apply to the outer session and the nested solve.
    const { backend: overrideIsolation, filteredArgs: solveOverridesWithoutIsolation } = extractIsolationFromArgs(solveOverrides);
    if (overrideIsolation && !isValidPerCommandIsolation(overrideIsolation)) {
      await safeReply(ctx, `❌ Invalid --isolation value '${escapeMarkdown(overrideIsolation)}' in solve overrides. Must be: screen, tmux, or docker`, { reply_to_message_id: ctx.message.message_id });
      return;
    }
    const effectiveIsolation = overrideIsolation || perCommandIsolation;
    const mergedArgs = mergeArgsWithOverrides(filteredArgs, solveOverridesWithoutIsolation);

    const modelError = await validateRepositoryTaskModel(mergedArgs);
    if (modelError) {
      await safeReply(ctx, `❌ ${escapeMarkdown(modelError)}`, { reply_to_message_id: ctx.message.message_id });
      return;
    }

    const requester = buildUserMention({ user: ctx.from, parseMode: 'Markdown' });
    const userOptionsRaw = built.args.slice(1).join(' ');
    let infoBlock = `Requested by: ${requester}\nRepository: ${escapeMarkdown(built.repository.url)}`;
    if (userOptionsRaw) infoBlock += `\n\n🛠 Options: ${escapeMarkdown(userOptionsRaw)}`;
    if (solveOverrides.length > 0) infoBlock += `\n\n🔒 Solve overrides: ${escapeMarkdown(solveOverrides.join(' '))}`;

    const urlContext = { owner: built.repository.owner, repo: built.repository.repo, normalized: built.repository.url };
    const startingMessage = await safeReply(ctx, formatStartingWorkSessionMessage({ infoBlock }), { reply_to_message_id: ctx.message.message_id });
    const locale = resolveLocale ? resolveLocale(ctx) : null;
    const argsForExec = injectLanguageIfMissing(mergedArgs, locale);
    await executeAndUpdateMessage(ctx, startingMessage, executionCommand, argsForExec, infoBlock, effectiveIsolation || null, getRepositoryTaskToolFromArgs(argsForExec), urlContext);
  }

  bot.command(
    commandNames.map(command => new RegExp(`^${command}$`, 'i')),
    handleRepositoryCommand
  );

  return { handleRepositoryCommand, commandNames };
}
