/**
 * Telegram `/fix` command (issue #1733).
 *
 * Spawns the `fix` CLI in a work session, exactly like `/solve` and `/task` do
 * for their own CLIs. `fix` creates the issue for the requested mode (`--ci-cd`
 * or `--update-all-dependencies`, issue #2184) and then hands it off to
 * `/solve --development-log --deep-analysis --auto-merge` itself, so this
 * handler only has to validate the request and start the session.
 */

import { registerRepositoryTaskCommand } from './telegram-repository-task-command.lib.mjs';
export { getRepositoryTaskToolFromArgs as getFixToolFromArgs } from './telegram-repository-task-command.lib.mjs';

import { calculateLevenshteinDistance } from './option-suggestions.lib.mjs';
import { getLinoYargsFactory } from './cli-arguments.lib.mjs';
import { createYargsConfig as createSolveYargsConfig, detectMalformedFlags } from './solve.config.lib.mjs';
import { parseArgsWithYargs } from './telegram-solve-command.lib.mjs';
import { FIX_MODES, parseFixRepository } from './fix.args.lib.mjs';
import { parseTelegramCommandPrefix } from './telegram-command-text.lib.mjs';
import { moveArgumentToFront, parseCommandArgs } from './telegram-solve-command.lib.mjs';
import { partitionFixArgs } from './fix.args.lib.mjs';

export const FIX_COMMAND_NAMES = Object.freeze(['fix']);

export function getFixCommandNameFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const firstLine = text.split('\n')[0].trim();
  const command = parseTelegramCommandPrefix(firstLine)?.command || null;
  return FIX_COMMAND_NAMES.includes(command) ? command : null;
}

/**
 * `fix` requires a mode and `--ci-cd` was the only one for its first release,
 * so the chat command keeps implying it rather than making every user type it.
 * Any explicitly requested mode (e.g. `--update-all-dependencies`) wins: adding
 * `--ci-cd` on top would make the CLI reject the request as two modes at once.
 */
export function applyFixCommandDefaults(args) {
  const hasMode = FIX_MODES.some(mode => args.includes(mode.flag));
  return hasMode ? args : [...args, '--ci-cd'];
}

export function findFixRepositoryArg(args) {
  return args.find(arg => !arg.startsWith('-') && parseFixRepository(arg)) || null;
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
export const FIX_OWN_OPTIONS = Object.freeze([...FIX_MODES.map(mode => mode.flag), '--isolation', '--dry-run', '--no-solve', '--no-auto-solve', '--solve', '--help', '-h', '--version']);

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

export function registerFixCommand(bot, options) {
  const { handleRepositoryCommand } = registerRepositoryTaskCommand(bot, {
    ...options,
    enabled: options.fixEnabled,
    commandName: 'fix',
    commandNames: FIX_COMMAND_NAMES,
    buildCommandArgs: buildFixCommandArgs,
    validateCommandOptions: validateFixCommandOptions,
  });
  return { handleFixCommand: handleRepositoryCommand, FIX_COMMAND_NAMES };
}
