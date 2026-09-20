/**
 * Early validation of --solve-overrides / --hive-overrides for the Telegram bot.
 *
 * Extracted from src/telegram-bot.mjs, which had grown past the 1350-line
 * warning threshold that scripts/check-file-line-limits.sh enforces (issue
 * #1593, surfaced again by issue #2198). The solve and hive blocks were
 * near-identical copies of each other, so folding them into one parameterised
 * function removes the duplication as well as the lines.
 *
 * Behaviour is unchanged and pinned by tests/test-telegram-bot-dry-run.mjs and
 * tests/test-telegram-bot-configuration-isolation-links-notation.mjs, which
 * assert on the exact console output the caller prints.
 *
 * The function reports rather than exits: the caller owns the messages and the
 * exit code, which keeps this module testable in-process.
 */

import { enhanceUnknownArgumentError } from './option-suggestions.lib.mjs';
import { validateBranchInArgs } from './solve.branch.lib.mjs';
import { extractIsolationFromArgs, isValidPerCommandIsolation } from './telegram-isolation.lib.mjs';

/**
 * Parses `overrides` through the real yargs config of the target command, so an
 * unknown or malformed flag is rejected at bot startup rather than when the
 * first command spawns a session (issue #1209).
 *
 * @param {object} options
 * @param {string[]} options.overrides       Override arguments to validate.
 * @param {Function} options.createYargsConfig  The command's yargs config factory.
 * @param {Function} options.yargs           A yargs factory (bound to Links Notation).
 * @param {string} options.dummyUrl          Stand-in for the command's required positional.
 * @returns {Promise<{ok: true} | {ok: false, message: string}>}
 */
export const validateCommandOverrides = async ({ overrides, createYargsConfig, yargs, dummyUrl }) => {
  try {
    const { backend: overrideIsolation, filteredArgs } = extractIsolationFromArgs(overrides);
    if (overrideIsolation && !isValidPerCommandIsolation(overrideIsolation)) {
      throw new Error(`Invalid --isolation value '${overrideIsolation}'. Must be: screen, tmux, or docker`);
    }

    const testArgs = [dummyUrl, ...filteredArgs];

    // yargs writes its own diagnostics to stderr before the .fail() handler
    // runs; suppress them so the caller's single message is what the operator
    // sees.
    const originalStderrWrite = process.stderr.write;
    process.stderr.write = () => true;

    try {
      // .parse() rather than parseSync() so .strict() mode is honoured.
      const testYargs = createYargsConfig(yargs());
      testYargs
        .exitProcess(false)
        .showHelpOnFail(false)
        .fail((msg, err) => {
          if (err) throw err;
          throw new Error(msg);
        });
      await testYargs.parse(testArgs);

      // Issue #1482: --base-branch inside the overrides is validated too.
      const overrideBranchError = validateBranchInArgs(filteredArgs);
      if (overrideBranchError) throw new Error(overrideBranchError);
    } finally {
      process.stderr.write = originalStderrWrite;
    }

    return { ok: true };
  } catch (error) {
    const enhancedError = enhanceUnknownArgumentError(error, createYargsConfig(yargs()));
    return { ok: false, message: enhancedError.message || String(enhancedError) };
  }
};
