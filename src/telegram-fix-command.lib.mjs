/**
 * Telegram `/fix` command (issue #1733).
 *
 * Spawns the `fix` CLI in a work session, exactly like `/solve` and `/task` do
 * for their own CLIs. `fix` creates the CI/CD remediation issue and then hands
 * it off to `/solve --development-log --deep-analysis --auto-merge` itself, so
 * this handler only has to validate the request and start the session.
 */

import { buildUserMention } from './buildUserMention.lib.mjs';
import { calculateLevenshteinDistance } from './option-suggestions.lib.mjs';
import { getLinoYargsFactory } from './cli-arguments.lib.mjs';
import { createYargsConfig as createSolveYargsConfig, detectMalformedFlags } from './solve.config.lib.mjs';
import { parseArgsWithYargs } from './telegram-solve-command.lib.mjs';
import { validateModelName } from './models/index.mjs';
import { parseFixRepository } from './fix.ci-cd.lib.mjs';
import { getModelFromArgs } from './model-args.lib.mjs';
import { escapeMarkdown } from './telegram-markdown.lib.mjs';
import { extractIsolationFromArgs, isValidPerCommandIsolation } from './telegram-isolation.lib.mjs';
import { mergeArgsWithOverrides } from './args-overrides.lib.mjs';
import { moveArgumentToFront, parseCommandArgs } from './telegram-solve-command.lib.mjs';
import { safeReply as defaultSafeReply } from './telegram-safe-reply.lib.mjs';
import { partitionFixArgs } from './fix.ci-cd.lib.mjs';
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

/**
 * Options `/fix` consumes itself; everything else is forwarded to `/solve` and
 * must therefore be a valid `solve` option.
 */
export const FIX_OWN_OPTIONS = Object.freeze(['--ci-cd', '--isolation', '--dry-run', '--no-solve', '--no-auto-solve', '--solve', '--help', '-h', '--version']);

/**
 * Reject a `/fix` request that contains any option `fix` or `solve` cannot act on.
 *
 * Issue #2166: a typo such as `--ci-de` used to be silently forwarded to
 * `solve.mjs` inside the spawned work session, where the failure was invisible
 * in the chat. `/fix` now fails immediately, in the same chat message, using the
 * very same checks `/solve` runs (`detectMalformedFlags` + solve's strict yargs
 * config), so no typo can slip through.
 *
 * @param {string[]} args - Arguments as produced by `buildFixCommandArgs().args`.
 * @returns {Promise<string|null>} Error message to show the user, or `null` when valid.
 */
export async function validateFixCommandOptions(args) {
  const list = Array.isArray(args) ? args : [];

  const { malformed, errors } = detectMalformedFlags(list);
  if (malformed.length > 0) return errors.join('\n');

  // `--ci-de` is closer to `/fix`'s own `--ci-cd` than to anything solve knows,
  // so check fix's own vocabulary first — otherwise the generic suggester points
  // at unrelated solve options.
  const partitioned = partitionFixArgs(list);
  for (const arg of partitioned.passthrough) {
    if (!arg.startsWith('-')) continue;
    const name = arg.split('=')[0];
    const closest = FIX_OWN_OPTIONS.map(option => ({ option, distance: calculateLevenshteinDistance(name, option) }))
      .filter(candidate => candidate.distance > 0 && candidate.distance <= 2)
      .sort((a, b) => a.distance - b.distance)[0];
    if (closest) return `Unknown option "${name}". Did you mean "${closest.option}"?`;
  }

  // solve requires a positional issue URL; a placeholder keeps the parser happy
  // so that only the *options* are judged here.
  const probeArgs = ['https://github.com/owner/repo/issues/1', ...partitioned.passthrough];
  try {
    await parseArgsWithYargs(probeArgs, getLinoYargsFactory(), createSolveYargsConfig);
  } catch (error) {
    return error?.message || String(error);
  }
  return null;
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
  const { VERBOSE, fixEnabled, addBreadcrumb, isOldMessage, isForwardedOrReply, isGroupChat, isTopicAuthorized, buildAuthErrorMessage, isChatStopped, getStoppedChatRejectMessage, safeReply = defaultSafeReply, executeAndUpdateMessage, resolveLocale = null, solveOverrides = [] } = options;

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
      await safeReply(ctx, '❌ The fix command is disabled on this bot instance.');
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
      await safeReply(ctx, `❌ The ${commandDisplay} command only works in group chats. Please add this bot to a group and make it an admin.`, { reply_to_message_id: ctx.message.message_id });
      return;
    }
    if (!isTopicAuthorized(ctx)) {
      await safeReply(ctx, buildAuthErrorMessage(ctx), { reply_to_message_id: ctx.message.message_id });
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

    // Issue #2166: fail immediately on any unsupported option, before a work
    // session is spawned, so a typo can never turn into a silent no-op. Runs
    // after --isolation extraction because that flag is consumed by /fix itself
    // and is not part of the solve vocabulary the probe parser validates.
    const optionsError = await validateFixCommandOptions(filteredArgs);
    if (optionsError) {
      await safeReply(ctx, `❌ Invalid options: ${escapeMarkdown(optionsError)}\n\nUse /help to see available options`, { reply_to_message_id: ctx.message.message_id });
      return;
    }

    // Issue #2085: /fix hands the generated issue off to /solve, so it must
    // apply the operator's solve overrides (TELEGRAM_SOLVE_OVERRIDES) exactly
    // like the /solve handler does — otherwise the solve started by /fix runs
    // without the operator's defaults (e.g. --attach-logs). The overrides are
    // forwarded to /solve because /fix passes every option it does not consume
    // through to solve.mjs. An --isolation override applies to the /fix work
    // session itself (which contains the nested /solve), mirroring /solve.
    const { backend: overrideIsolation, filteredArgs: solveOverridesWithoutIsolation } = extractIsolationFromArgs(solveOverrides);
    if (overrideIsolation && !isValidPerCommandIsolation(overrideIsolation)) {
      await safeReply(ctx, `❌ Invalid --isolation value '${escapeMarkdown(overrideIsolation)}' in solve overrides. Must be: screen, tmux, or docker`, { reply_to_message_id: ctx.message.message_id });
      return;
    }
    const effectiveIsolation = overrideIsolation || perCommandIsolation;
    const mergedArgs = mergeArgsWithOverrides(filteredArgs, solveOverridesWithoutIsolation);

    const modelError = validateFixModel(mergedArgs);
    if (modelError) {
      await safeReply(ctx, `❌ ${escapeMarkdown(modelError)}`, { reply_to_message_id: ctx.message.message_id });
      return;
    }

    const requester = buildUserMention({ user: ctx.from, parseMode: 'Markdown' });
    const userOptionsRaw = built.args.slice(1).join(' ');
    let infoBlock = `Requested by: ${requester}\nRepository: ${escapeMarkdown(built.repository.url)}`;
    if (userOptionsRaw) infoBlock += `\n\n🛠 Options: ${escapeMarkdown(userOptionsRaw)}`;
    if (solveOverrides.length > 0) infoBlock += `\n\n🔒 Solve overrides: ${escapeMarkdown(solveOverrides.join(' '))}`;

    const fixUrlContext = { owner: built.repository.owner, repo: built.repository.repo, normalized: built.repository.url };
    const startingMessage = await safeReply(ctx, formatStartingWorkSessionMessage({ infoBlock }), { reply_to_message_id: ctx.message.message_id });
    const fixLocale = resolveLocale ? resolveLocale(ctx) : null;
    const argsForExec = injectLanguageIfMissing(mergedArgs, fixLocale);
    await executeAndUpdateMessage(ctx, startingMessage, 'fix', argsForExec, infoBlock, effectiveIsolation || null, getFixToolFromArgs(argsForExec), fixUrlContext);
  }

  bot.command(
    FIX_COMMAND_NAMES.map(command => new RegExp(`^${command}$`, 'i')),
    handleFixCommand
  );

  return { handleFixCommand, FIX_COMMAND_NAMES };
}
