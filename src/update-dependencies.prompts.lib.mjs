/**
 * `--update-all-dependencies` sub-prompt module (issue #2184).
 *
 * `/fix --update-all-dependencies` writes the standard dependency-update
 * prompt into a generated issue. `/solve --update-all-dependencies` (and, by
 * passthrough, `/hive` and the Telegram bot) injects the same instructions
 * directly into the AI prompt, so any issue can be solved with "and bring every
 * dependency up to date" attached.
 *
 * The paragraph texts are imported rather than restated: one wording, one place
 * to change it, and no drift between the issue body and the prompt.
 *
 * Disabled by default — dependency updates are deliberate work, not something
 * every run should start doing on its own.
 */

import { KEEP_WORKING_PROMPT } from './solve.keep-working.detect.lib.mjs';
import { buildStandardPromptParagraphs } from './fix.update-dependencies.lib.mjs';

/**
 * `/solve` options whose own prompts already carry a paragraph of the standard
 * prompt, keyed the same way `/fix` keys them.
 */
const OPTION_ARGV_KEYS = Object.freeze({
  '--deep-analysis': 'deepAnalysis',
  '--development-log': 'developmentLog',
});

const isOptionEnabled = (argv, option) => {
  const key = OPTION_ARGV_KEYS[option];
  return Boolean(key && argv && argv[key]);
};

/**
 * Build the dependency-update sub-prompt content.
 *
 * @param {Object} [options]
 * @param {string[]} [options.omittedOptions] `/solve` options that already
 *   provide some of the paragraphs, so those paragraphs are not repeated.
 * @returns {string} The formatted sub-prompt.
 */
export const buildUpdateAllDependenciesSubPrompt = ({ omittedOptions = [] } = {}) => {
  const omitted = new Set(omittedOptions);
  const bullets = buildStandardPromptParagraphs()
    // /solve always emits KEEP_WORKING_PROMPT itself; repeating it here would
    // only spend context.
    .filter(paragraph => paragraph.text !== KEEP_WORKING_PROMPT)
    .filter(paragraph => paragraph.providedBy.length === 0 || !paragraph.providedBy.every(option => omitted.has(option)))
    .map(paragraph => `   - ${paragraph.text}`)
    .join('\n');

  return `

Dependency updates (--update-all-dependencies).
   - This run must also bring every dependency of this repository up to date, in every language and package manager it uses, in the same pull request as the work you were asked to do.
${bullets}
   - When the dependency update turns out to be large enough to risk the original task, finish the original task first, commit it, and then do the update — but do not end the session with the update unstarted.`;
};

/**
 * Get the dependency-update sub-prompt if `--update-all-dependencies` is set.
 *
 * @param {Object} argv - Command line arguments
 * @returns {string} The sub-prompt content, or an empty string when disabled
 */
export const getUpdateAllDependenciesSubPrompt = argv => {
  if (!argv || !argv.updateAllDependencies) return '';
  const omittedOptions = Object.keys(OPTION_ARGV_KEYS).filter(option => isOptionEnabled(argv, option));
  return buildUpdateAllDependenciesSubPrompt({ omittedOptions });
};

export default {
  buildUpdateAllDependenciesSubPrompt,
  getUpdateAllDependenciesSubPrompt,
};
