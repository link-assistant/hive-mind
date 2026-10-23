/**
 * Which of the user's original `solve` options a relaunched `solve` keeps
 * (issue #3190).
 *
 * The auto-resume/auto-restart relaunch used to rebuild its argv from a short
 * allowlist (--tool/--model/--fallback-model/--verbose/--fork/--attach-logs),
 * so `--auto-merge`, `--think`, `--language`, `--disable-report-issue`,
 * `--no-tool-check` and every other option were silently lost on resume. Both
 * helpers below instead replay every original option, removing only the ones
 * the caller sets itself.
 */

import { forwardRawCliArgs } from './cli-option-forwarding.lib.mjs';
import { normalizeCliArgs } from './argument-normalization.lib.mjs';
import { SOLVE_OPTION_DEFINITIONS } from './solve.config.lib.mjs';

/**
 * All options solve's yargs knows about. `model` (and `help`) are registered
 * inline in createYargsConfig, so they are added here to be recognized —
 * otherwise `--model opus` would be treated as an unknown flag followed by a
 * positional.
 */
export const SOLVE_CLI_OPTION_DEFINITIONS = Object.freeze({
  ...SOLVE_OPTION_DEFINITIONS,
  model: { type: 'string', alias: ['m', 'worker-model'] },
  help: { type: 'boolean', alias: 'h' },
});

/**
 * Options that only describe ONE process's place in a relaunch chain. They are
 * never replayed verbatim: the relaunch re-adds the fresh values.
 */
export const SOLVE_RELAUNCH_STATE_OPTIONS = Object.freeze(['resume', 'working-directory', 'session-type', 'recovery-attempt', 'auto-resume-iteration', 'previous-anthropic-cost', 'help']);

/**
 * Options `autoContinueWhenLimitResets` sets itself from the live argv (the
 * model may have switched to a fallback mid-run, attach-logs is resolved at
 * runtime, ...). Everything else is replayed from the original command line.
 */
export const SOLVE_AUTO_RELAUNCH_CONTROLLED_OPTIONS = Object.freeze([...SOLVE_RELAUNCH_STATE_OPTIONS, 'auto-continue', 'auto-resume-on-limit-reset', 'auto-restart-on-limit-reset', 'auto-resume-max-iterations', 'tool', 'model', 'fallback-model', 'verbose', 'fork', 'attach-logs']);

/**
 * Options `buildSolveResumeCommand` already prints itself.
 */
export const SOLVE_MANUAL_RESUME_CONTROLLED_OPTIONS = Object.freeze([...SOLVE_RELAUNCH_STATE_OPTIONS, 'tool', 'model', 'fallback-model']);

/**
 * The user's original solve options (no positional URL), minus `exclude`.
 *
 * @param {Object} [params]
 * @param {string[]} [params.rawArgs] - CLI tokens after `node solve` (defaults to this process)
 * @param {Iterable<string>} [params.exclude]
 * @returns {string[]}
 */
export const getPreservedSolveCliArgs = ({ rawArgs = process.argv.slice(2), exclude = SOLVE_AUTO_RELAUNCH_CONTROLLED_OPTIONS } = {}) => forwardRawCliArgs({ rawArgs: normalizeCliArgs(rawArgs), definitions: SOLVE_CLI_OPTION_DEFINITIONS, exclude });

/**
 * Options the printed manual-resume command appends after the ones
 * `buildSolveResumeCommand` sets itself.
 *
 * @param {string[]} [rawArgs]
 * @returns {string[]}
 */
export const getManualResumeSolveCliArgs = (rawArgs = process.argv.slice(2)) => getPreservedSolveCliArgs({ rawArgs, exclude: SOLVE_MANUAL_RESUME_CONTROLLED_OPTIONS });
