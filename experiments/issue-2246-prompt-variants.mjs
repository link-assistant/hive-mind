/**
 * Prompt-writing analysis for issue #2246.
 *
 * This catalogue deliberately lives outside src/: comparing and sorting candidate
 * wording is useful during development, but production prompt rendering should be a
 * direct, reviewable mode branch with no selection work at runtime.
 */

export const REQUIRED_FACTS = ['states', 'ownership', 'noChange'];

const facts = (...covered) => Object.fromEntries(['ci', 'unrelated', ...REQUIRED_FACTS].map(fact => [fact, covered.includes(fact)]));

/** @type {Array<{id: string, style: string, note: string, covers: Object, text: string}>} */
export const PULL_REQUEST_LIFECYCLE_PROMPT_VARIANTS = [
  {
    id: 'explicit',
    style: 'when-clause',
    note: 'First version shipped in #2248. Complete, but repeats the universal CI rule.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'When you finish implementation, do not change the pull request state: the Hive Mind system owns the draft, ready for review and ready to merge states, and your goal is a mergeable pull request, so all CI/CD checks must pass, even ones that look unrelated to the issue.',
  },
  {
    id: 'review-suggestion',
    style: 'when-clause',
    note: 'Proposed in review. Reads well, but omits unrelated checks and ready to merge.',
    covers: facts('ci', 'ownership', 'noChange'),
    text: 'When you finish implementation, check CI/CD status, it should pass, comments, be aware that the Hive Mind system owns the pull request ready/draft status, so no need to change it.',
  },
  {
    id: 'goal-first',
    style: 'when-clause',
    note: 'Leads with the goal, but omits the ready-to-merge state.',
    covers: facts('ci', 'unrelated', 'ownership', 'noChange'),
    text: 'When you finish implementation, make every CI/CD check pass, even unrelated ones; the Hive Mind system owns the draft and ready states, so do not change them.',
  },
  {
    id: 'mergeable-goal',
    style: 'imperative',
    note: 'Names the mergeable goal explicitly, but repeats the universal CI rule.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'Your goal is a mergeable pull request: every CI/CD check must pass, even unrelated ones, and the Hive Mind system owns the draft, ready and ready to merge states, so do not change them.',
  },
  {
    id: 'ownership-first',
    style: 'imperative',
    note: 'Ownership first, work second.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'The Hive Mind system owns the draft, ready and ready to merge states, so do not change them; make every CI/CD check pass, even unrelated ones.',
  },
  {
    id: 'two-sentences',
    style: 'imperative',
    note: 'Two short sentences, but omits the ready-to-merge state.',
    covers: facts('ci', 'unrelated', 'ownership', 'noChange'),
    text: 'Fix every failing CI/CD check, even unrelated ones. The Hive Mind system owns the draft and ready states, do not change them.',
  },
  {
    id: 'telegraphic',
    style: 'imperative',
    note: 'Compact headline style, unlike the surrounding list.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'Goal: a mergeable pull request, every CI/CD check green, even unrelated ones; draft, ready and ready to merge are the Hive Mind system to set, not you.',
  },
  {
    id: 'delegated',
    style: 'imperative',
    note: 'Concise delegation, but repeats the universal CI rule.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'Make all CI/CD checks pass, even unrelated ones, and leave the draft, ready and ready to merge states to the Hive Mind system.',
  },
  {
    id: 'delegated-when',
    style: 'when-clause',
    note: 'Previously active; concise before CI became an unconditional separate rule.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'When you finish implementation, make all CI/CD checks pass, even unrelated ones, and leave the draft, ready and ready to merge states to the Hive Mind system.',
  },
  {
    id: 'not-you',
    style: 'imperative',
    note: 'Short and complete, but blunt.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'Make all CI/CD checks pass, even unrelated ones; the Hive Mind system sets draft, ready and ready to merge, not you.',
  },
  {
    id: 'slash-states',
    style: 'imperative',
    note: 'Compresses the state names but loses ready to merge.',
    covers: facts('ci', 'unrelated', 'ownership', 'noChange'),
    text: 'Make all CI/CD checks pass, even unrelated ones; the Hive Mind system owns draft/ready, do not change it.',
  },
  {
    id: 'minimal',
    style: 'imperative',
    note: 'Only the CI half, now covered by the universal finalize rule.',
    covers: facts('ci', 'unrelated'),
    text: 'Make all CI/CD checks pass, even ones that look unrelated to the issue.',
  },
  {
    id: 'ownership-only',
    style: 'imperative',
    note: 'The lifecycle half on its own, but not in the surrounding when-clause voice.',
    covers: facts('states', 'ownership', 'noChange'),
    text: 'The Hive Mind system owns the draft, ready and ready to merge states of the pull request, do not change them.',
  },
  {
    id: 'no-need',
    style: 'when-clause',
    note: 'Softer wording, but repeats the universal CI rule.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'When you finish implementation, make all CI/CD checks pass, even unrelated ones; the Hive Mind system sets draft, ready and ready to merge, so there is no need to touch them.',
  },
  {
    id: 'owner-parenthetical',
    style: 'when-clause',
    note: 'One subject, but repeats the universal CI rule.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'When you finish implementation, make all CI/CD checks pass, even unrelated ones (the draft, ready and ready to merge states are set by the Hive Mind system, not by you).',
  },
  {
    id: 'until-mergeable',
    style: 'when-clause',
    note: 'Explains implementation details the worker does not need.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'When you finish implementation, keep fixing CI/CD until every check passes, even unrelated ones: the Hive Mind system restarts you until then and owns the draft, ready and ready to merge states, so do not change them.',
  },
  {
    id: 'warning',
    style: 'imperative',
    note: 'Motivation belongs in the human-facing status notice.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'Taking the pull request out of draft invites a human to merge unfinished work, so leave the draft, ready and ready to merge states to the Hive Mind system and make all CI/CD checks pass, even unrelated ones.',
  },
  {
    id: 'checklist',
    style: 'imperative',
    note: 'Easy to skim, but robotic and repeats the universal CI rule.',
    covers: facts('ci', 'unrelated', 'states', 'ownership', 'noChange'),
    text: 'Your job: all CI/CD checks passing, even unrelated ones. The Hive Mind system: the draft, ready and ready to merge states. Do not do its job.',
  },
  {
    id: 'state-delegated-when',
    style: 'when-clause',
    note: 'ACTIVE. Only the mode-dependent lifecycle rule; CI remains universal.',
    covers: facts('states', 'ownership', 'noChange'),
    text: 'When you finish implementation, leave the draft, ready for review, and ready to merge states to the Hive Mind system.',
  },
  {
    id: 'legacy',
    style: 'when-clause',
    note: 'The single-pass line, where Hive Mind has no monitoring loop to own readiness.',
    covers: facts(),
    text: 'When you finish implementation, use gh pr ready {{prNumber}}{{repoSuffix}}.',
  },
];

export const isVariantComplete = variant => REQUIRED_FACTS.every(fact => variant.covers[fact]);

export const selectActiveVariantId = () =>
  PULL_REQUEST_LIFECYCLE_PROMPT_VARIANTS.filter(variant => isVariantComplete(variant) && variant.style === 'when-clause')
    .sort((a, b) => a.text.length - b.text.length || a.id.localeCompare(b.id))
    .map(variant => variant.id)[0];

export const ACTIVE_VARIANT_ID = 'state-delegated-when';
export const SINGLE_PASS_VARIANT_ID = 'legacy';
