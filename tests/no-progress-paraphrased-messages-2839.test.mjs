#!/usr/bin/env node

/**
 * Regression test for issue #2839: `auto-restart-until-mergeable` spent 5/5
 * iterations on a CI failure the pull request did not cause.
 *
 * stylist-svelte run (2026-10-09, solve 2.34.0, `--tool codex --think xhigh`,
 * https://github.com/Godmy/stylist-svelte/issues/3 -> PR #4, fork mode): the only
 * CI job, `pipeline-check`, failed while cloning the private submodule
 * `Godmy/stylist-svelte-business` (404). It failed on every `main` push since
 * 2026-10-07 and on the placeholder `.gitkeep` commit `73b6c7d`. Restart 1/5
 * pushed `edee6d7`; restarts 2/5-5/5 ended on the same SHA with a clean tree,
 * but every final message was a paraphrase ("CI remains blocked: ..."), so the
 * #2247 fingerprint - which hashed the message word for word - never repeated.
 *
 * Two fixes are covered here:
 *   1. the session fingerprint is the working tree and the commit only;
 *   2. a CI check that also fails on the base branch head or on the placeholder
 *      commit is reported to the next session once, and then the loop stops with
 *      a "needs human: CI fails on the base branch too" comment.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2839
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAutomationStopComment, describeStopReason } from '../src/automation-stop-reporting.lib.mjs';
import { CI_FAILS_ON_BASE_BRANCH_STOP_REASON, buildPreExistingCiFeedback, classifyPreExistingCiFailures, decidePreExistingCiAction, detectPreExistingCiFailures, findPlaceholderCommitSha, stopWhenCiFailsOnBaseBranch, summarizeCommitChecks } from '../src/ci-pre-existing-failure.lib.mjs';
import { buildSessionFingerprint, noteSessionInput, recordSessionOutcome, resetNoProgressFailure, resetSessionProgress, stopWhenSessionRepeated, takeRepeatedSessionFeedback } from '../src/session-progress.lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

let passed = 0;
let failed = 0;
const test = async (description, fn) => {
  resetSessionProgress();
  resetNoProgressFailure();
  try {
    await fn();
    console.log(`  PASS: ${description}`);
    passed++;
  } catch (error) {
    console.log(`  FAIL: ${description}`);
    console.log(`      ${error.stack || error.message}`);
    failed++;
  }
};

const HEAD = 'edee6d7dfaf030d07c7fed429570e45a95d5674a';
const PLACEHOLDER = '73b6c7d0a1b2c3d4e5f60718293a4b5c6d7e8f90';
const MAIN_HEAD = '9f1e2d3c4b5a69788776655443322110ffeeddcc';
const paraphrases = ['CI remains blocked: `modules/business` is inaccessible…', 'CI remains blocked: the required `modules/business` repository is inaccessible…', 'CI remains blocked. The required `modules/business` repository still returns 404…', 'CI remains blocked: `stylist-svelte-business` returns 404…'];
const ciFeedback = ['❌ CI/CD checks are failing:', '  - pipeline-check', '', 'Please fix the failing CI checks.'];
const stopParams = { owner: 'Godmy', repo: 'stylist-svelte', prNumber: null, tempDir: null, branchName: null, $: async () => ({ code: 1, stdout: '', stderr: '' }) };

/** A fake command-stream tag: answers `gh api` calls from a table keyed by a substring of the command. */
const fakeCommand = (responses, calls = []) => {
  const command = (strings, ...values) => {
    const text = strings.reduce((acc, part, index) => acc + part + (index < values.length ? String(values[index]) : ''), '');
    calls.push(text);
    const key = Object.keys(responses).find(candidate => text.includes(candidate));
    if (!key) return Promise.resolve({ code: 1, stdout: '', stderr: 'not found' });
    const value = responses[key];
    return Promise.resolve({ code: 0, stdout: typeof value === 'string' ? value : JSON.stringify(value), stderr: '' });
  };
  return command;
};

const checkRunPages = runs => [{ total_count: runs.length, check_runs: runs }];
const stylistResponses = {
  'pulls/4 --jq .base.ref': 'main\n',
  'git/ref/heads/main': `${MAIN_HEAD}\n`,
  [`commits/${MAIN_HEAD}/check-runs`]: checkRunPages([{ name: 'pipeline-check', status: 'completed', conclusion: 'failure' }]),
  [`commits/${MAIN_HEAD}/status`]: [],
  'pulls/4/commits': [
    [
      { sha: PLACEHOLDER, commit: { message: 'Initial commit with task details\n\nAdding .gitkeep for PR creation.' } },
      { sha: HEAD, commit: { message: 'Implement the requested component' } },
    ],
  ],
  [`commits/${PLACEHOLDER}/check-runs`]: checkRunPages([{ name: 'pipeline-check', status: 'completed', conclusion: 'failure' }]),
  [`commits/${PLACEHOLDER}/status`]: [],
};

console.log('Issue #2839: paraphrased final messages are the same session outcome\n');

await test('the four stylist-svelte final messages on edee6d7 with a clean tree have one fingerprint', () => {
  const fingerprints = new Set(paraphrases.map(() => buildSessionFingerprint({ gitStatus: '', head: HEAD })));
  assert.equal(fingerprints.size, 1);
  for (const finalMessage of paraphrases) recordSessionOutcome({ finalMessage, gitStatus: '', head: HEAD });
  noteSessionInput(ciFeedback);
  const verdict = recordSessionOutcome({ finalMessage: paraphrases[0], gitStatus: '', head: HEAD });
  assert.equal(verdict.repeated, true, 'a reworded message is not progress');
});

await test('a new commit or a changed working tree is still progress', () => {
  recordSessionOutcome({ finalMessage: paraphrases[0], gitStatus: '', head: PLACEHOLDER });
  assert.equal(recordSessionOutcome({ finalMessage: paraphrases[0], gitStatus: '', head: HEAD }).repeated, false, 'new commit');
  assert.equal(recordSessionOutcome({ finalMessage: paraphrases[0], gitStatus: ' M src/App.svelte', head: HEAD }).repeated, false, 'new uncommitted change');
});

await test('the stylist-svelte loop stops after the escalation instead of at 5/5', async () => {
  // Restart 1/5 pushed edee6d7.
  noteSessionInput(ciFeedback);
  recordSessionOutcome({ finalMessage: paraphrases[0], gitStatus: '', head: HEAD });
  // Restart 2/5: same input, same tree, same commit, reworded message -> escalate once.
  noteSessionInput(ciFeedback);
  recordSessionOutcome({ finalMessage: paraphrases[1], gitStatus: '', head: HEAD });
  assert.equal(await stopWhenSessionRepeated(stopParams), null, 'an unchanged input first gets the escalation (#2313)');
  const escalation = takeRepeatedSessionFeedback();
  assert.match(escalation.join('\n'), /LAST TWO WORKING SESSIONS ENDED IDENTICALLY/);
  // Restart 3/5 received the escalation and still changed nothing -> stop.
  noteSessionInput([...ciFeedback, ...escalation]);
  recordSessionOutcome({ finalMessage: paraphrases[2], gitStatus: '', head: HEAD });
  const stall = await stopWhenSessionRepeated(stopParams);
  assert.equal(stall?.reason, 'no_progress_between_sessions');
});

console.log('\nIssue #2839: a CI check that fails without the pull request\n');

await test('summarizeCommitChecks keeps one conclusion per name; a passing re-run wins', () => {
  const summary = summarizeCommitChecks({
    checkRuns: [
      { name: 'pipeline-check', status: 'completed', conclusion: 'failure' },
      { name: 'flaky', status: 'completed', conclusion: 'failure' },
      { name: 'flaky', status: 'completed', conclusion: 'success' },
      { name: 'queued', status: 'in_progress', conclusion: null },
    ],
    statuses: [
      { context: 'ci/legacy', state: 'error' },
      { context: 'ci/pending', state: 'pending' },
    ],
  });
  assert.equal(summary.get('pipeline-check'), 'failure');
  assert.equal(summary.get('flaky'), 'success');
  assert.equal(summary.get('queued'), null);
  assert.equal(summary.get('ci/legacy'), 'error');
  assert.equal(summary.get('ci/pending'), null);
});

await test('classifyPreExistingCiFailures: the base branch head decides first, the placeholder commit is the fallback', () => {
  const base = { label: 'base', sha: MAIN_HEAD, checks: new Map([['pipeline-check', 'success']]) };
  const placeholder = { label: 'placeholder', sha: PLACEHOLDER, checks: new Map([['pipeline-check', 'failure']]) };
  assert.equal(classifyPreExistingCiFailures({ failingChecks: ['pipeline-check'], references: [base, placeholder] }).allPreExisting, false, 'green on the base branch: merging it is real work for the AI');
  const baseQueued = { ...base, checks: new Map([['pipeline-check', null]]) };
  const fallback = classifyPreExistingCiFailures({ failingChecks: ['pipeline-check'], references: [baseQueued, placeholder] });
  assert.equal(fallback.allPreExisting, true);
  assert.equal(fallback.preExisting[0].reference.sha, PLACEHOLDER);
  const mixed = classifyPreExistingCiFailures({ failingChecks: ['pipeline-check', 'unit-tests'], references: [placeholder] });
  assert.equal(mixed.allPreExisting, false, 'a check that never ran on the reference commits is new');
  assert.deepEqual(mixed.newFailures, ['unit-tests']);
  assert.equal(classifyPreExistingCiFailures({ failingChecks: [], references: [placeholder] }).allPreExisting, false);
});

await test('findPlaceholderCommitSha finds the solver commit that only adds the task file', () => {
  assert.equal(findPlaceholderCommitSha(stylistResponses['pulls/4/commits'][0]), PLACEHOLDER);
  assert.equal(findPlaceholderCommitSha([{ sha: HEAD, commit: { message: 'feat: something' } }]), null);
  assert.equal(findPlaceholderCommitSha(null), null);
});

await test('detectPreExistingCiFailures reproduces stylist-svelte: pipeline-check fails on main and on 73b6c7d', async () => {
  const calls = [];
  const logged = [];
  const detection = await detectPreExistingCiFailures({ owner: 'Godmy', repo: 'stylist-svelte', prNumber: 4, failingChecks: ['pipeline-check'], $: fakeCommand(stylistResponses, calls), log: async line => logged.push(line) });
  assert.equal(detection.allPreExisting, true);
  assert.equal(detection.baseBranch, 'main');
  assert.equal(detection.preExisting[0].reference.sha, MAIN_HEAD, 'the base branch head is checked first');
  assert.ok(
    calls.some(call => call.includes(`commits/${PLACEHOLDER}/check-runs`)),
    'the placeholder commit is checked too'
  );
  assert.match(logged.join('\n'), /"pipeline-check" also fails \(failure\) on the head of the base branch `main`/);
});

await test('detectPreExistingCiFailures without evidence returns null (old behavior)', async () => {
  assert.equal(await detectPreExistingCiFailures({ owner: 'Godmy', repo: 'stylist-svelte', prNumber: 4, failingChecks: ['pipeline-check'], $: fakeCommand({}) }), null);
  const throwing = () => {
    throw new Error('boom');
  };
  assert.equal(await detectPreExistingCiFailures({ owner: 'Godmy', repo: 'stylist-svelte', prNumber: 4, failingChecks: ['pipeline-check'], $: throwing }), null);
  assert.equal(await detectPreExistingCiFailures({ owner: 'Godmy', repo: 'stylist-svelte', prNumber: 4, failingChecks: [], $: fakeCommand(stylistResponses) }), null);
});

await test('the next session is told the failure is not caused by the pull request', async () => {
  const detection = await detectPreExistingCiFailures({ owner: 'Godmy', repo: 'stylist-svelte', prNumber: 4, failingChecks: ['pipeline-check'], $: fakeCommand(stylistResponses) });
  const text = buildPreExistingCiFeedback(detection).join('\n');
  assert.match(text, /NOT caused by this pull request/);
  assert.ok(text.includes(`https://github.com/Godmy/stylist-svelte/commit/${MAIN_HEAD}`));
  assert.match(text, /automation will stop and ask a human/);
  assert.deepEqual(buildPreExistingCiFeedback({ ...detection, allPreExisting: false }), []);
  assert.deepEqual(buildPreExistingCiFeedback(null), []);
});

await test('one informed restart, then stop - unless something else also asks for a restart', async () => {
  const detection = await detectPreExistingCiFailures({ owner: 'Godmy', repo: 'stylist-svelte', prNumber: 4, failingChecks: ['pipeline-check'], $: fakeCommand(stylistResponses) });
  const reported = new Set();
  const logged = [];
  const step = ciIsOnlyReason => stopWhenCiFailsOnBaseBranch({ detection, ciIsOnlyReason, alreadyReported: reported, ...stopParams, log: async line => logged.push(line) });
  assert.equal(decidePreExistingCiAction({ detection, ciIsOnlyReason: true, alreadyReported: reported }), 'restart_with_note');
  assert.equal(await step(true), null, 'the first restart carries the note - the issue may ask to fix exactly this CI');
  assert.deepEqual([...reported], ['pipeline-check']);
  assert.equal(await step(false), null, 'a new comment, a conflict or uncommitted changes is still work for the AI');
  const stop = await step(true);
  assert.equal(stop?.reason, CI_FAILS_ON_BASE_BRANCH_STOP_REASON);
  assert.match(logged.join('\n'), /CI FAILS ON BASE BRANCH TOO/);
  assert.equal(decidePreExistingCiAction({ detection: { ...detection, allPreExisting: false }, ciIsOnlyReason: true, alreadyReported: reported }), 'none');
});

await test('the stop comment says "needs human: CI fails on the base branch too" with the evidence', () => {
  assert.equal(describeStopReason(CI_FAILS_ON_BASE_BRANCH_STOP_REASON).title, 'needs human: CI fails on the base branch too');
  const body = buildAutomationStopComment({ reason: CI_FAILS_ON_BASE_BRANCH_STOP_REASON, mode: 'auto-restart-until-mergeable', details: [`\`pipeline-check\` also fails (\`failure\`) on the head of the base branch \`main\`: https://github.com/Godmy/stylist-svelte/commit/${MAIN_HEAD}`] });
  assert.match(body, /needs human: CI fails on the base branch too/);
  assert.match(body, /`ci_fails_on_base_branch`/);
  assert.ok(body.includes(MAIN_HEAD));
});

console.log('\nIssue #2839: wiring in solve.auto-merge.lib.mjs\n');

const autoMergeSource = readFileSync(join(root, 'src', 'solve.auto-merge.lib.mjs'), 'utf8');

await test('the CI feedback carries the pre-existing note and the stop comes before another iteration is claimed', () => {
  const detect = autoMergeSource.indexOf('await detectPreExistingCiFailures(');
  const note = autoMergeSource.indexOf('buildPreExistingCiFeedback(preExistingCi)');
  const stop = autoMergeSource.indexOf('await stopWhenCiFailsOnBaseBranch(');
  const exhausted = autoMergeSource.indexOf('hasExhaustedAutoRestartBudget()', stop);
  const consume = autoMergeSource.indexOf('consumeAutoRestartIteration();', stop);
  assert.ok(detect !== -1 && note > detect && stop > note, 'detect -> note -> decide');
  assert.ok(exhausted > stop && consume > stop, 'stopping must not spend an iteration');
  assert.match(autoMergeSource, /if \(ciStop\) return \{ success: false, reason: ciStop\.reason/);
  assert.match(autoMergeSource, /ciIsOnlyReason: !restartRequestedBeforeCi && !mergeBlocker\?\.message\.includes\('conflicts'\) && !hasUncommittedChanges/);
});

await test('a human comment or an issue edit skips the no-progress check (the message no longer tells sessions apart)', () => {
  assert.match(autoMergeSource, /const stall = hasNewComments \|\| hasIssueMetadataChanges \? null : await stopWhenSessionRepeated\(\{/);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
