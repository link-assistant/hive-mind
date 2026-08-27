#!/usr/bin/env node
/**
 * Issue #2182 — reproduce the 4½-day auto-merge loop in a few milliseconds.
 *
 * The production run made 2693 monitoring checks over 4d 12h 13m 35s, each one
 * declaring "PR IS MERGEABLE!" and then failing the merge with
 * "GraphQL: Pull Request is still a draft (mergePullRequest)".
 *
 * This script models one monitoring check twice: once with the pre-fix logic
 * (mergeability derived from `mergeable === 'MERGEABLE'`, every failure
 * retried) and once with the shipped logic. The GitHub answers are the exact
 * ones from the log: isDraft=true, mergeable=MERGEABLE, mergeStateStatus=CLEAN.
 *
 *   node experiments/issue-2182-draft-merge-loop.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2182
 */

import { classifyMergeError, evaluatePullRequestMergeability, MAX_CONSECUTIVE_MERGE_FAILURES } from '../src/merge-error-classification.lib.mjs';

// What `gh pr view 142 --json isDraft,mergeable,mergeStateStatus` answered on
// every one of the 2692 checks after the restart iteration drafted the PR.
const GITHUB_ANSWER = { isDraft: true, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' };
const MERGE_ERROR = 'Command failed: gh pr merge 142 --repo link-foundation/js-ai-driven-development-pipeline-template --merge\nGraphQL: Pull Request is still a draft (mergePullRequest)';

const OBSERVED_CHECKS = 2693;
const OBSERVED_DURATION = '4d 12h 13m 35s'; // wall clock, from the issue title

/** The pre-fix mergeability verdict: the draft flag was never requested. */
const legacyMergeable = pr => pr.mergeable === 'MERGEABLE';

console.log('Issue #2182 — one monitoring check, before and after\n');

console.log('GitHub answers:', JSON.stringify(GITHUB_ANSWER));
console.log('');

console.log('BEFORE');
console.log(`  mergeable verdict:     ${legacyMergeable(GITHUB_ANSWER)}  <- "✅ PR IS MERGEABLE!"`);
console.log('  merge:                 fails — Pull Request is still a draft');
console.log('  reaction:              "Will continue monitoring..."');
console.log(`  loop ends after:       never (observed: ${OBSERVED_CHECKS} checks over ${OBSERVED_DURATION})`);
console.log('');

const evaluation = evaluatePullRequestMergeability(GITHUB_ANSWER);
const classification = classifyMergeError(MERGE_ERROR);

console.log('AFTER');
console.log(`  mergeable verdict:     ${evaluation.mergeable} (isDraft=${evaluation.isDraft}, reason: ${evaluation.reason})`);
console.log('  blocker emitted:       draft');
console.log('  reaction:              mark the PR ready for review, re-check in 5s');
console.log(`  if the merge is still attempted and fails: category=${classification.category}, terminal=${classification.terminal}, recoverable=${classification.recoverable}`);
console.log(`  resolution hint:       ${classification.resolution}`);
console.log(`  loop ends after:       ${MAX_CONSECUTIVE_MERGE_FAILURES} consecutive failures, or the --auto-restart-until-mergeable-timeout-hours deadline`);
console.log('');

const reproduced = legacyMergeable(GITHUB_ANSWER) === true && evaluation.mergeable === false;
console.log(reproduced ? '✅ Reproduced the old verdict and confirmed the new one.' : '❌ Unexpected: the models disagree with the log.');
process.exit(reproduced ? 0 : 1);
