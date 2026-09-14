/**
 * Pull request lifecycle sub-prompt: the one line every tool prompt ends its
 * "Preparing pull request" section with.
 *
 * Issue #2246: that line used to be "When you finish implementation, use gh pr ready
 * <number>." — it made the AI worker take the pull request out of draft the moment it
 * *thought* it was done, before CI/CD had said anything. That is exactly the state in
 * which https://github.com/Time0utXC/digitalstructures.pro/pull/4 was merged by a human
 * while the AI was still working (0 checks, body still "Work in Progress").
 *
 * ## Why the line depends on the mode
 *
 * Only a mergeable mode (`--auto-restart-until-mergeable`, `--auto-merge`) keeps working
 * after the AI session ends, and only that mode holds the pull request in draft until the
 * ready-to-merge state is verified (the ready hold in pr-draft-state.lib.mjs). With
 * `--no-auto-restart-until-mergeable` there is no monitoring loop and no hold: the session
 * ending *is* the end of the work, so the previous line stays as it was (review feedback
 * on #2248). The mode-dependent part is built here, once, for all six tool prompts.
 *
 * ## Why this is in the system prompt and not the user prompt
 *
 * The line must hold on every turn, and a system prompt is the cheaper place for that:
 * `--append-system-prompt` sends exactly one copy per CLI invocation (src/claude.lib.mjs),
 * while a `-p` prompt is appended to the conversation and re-read from the transcript on
 * every `--resume`, so a rule repeated per session accumulates instead of being replaced.
 * It also *replaces* a line that was already in the system prompt, so the section does not
 * grow. The mode of the run is a fact about the run, not about the turn — the human-facing
 * half of it lives in pr-readiness-policy.lib.mjs and goes into the pull request body and
 * the work-session comments, not into the prompt.
 *
 * ## Why there is a catalogue
 *
 * Review feedback on #2248 asked for "at least 10-20 options… find the most compact
 * version, and use it, yet keep other options, so we can rethink it better later". They
 * are all below with their coverage flags; {@link ACTIVE_VARIANT_ID} names the one in use
 * and {@link selectActiveVariantId} states the rule that picks it, so swapping the active
 * line later is a one-token change with a test behind it.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2246
 */

import { isMergeableModeActive } from './pr-readiness-policy.lib.mjs';

/** Indentation of one item of the "Preparing pull request" list. */
const ITEM_PREFIX = '   - ';

/**
 * What a candidate line has to say for it to be usable, straight from issue #2246:
 *
 * - `ci`        — all CI/CD checks must pass,
 * - `unrelated` — including the ones that look unrelated to the issue,
 * - `states`    — names the states hive-mind owns, the ready-to-merge one included,
 * - `ownership` — says the Hive Mind system is what owns them,
 * - `noChange`  — and that the AI worker therefore does not change them.
 *
 * A variant that misses one is kept anyway (it may read better, and the missing fact may
 * turn out to be covered elsewhere), it just cannot become the active one.
 */
export const REQUIRED_FACTS = ['ci', 'unrelated', 'states', 'ownership', 'noChange'];

const facts = (...covered) => Object.fromEntries(REQUIRED_FACTS.map(fact => [fact, covered.includes(fact)]));

/**
 * Candidate phrasings for the mergeable-mode line, shortest last-ish.
 *
 * `style: 'when-clause'` matches the rest of the list ("When you …, do …"), which is the
 * form every other rule in these prompts uses; `style: 'imperative'` drops it to save
 * ~30 characters. `covers` is asserted against the text itself by
 * tests/pr-stays-draft-until-mergeable-2246.test.mjs, so the flags cannot drift.
 *
 * @type {Array<{id: string, style: string, note: string, covers: Object, text: string}>}
 */
export const PULL_REQUEST_LIFECYCLE_PROMPT_VARIANTS = [
  {
    id: 'explicit',
    style: 'when-clause',
    note: 'First version shipped in #2248. Says everything, twice as long as it needs to be.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'When you finish implementation, do not change the pull request state: the Hive Mind system owns the draft, ready for review and ready to merge states, and your goal is a mergeable pull request, so all CI/CD checks must pass, even ones that look unrelated to the issue.',
  },
  {
    id: 'review-suggestion',
    style: 'when-clause',
    note: 'Proposed in review of #2248. Reads well, but never says that unrelated checks count too.',
    covers: facts('ci', 'ownership', 'noChange'),
    text: 'When you finish implementation, check CI/CD status, it should pass, comments, be aware that the Hive Mind system owns the pull request ready/draft status, so no need to change it.',
  },
  {
    id: 'goal-first',
    style: 'when-clause',
    note: 'Leads with the goal. Omits the ready-to-merge state.',
    covers: facts('ci', 'unrelated', 'ownership', 'noChange'),
    text: 'When you finish implementation, make every CI/CD check pass, even unrelated ones; the Hive Mind system owns the draft and ready states, so do not change them.',
  },
  {
    id: 'mergeable-goal',
    style: 'imperative',
    note: 'Names the goal ("a mergeable pull request") explicitly, which is the word the docs use.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'Your goal is a mergeable pull request: every CI/CD check must pass, even unrelated ones, and the Hive Mind system owns the draft, ready and ready to merge states, so do not change them.',
  },
  {
    id: 'ownership-first',
    style: 'imperative',
    note: 'Ownership first, work second. Buries the part the AI actually has to act on.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'The Hive Mind system owns the draft, ready and ready to merge states, so do not change them; make every CI/CD check pass, even unrelated ones.',
  },
  {
    id: 'two-sentences',
    style: 'imperative',
    note: 'Two short sentences instead of one long one. Omits the ready-to-merge state.',
    covers: facts('ci', 'unrelated', 'ownership', 'noChange'),
    text: 'Fix every failing CI/CD check, even unrelated ones. The Hive Mind system owns the draft and ready states, do not change them.',
  },
  {
    id: 'telegraphic',
    style: 'imperative',
    note: 'Headline style. Cheapest readable form, but does not match the voice of the list.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'Goal: a mergeable pull request, every CI/CD check green, even unrelated ones; draft, ready and ready to merge are the Hive Mind system to set, not you.',
  },
  {
    id: 'delegated',
    style: 'imperative',
    note: 'States ownership as a delegation ("leave … to"), which covers "do not change it" in three words.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'Make all CI/CD checks pass, even unrelated ones, and leave the draft, ready and ready to merge states to the Hive Mind system.',
  },
  {
    id: 'delegated-when',
    style: 'when-clause',
    note: 'ACTIVE. The delegated phrasing in the voice of the surrounding list.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'When you finish implementation, make all CI/CD checks pass, even unrelated ones, and leave the draft, ready and ready to merge states to the Hive Mind system.',
  },
  {
    id: 'not-you',
    style: 'imperative',
    note: 'Shortest complete phrasing found. "not you" is blunt enough to be worth keeping in reserve.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'Make all CI/CD checks pass, even unrelated ones; the Hive Mind system sets draft, ready and ready to merge, not you.',
  },
  {
    id: 'slash-states',
    style: 'imperative',
    note: 'Compresses the state names into a slash list. Loses the ready-to-merge state.',
    covers: facts('ci', 'unrelated', 'ownership', 'noChange'),
    text: 'Make all CI/CD checks pass, even unrelated ones; the Hive Mind system owns draft/ready, do not change it.',
  },
  {
    id: 'minimal',
    style: 'imperative',
    note: 'The floor: the two facts that cannot be dropped. Ownership is implied, never stated.',
    covers: facts('ci', 'unrelated'),
    text: 'Make all CI/CD checks pass, even ones that look unrelated to the issue.',
  },
  {
    id: 'ownership-only',
    style: 'imperative',
    note: 'The other half on its own — useful if the CI/CD demand ever moves to the user prompt.',
    covers: facts('states', 'ownership', 'noChange'),
    text: 'The Hive Mind system owns the draft, ready and ready to merge states of the pull request, do not change them.',
  },
  {
    id: 'no-need',
    style: 'when-clause',
    note: 'Softer "no need to" instead of "do not". Same length class as the active line.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'When you finish implementation, make all CI/CD checks pass, even unrelated ones; the Hive Mind system sets draft, ready and ready to merge, so there is no need to touch them.',
  },
  {
    id: 'owner-parenthetical',
    style: 'when-clause',
    note: 'Ownership as a parenthetical aside, so the sentence keeps one subject.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'When you finish implementation, make all CI/CD checks pass, even unrelated ones (the draft, ready and ready to merge states are set by the Hive Mind system, not by you).',
  },
  {
    id: 'until-mergeable',
    style: 'when-clause',
    note: 'Explains the monitoring loop. The AI does not need to know how hive-mind works, only what it owns.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'When you finish implementation, keep fixing CI/CD until every check passes, even unrelated ones: the Hive Mind system restarts you until then and owns the draft, ready and ready to merge states, so do not change them.',
  },
  {
    id: 'warning',
    style: 'imperative',
    note: 'Says why. Motivation is expensive per turn and belongs in the docs the human reads.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'Taking the pull request out of draft invites a human to merge unfinished work, so leave the draft, ready and ready to merge states to the Hive Mind system and make all CI/CD checks pass, even unrelated ones.',
  },
  {
    id: 'checklist',
    style: 'imperative',
    note: 'Two labelled clauses. Easy to skim, a little robotic.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'Your job: all CI/CD checks passing, even unrelated ones. The Hive Mind system: the draft, ready and ready to merge states. Do not do its job.',
  },
  {
    id: 'legacy',
    style: 'when-clause',
    note: 'The pre-#2246 line, kept for the single-pass mode and for comparison.',
    covers: facts(),
    text: 'When you finish implementation, use gh pr ready {{prNumber}}{{repoSuffix}}.',
  },
];

const variantById = new Map(PULL_REQUEST_LIFECYCLE_PROMPT_VARIANTS.map(variant => [variant.id, variant]));

/** Does a variant state every fact issue #2246 asked the prompts to state? */
export const isVariantComplete = variant => REQUIRED_FACTS.every(fact => variant.covers[fact]);

/**
 * The selection rule, as code so the test can re-run it: the shortest complete variant
 * that still reads like the rest of the list. Compactness is the goal (the system prompt
 * is paid for on every conversation turn), completeness is the constraint, and the
 * when-clause style is what keeps the section readable as one set of rules.
 *
 * @returns {string} variant id
 */
export const selectActiveVariantId = () =>
  PULL_REQUEST_LIFECYCLE_PROMPT_VARIANTS.filter(variant => isVariantComplete(variant) && variant.style === 'when-clause')
    .sort((a, b) => a.text.length - b.text.length || a.id.localeCompare(b.id))
    .map(variant => variant.id)[0];

/** The variant rendered into the tool prompts. Kept literal on purpose: the prompts must be reviewable. */
export const ACTIVE_VARIANT_ID = 'delegated-when';

/** The variant used when hive-mind will not keep working after the session (`--no-auto-restart-until-mergeable`). */
export const SINGLE_PASS_VARIANT_ID = 'legacy';

const render = (text, { prNumber, repoSuffix }) => text.replace('{{prNumber}}', prNumber ?? '').replace('{{repoSuffix}}', repoSuffix ?? '');

/**
 * The pull request lifecycle instruction, formatted as one item of the
 * "Preparing pull request" list (no trailing newline).
 *
 * @param {Object} [options]
 * @param {Object} [options.argv] - Parsed command line arguments; decides the mode
 * @param {number|string} [options.prNumber] - Only used by the single-pass line
 * @param {string} [options.repoSuffix=''] - e.g. ` --repo owner/repo` for tools that need it
 * @param {string} [options.variantId] - Force a variant (tests, experiments)
 * @returns {string}
 */
export const getPullRequestLifecycleSubPrompt = ({ argv, prNumber, repoSuffix = '', variantId } = {}) => {
  const id = variantId || (isMergeableModeActive(argv) ? ACTIVE_VARIANT_ID : SINGLE_PASS_VARIANT_ID);
  const variant = variantById.get(id);
  if (!variant) {
    throw new Error(`Unknown pull request lifecycle prompt variant: ${id}`);
  }
  return `${ITEM_PREFIX}${render(variant.text, { prNumber, repoSuffix })}`;
};

/**
 * The "check that all CI checks are passing if they exist before you finish," item of the
 * "When you finalize the pull request:" checklist.
 *
 * Returned with its leading newline so the caller can append it to the previous item, and
 * empty in a mergeable mode: there the lifecycle line above already demands that *every*
 * CI/CD check pass, unrelated ones included, and saying it twice in the same section is
 * both weaker and paid for on every conversation turn (review feedback on #2248).
 *
 * @param {Object} [argv] - Parsed command line arguments
 * @returns {string}
 */
export const getFinalizeCiChecksSubPrompt = argv => (isMergeableModeActive(argv) ? '' : '\n      check that all CI checks are passing if they exist before you finish,');

export default {
  ACTIVE_VARIANT_ID,
  PULL_REQUEST_LIFECYCLE_PROMPT_VARIANTS,
  REQUIRED_FACTS,
  SINGLE_PASS_VARIANT_ID,
  getFinalizeCiChecksSubPrompt,
  getPullRequestLifecycleSubPrompt,
  isVariantComplete,
  selectActiveVariantId,
};
