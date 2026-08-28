#!/usr/bin/env node
/**
 * Issue #2182 — reproduce the 4½-day auto-merge loop in a few milliseconds.
 *
 * The production run made 2693 monitoring checks over 4d 12h 13m 35s, each one
 * declaring "PR IS MERGEABLE!" and then failing the merge with
 * "GraphQL: Pull Request is still a draft (mergePullRequest)".
 *
 * The script has two parts, matching the two layers of the fix:
 *
 *   Part 1 — the root cause. A restart iteration drafts the pull request and
 *            the iteration ends. Before the fix the ready conversion was
 *            delegated to the AI ("use gh pr ready 142" in the prompt); in the
 *            production run the AI complied in session 1 and not in the restart
 *            session, so the PR stayed a draft. Modelled against the real
 *            pr-draft-state.lib.mjs with a fake `gh`.
 *
 *   Part 2 — the consequence. One monitoring check against a draft PR, with the
 *            pre-fix mergeability logic and the shipped one. The GitHub answers
 *            are the exact ones from the log: isDraft=true, mergeable=MERGEABLE,
 *            mergeStateStatus=CLEAN.
 *
 *   node experiments/issue-2182-draft-merge-loop.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2182
 * @see docs/case-studies/issue-2182/README.md
 */

import { classifyMergeError, evaluatePullRequestMergeability, MAX_CONSECUTIVE_MERGE_FAILURES } from '../src/merge-error-classification.lib.mjs';
import { ensurePullRequestIsDraft, ensurePullRequestIsReady, getOutstandingWorkingSessionDrafts, resetWorkingSessionDrafts, restorePullRequestsLeftInDraft } from '../src/pr-draft-state.lib.mjs';

const OWNER = 'link-foundation';
const REPO = 'js-ai-driven-development-pipeline-template';
const PR = 142;

const OBSERVED_CHECKS = 2693;
const OBSERVED_DURATION = '4d 12h 13m 35s'; // wall clock, from the issue title

/**
 * A fake `gh` that keeps the pull request's draft flag in memory and answers the
 * two commands pr-draft-state.lib.mjs issues: `gh pr view --json isDraft,state`
 * and `gh pr ready [--undo]`.
 */
const makeFakeGh = state => {
  const run = command => {
    if (command.includes('gh pr view')) {
      return { code: 0, stdout: JSON.stringify({ isDraft: state.isDraft, state: 'OPEN' }), stderr: '' };
    }
    if (command.includes('gh pr ready')) {
      state.isDraft = command.includes('--undo');
      state.conversions.push(state.isDraft ? 'draft' : 'ready');
      return { code: 0, stdout: '', stderr: '' };
    }
    throw new Error(`unexpected command: ${command}`);
  };
  return async (strings, ...values) => run(strings.reduce((acc, part, i) => acc + part + (i < values.length ? String(values[i]) : ''), ''));
};

const silent = async () => {};

console.log('Issue #2182 — the draft that was never converted back\n');

// ---------------------------------------------------------------------------
// Part 1 — the root cause: a working session that drafts and does not undraft
// ---------------------------------------------------------------------------

console.log('PART 1 — session lifecycle\n');

/** Pre-fix: executeToolIteration drafted the PR and had no counterpart. */
const runLegacyIteration = async state => {
  const $ = makeFakeGh(state);
  await ensurePullRequestIsDraft({ owner: OWNER, repo: REPO, prNumber: PR, $, log: silent, reason: 'restart iteration' });
  // ... the AI runs, fixes CI, pushes. The prompt asked it to run `gh pr ready 142`.
  // In the production run it did not (see docs/case-studies/issue-2182 log excerpt 08).
};

/** Post-fix: the ready conversion lives in a `finally`, so a throw cannot skip it. */
const runFixedIteration = async (state, { crash = false } = {}) => {
  const $ = makeFakeGh(state);
  await ensurePullRequestIsDraft({ owner: OWNER, repo: REPO, prNumber: PR, $, log: silent, reason: 'restart iteration' });
  try {
    if (crash) throw new Error('AI tool aborted (API error)');
  } finally {
    await ensurePullRequestIsReady({ owner: OWNER, repo: REPO, prNumber: PR, $, log: silent, reason: 'restart iteration finished' });
  }
};

resetWorkingSessionDrafts();
const legacyState = { isDraft: false, conversions: [] };
await runLegacyIteration(legacyState);
console.log('BEFORE  restart iteration ends normally');
console.log(`          conversions:        ${legacyState.conversions.join(' -> ')}`);
console.log(`          PR left as draft:   ${legacyState.isDraft}   <- unmergeable forever`);

resetWorkingSessionDrafts();
const fixedState = { isDraft: false, conversions: [] };
await runFixedIteration(fixedState);
console.log('AFTER   restart iteration ends normally');
console.log(`          conversions:        ${fixedState.conversions.join(' -> ')}`);
console.log(`          PR left as draft:   ${fixedState.isDraft}`);

resetWorkingSessionDrafts();
const crashState = { isDraft: false, conversions: [] };
let crashPropagated = false;
try {
  await runFixedIteration(crashState, { crash: true });
} catch {
  crashPropagated = true;
}
console.log('AFTER   restart iteration throws');
console.log(`          conversions:        ${crashState.conversions.join(' -> ')}`);
console.log(`          error propagated:   ${crashPropagated}`);
console.log(`          PR left as draft:   ${crashState.isDraft}`);

// The safety net: a session killed before its own ready conversion (CTRL+C, fatal
// error) is repaired from the module-level registry of outstanding drafts.
resetWorkingSessionDrafts();
const interruptState = { isDraft: false, conversions: [] };
const interrupt$ = makeFakeGh(interruptState);
await ensurePullRequestIsDraft({ owner: OWNER, repo: REPO, prNumber: PR, $: interrupt$, log: silent, reason: 'restart iteration' });
const outstanding = getOutstandingWorkingSessionDrafts().length;
await restorePullRequestsLeftInDraft({ $: interrupt$, log: silent, reason: 'session interrupted (CTRL+C)' });
console.log('AFTER   session interrupted (CTRL+C)');
console.log(`          outstanding drafts: ${outstanding} -> ${getOutstandingWorkingSessionDrafts().length}`);
console.log(`          PR left as draft:   ${interruptState.isDraft}`);
console.log('');

// ---------------------------------------------------------------------------
// Part 2 — the consequence: one monitoring check against a draft PR
// ---------------------------------------------------------------------------

// What `gh pr view 142 --json isDraft,mergeable,mergeStateStatus` answered on
// every one of the 2692 checks after the restart iteration drafted the PR.
const GITHUB_ANSWER = { isDraft: true, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' };
const MERGE_ERROR = `Command failed: gh pr merge ${PR} --repo ${OWNER}/${REPO} --merge\nGraphQL: Pull Request is still a draft (mergePullRequest)`;

/** The pre-fix mergeability verdict: the draft flag was never requested. */
const legacyMergeable = pr => pr.mergeable === 'MERGEABLE';

console.log('PART 2 — one monitoring check\n');
console.log('GitHub answers:', JSON.stringify(GITHUB_ANSWER));
console.log('');

console.log('BEFORE');
console.log(`          mergeable verdict:  ${legacyMergeable(GITHUB_ANSWER)}  <- "✅ PR IS MERGEABLE!"`);
console.log('          merge:              fails — Pull Request is still a draft');
console.log('          reaction:           "Will continue monitoring..."');
console.log(`          loop ends after:    never (observed: ${OBSERVED_CHECKS} checks over ${OBSERVED_DURATION})`);
console.log('');

const evaluation = evaluatePullRequestMergeability(GITHUB_ANSWER);
const classification = classifyMergeError(MERGE_ERROR);

console.log('AFTER');
console.log(`          mergeable verdict:  ${evaluation.mergeable} (isDraft=${evaluation.isDraft}, reason: ${evaluation.reason})`);
console.log('          blocker emitted:    draft');
console.log('          reaction:           mark the PR ready for review, re-check in 5s');
console.log(`          if the merge is still attempted and fails: category=${classification.category}, terminal=${classification.terminal}, recoverable=${classification.recoverable}`);
console.log(`          resolution hint:    ${classification.resolution}`);
console.log(`          loop ends after:    ${MAX_CONSECUTIVE_MERGE_FAILURES} consecutive failures, or the --auto-restart-until-mergeable-timeout-hours deadline`);
console.log('');

const reproduced = legacyState.isDraft === true && fixedState.isDraft === false && crashState.isDraft === false && interruptState.isDraft === false && legacyMergeable(GITHUB_ANSWER) === true && evaluation.mergeable === false;

console.log(reproduced ? '✅ Reproduced the old behaviour and confirmed the new one.' : '❌ Unexpected: the models disagree with the log.');
process.exit(reproduced ? 0 : 1);
