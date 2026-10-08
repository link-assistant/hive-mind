/** Telegram entry point for documentation-driven manual testing. */
import { TEST_OWN_OPTIONS, partitionTestArgs } from './test.lib.mjs';
import { parseFixRepository } from './fix.args.lib.mjs';
import { moveArgumentToFront, parseCommandArgs, parseArgsWithYargs } from './telegram-solve-command.lib.mjs';
import { registerRepositoryTaskCommand } from './telegram-repository-task-command.lib.mjs';
import { getLinoYargsFactory } from './cli-arguments.lib.mjs';
import { createYargsConfig as createSolveYargsConfig, detectMalformedFlags } from './solve.config.lib.mjs';

export function buildTestCommandArgs(text) {
  const args = parseCommandArgs(text);
  const repositoryRaw = args.find(arg => !arg.startsWith('-') && parseFixRepository(arg)) || null;
  const repository = repositoryRaw ? parseFixRepository(repositoryRaw) : null;
  return {
    args: repository ? moveArgumentToFront(args, repository.url, value => parseFixRepository(value)?.url || value) : args,
    repositoryRaw,
    repository,
  };
}

export async function validateTestCommandOptions(args) {
  const { malformed, errors } = detectMalformedFlags(args);
  if (malformed.length) return errors.join('\n');
  const parsed = partitionTestArgs(args);
  try {
    await parseArgsWithYargs(['https://github.com/owner/repo/issues/1', ...parsed.passthrough], getLinoYargsFactory(), createSolveYargsConfig);
  } catch (error) {
    return error?.message || String(error);
  }
  // Command-owned flags are only accepted as standalone booleans, avoiding
  // ambiguous forwarding such as --dry-run=false to the nested solve.
  const valuedBoolean = args.find(arg => TEST_OWN_OPTIONS.includes(arg.split('=')[0]) && arg.includes('='));
  return valuedBoolean ? `Use ${valuedBoolean.split('=')[0]} without a value.` : null;
}

export function registerTestCommand(bot, options) {
  const { handleRepositoryCommand } = registerRepositoryTaskCommand(bot, {
    ...options,
    enabled: options.testEnabled,
    commandName: 'test',
    executionCommand: 'hive-test',
    buildCommandArgs: buildTestCommandArgs,
    validateCommandOptions: validateTestCommandOptions,
  });
  return { handleTestCommand: handleRepositoryCommand };
}
