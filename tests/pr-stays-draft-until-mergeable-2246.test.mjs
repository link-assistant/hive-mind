#!/usr/bin/env node

/**
 * Regression test for issue #2246: clear communication about pull request status.
 *
 * Evidence: https://github.com/Time0utXC/digitalstructures.pro/pull/4 was merged by the
 * user while hive-mind was still working on it — "[WIP] Migration", 0 checks, body still
 * saying "Work in Progress", and the pull request was NOT a draft. The AI work that was
 * still running was lost.
 *
 * Root causes reproduced here:
 *   RC-A  every tool prompt told the AI worker "When you finish implementation, use
 *         gh pr ready <n>", so the pull request left draft before CI said anything;
 *   RC-B  hive-mind itself marked the pull request ready for review *before* starting
 *         the --auto-restart-until-mergeable loop (issue #2182's fix), so in the default
 *         mode the pull request looked reviewable for the whole time the loop worked;
 *   RC-C  `gh pr create --draft` was never verified: nothing checked isDraft afterwards;
 *   RC-D  nothing told the user which mode hive-mind runs in, or that the signal to wait
 *         for is the `✅ Ready to merge` comment.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2246
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensurePullRequestIsDraft, ensurePullRequestIsReady, getOutstandingWorkingSessionDrafts, getPullRequestLeftInDraft, holdReadyForReview, isReadyForReviewHeld, markPullRequestLeftInDraft, releaseReadyForReviewHold, resetWorkingSessionDrafts, restorePullRequestsLeftInDraft } from '../src/pr-draft-state.lib.mjs';
import { buildPullRequestStatusNotice, buildWorkSessionStatusLine, describeReadinessMode, getReadinessMode, isMergeableModeActive, READINESS_MODES } from '../src/pr-readiness-policy.lib.mjs';
import { getPullRequestLifecycleSubPrompt } from '../src/pr-lifecycle.prompts.lib.mjs';
import { ACTIVE_VARIANT_ID, isVariantComplete, PULL_REQUEST_LIFECYCLE_PROMPT_VARIANTS, REQUIRED_FACTS, selectActiveVariantId, SINGLE_PASS_VARIANT_ID } from '../experiments/issue-2246-prompt-variants.mjs';
import { getSupportedLocales, initI18n, t } from '../src/i18n.lib.mjs';
import { buildReadyToMergeComment, confirmReadyToMergeState, endAiSessionReadyTransition, MAX_READY_FOR_REVIEW_RECHECKS, releaseReadyTransitionHold } from '../src/pr-ready-transition.lib.mjs';
import { evaluatePullRequestMergeability } from '../src/merge-error-classification.lib.mjs';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

const test = async (description, fn) => {
  try {
    await fn();
    console.log(`  ${GREEN}PASS:${RESET} ${description}`);
    passed++;
  } catch (e) {
    console.log(`  ${RED}FAIL:${RESET} ${description}`);
    console.log(`      Error: ${e.message}`);
    failed++;
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const readSrc = name => readFileSync(join(__dirname, '..', 'src', name), 'utf8');

await initI18n('en');

/** Fake command-stream `$` that answers `gh pr view` from `state` and applies `gh pr ready`. */
const makeFakeDollar = state => {
  const commands = [];
  const runner = (strings, ...values) => {
    const command = strings.reduce((acc, part, i) => acc + part + (i < values.length ? String(values[i]) : ''), '');
    commands.push(command);

    if (command.includes('gh pr view')) {
      return Promise.resolve({ code: 0, stdout: JSON.stringify({ isDraft: state.isDraft, state: state.state || 'OPEN' }), stderr: '' });
    }
    if (command.includes('gh pr ready')) {
      state.isDraft = command.includes('--undo');
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    }
    return Promise.resolve({ code: 0, stdout: '', stderr: '' });
  };
  runner.commands = commands;
  return runner;
};

const silentLog = async () => {};
const baseArgs = ($, overrides = {}) => ({ owner: 'o', repo: 'r', prNumber: 42, $, log: silentLog, ...overrides });

console.log('================================================================================');
console.log('Regression: the PR leaves draft only when "ready to merge" is reached (#2246)');
console.log('================================================================================\n');

console.log('Operating mode is defined in exactly one place:\n');

await test('the default run (auto-restart-until-mergeable) is a mergeable mode', () => {
  assert(getReadinessMode({ autoRestartUntilMergeable: true }) === READINESS_MODES.ENSURE_MERGEABLE, 'default mode must be ensure-mergeable');
  assert(isMergeableModeActive({ autoRestartUntilMergeable: true }), 'the default mode must keep the PR draft until it is mergeable');
});

await test('--auto-merge is a mergeable mode too', () => {
  assert(getReadinessMode({ autoMerge: true }) === READINESS_MODES.AUTO_MERGE, 'auto-merge must be detected');
  assert(isMergeableModeActive({ autoMerge: true }), '--auto-merge implies --auto-restart-until-mergeable');
});

await test('kebab-case argv keys are understood as well', () => {
  assert(getReadinessMode({ 'auto-restart-until-mergeable': true }) === READINESS_MODES.ENSURE_MERGEABLE, 'kebab-case key must work');
});

await test('a single-pass run is not a mergeable mode', () => {
  assert(getReadinessMode({}) === READINESS_MODES.SINGLE_PASS, 'without the flags there is no mergeability monitoring');
  assert(!isMergeableModeActive({}), 'single-pass runs must not hold the PR in draft after the session');
});

console.log('\nThe user-facing notice states the mode and the signal to wait for:\n');

await test('the mergeable-mode notice asks the user to wait for "Ready to merge"', () => {
  const notice = buildPullRequestStatusNotice({ autoRestartUntilMergeable: true });
  assert(notice.includes('--auto-restart-until-mergeable'), 'the notice must name the active mode');
  assert(notice.includes('Ready to merge'), 'the notice must name the signal to wait for');
  assert(/draft/i.test(notice), 'the notice must explain the draft state');
  assert(/before reviewing or merging/i.test(notice), 'the notice must ask the user to wait (issue #2246)');
});

await test('the auto-merge notice says hive-mind merges by itself', () => {
  const notice = buildPullRequestStatusNotice({ autoMerge: true });
  assert(/merges this pull request automatically/i.test(notice), 'auto-merge must be spelled out');
});

await test('the single-pass notice does not promise a mergeability check', () => {
  const notice = buildPullRequestStatusNotice({});
  assert(!notice.includes('Ready to merge'), 'no "Ready to merge" signal is posted in single-pass mode');
  assert(/ready for review/i.test(notice), 'the single-pass notice must explain when the PR becomes reviewable');
});

await test('the session-comment line carries the same expectation', () => {
  const line = buildWorkSessionStatusLine({ autoRestartUntilMergeable: true });
  assert(line.includes('Ready to merge') && /wait/i.test(line), `session line must manage expectations, got: ${line}`);
  assert(describeReadinessMode({ autoMerge: true }).flag === '--auto-merge', 'mode description must expose the flag');
});

await test('readiness notices follow every supported work language', async () => {
  const expectedHeadings = {
    en: 'How to read this pull request status',
    hi: 'इस पुल अनुरोध की स्थिति को कैसे समझें',
    ru: 'Как понимать статус этого pull request',
    zh: '如何理解此拉取请求的状态',
  };
  const expectedAutonomy = {
    en: 'work autonomously',
    hi: 'स्वायत्त रूप से काम करें',
    ru: 'работай автономно',
    zh: '自主工作',
  };
  const expectedExistingFailureScope = {
    en: 'failures that predate your changes',
    hi: 'आपके परिवर्तनों से पहले मौजूद थीं',
    ru: 'существовавших до твоих изменений',
    zh: '早于你的更改就已存在的失败',
  };
  for (const locale of getSupportedLocales()) {
    await initI18n({ uiLanguage: 'en', workLanguage: locale });
    const notice = buildPullRequestStatusNotice({ autoRestartUntilMergeable: true });
    const sessionLine = buildWorkSessionStatusLine({ autoRestartUntilMergeable: true });
    const autonomyReference = t('prompt.system.initial.research.tail', {}, { locale });
    const pullRequestReference = t('prompt.system.preparing.pr', { prNumber: 2 }, { locale });
    assert(notice.includes(expectedHeadings[locale]), `${locale} notice must use its translated heading, got: ${notice}`);
    assert(!notice.includes('pr.readiness.'), `${locale} notice must not expose a missing translation key`);
    assert(!sessionLine.includes('pr.readiness.'), `${locale} session line must not expose a missing translation key`);
    assert(autonomyReference.includes(expectedAutonomy[locale]), `${locale} prompt reference must preserve the autonomous-delivery instruction`);
    assert(pullRequestReference.includes(expectedExistingFailureScope[locale]), `${locale} prompt reference must cover pre-existing CI/CD failures`);
    assert(pullRequestReference.includes('Hive Mind'), `${locale} prompt reference must assign pull request states to Hive Mind`);
  }
  await initI18n('en');
});

console.log('\nThe ready hold — "ready for review" means "ready to merge" in mergeable modes:\n');

await test('a held ready transition keeps the pull request in draft', async () => {
  resetWorkingSessionDrafts();
  const state = { isDraft: false, state: 'OPEN' };
  const $ = makeFakeDollar(state);
  holdReadyForReview({ reason: 'ensuring the pull request is mergeable' });
  const result = await ensurePullRequestIsReady(baseArgs($, { reason: 'AI working session finished' }));
  assert(result.reason === 'ready_hold_active', `expected the hold to suppress the transition, got ${JSON.stringify(result)}`);
  assert(state.isDraft === true, 'a PR that is not a draft must be put back into draft while the hold is engaged');
  resetWorkingSessionDrafts();
});

await test('an AI worker that runs the ready transition itself is put back into draft', async () => {
  // RC-A: the prompts used to tell the AI to run `gh pr ready <n>`. Even if a model does
  // it anyway, hive-mind restores the draft state (issue #2246: "If AI itself put the
  // pull request out of draft we can put it back").
  resetWorkingSessionDrafts();
  const state = { isDraft: true, state: 'OPEN' };
  const $ = makeFakeDollar(state);
  await ensurePullRequestIsDraft(baseArgs($, { reason: 'session start' }));
  holdReadyForReview({ reason: 'ensuring the pull request is mergeable' });
  state.isDraft = false; // the AI ran `gh pr ready 42`
  await ensurePullRequestIsReady(baseArgs($, { reason: 'session end' }));
  assert(state.isDraft === true, 'hive-mind must restore the draft state');
  assert(getOutstandingWorkingSessionDrafts().length === 1, 'the PR is still owned by this session');
  resetWorkingSessionDrafts();
});

await test("a pull request taken out of draft behind hive-mind's back is re-drafted by the watch loop", async () => {
  // The hold only sees transitions hive-mind performs itself. `gh pr ready 42` typed by an
  // AI worker into its own shell — or a human clicking "Ready for review" between two
  // checks — never reaches pr-draft-state.lib.mjs, so the monitoring loop re-asserts the
  // state on every check instead of trusting it (issue #2246).
  resetWorkingSessionDrafts();
  const state = { isDraft: true, state: 'OPEN' };
  const $ = makeFakeDollar(state);
  await ensurePullRequestIsDraft(baseArgs($, { reason: 'session start' }));
  holdReadyForReview({ reason: 'ensuring the pull request is mergeable' });
  state.isDraft = false; // somebody published the pull request while no session was running
  const result = await ensurePullRequestIsDraft(baseArgs($, { reason: 'ready-to-merge state not verified yet', preserveDeliberateDraft: true }));
  assert(result.changed === true && state.isDraft === true, `the loop must put the pull request back into draft, got ${JSON.stringify(result)}`);
  const noop = await ensurePullRequestIsDraft(baseArgs($, { reason: 'ready-to-merge state not verified yet', preserveDeliberateDraft: true }));
  assert(noop.changed === false && noop.reason === 'already_in_target_state', `re-asserting an untouched draft must be a no-op, got ${JSON.stringify(noop)}`);
  resetWorkingSessionDrafts();
});

await test('re-asserting the draft does not erase the empty-diff verdict of #2247', async () => {
  resetWorkingSessionDrafts();
  const state = { isDraft: true, state: 'OPEN' };
  const $ = makeFakeDollar(state);
  markPullRequestLeftInDraft({ owner: 'o', repo: 'r', prNumber: 42, reason: 'no changes were produced by this session' });
  await ensurePullRequestIsDraft(baseArgs($, { preserveDeliberateDraft: true }));
  assert(getPullRequestLeftInDraft({ owner: 'o', repo: 'r', prNumber: 42 }) !== null, 'a re-assertion is not a new session, so the verdict must survive');
  await ensurePullRequestIsDraft(baseArgs($, { reason: 'session start' }));
  assert(getPullRequestLeftInDraft({ owner: 'o', repo: 'r', prNumber: 42 }) === null, 'a real session start does clear it, as #2247 requires');
  resetWorkingSessionDrafts();
});

await test('ignoreReadyHold: true bypasses the hold (the ready-to-merge state was reached)', async () => {
  resetWorkingSessionDrafts();
  const state = { isDraft: true, state: 'OPEN' };
  const $ = makeFakeDollar(state);
  await ensurePullRequestIsDraft(baseArgs($));
  holdReadyForReview({ reason: 'ensuring the pull request is mergeable' });
  const result = await ensurePullRequestIsReady(baseArgs($, { ignoreReadyHold: true, reason: 'ready to merge' }));
  assert(result.changed === true && state.isDraft === false, `the exit-path transition must go through, got ${JSON.stringify(result)}`);
  resetWorkingSessionDrafts();
});

await test('bypassing the hold does not publish a pull request left in draft for an empty diff (#2247)', async () => {
  // The two reasons to keep a draft are independent: #2246's hold is about "hive-mind is
  // not done yet", #2247's deliberate draft is about "there is nothing to review". An exit
  // path that ends the first must not silently end the second.
  resetWorkingSessionDrafts();
  const state = { isDraft: true, state: 'OPEN' };
  const $ = makeFakeDollar(state);
  holdReadyForReview({ reason: 'ensuring the pull request is mergeable' });
  markPullRequestLeftInDraft({ owner: 'o', repo: 'r', prNumber: 42, reason: 'no changes were produced by this session' });
  const result = await ensurePullRequestIsReady(baseArgs($, { ignoreReadyHold: true, reason: 'hive-mind finished working on the pull request' }));
  assert(result.reason === 'left_in_draft_on_purpose', `the empty-diff draft must survive, got ${JSON.stringify(result)}`);
  assert(state.isDraft === true, 'a pull request with an empty diff must not be published for review');
  resetWorkingSessionDrafts();
});

await test('releasing the hold restores the normal end-of-session behaviour (#2182)', async () => {
  resetWorkingSessionDrafts();
  const state = { isDraft: true, state: 'OPEN' };
  const $ = makeFakeDollar(state);
  holdReadyForReview({ reason: 'ensuring the pull request is mergeable' });
  releaseReadyForReviewHold();
  assert(!isReadyForReviewHeld(), 'the hold must be released');
  await ensurePullRequestIsReady(baseArgs($));
  assert(state.isDraft === false, 'after the hold is released the PR must become ready for review');
  resetWorkingSessionDrafts();
});

await test('the exit-path safety net releases the hold and forces the PR ready (#2182 invariant)', async () => {
  resetWorkingSessionDrafts();
  const state = { isDraft: false, state: 'OPEN' };
  const $ = makeFakeDollar(state);
  await ensurePullRequestIsDraft(baseArgs($));
  holdReadyForReview({ reason: 'ensuring the pull request is mergeable' });
  const results = await restorePullRequestsLeftInDraft({ $, log: silentLog, reason: 'session interrupted (CTRL+C)' });
  assert(results.length === 1, `expected one restore, got ${JSON.stringify(results)}`);
  assert(state.isDraft === false, 'an interrupted run must not leave the PR in draft forever');
  assert(!isReadyForReviewHeld(), 'the hold must not survive an exit path');
  resetWorkingSessionDrafts();
});

console.log('\nPrompts: the AI must not drive the draft/ready state (RC-A):\n');

const promptFiles = ['claude.prompts.lib.mjs', 'agent.prompts.lib.mjs', 'codex.prompts.lib.mjs', 'gemini.prompts.lib.mjs', 'opencode.prompts.lib.mjs', 'qwen.prompts.lib.mjs'];

for (const file of promptFiles) {
  await test(`${file} no longer hardcodes "gh pr ready"`, () => {
    const src = readSrc(file);
    assert(!/use gh pr ready/.test(src), `${file} must not hardcode a pull request state change (issue #2246)`);
  });

  await test(`${file} uses the shared pull request lifecycle sub-prompt`, () => {
    const src = readSrc(file);
    assert(src.includes("from './pr-lifecycle.prompts.lib.mjs'"), `${file} must import the shared sub-prompt`);
    assert(/getPullRequestLifecycleSubPrompt\(\{ argv, prNumber/.test(src), `${file} must render the shared sub-prompt with the run's mode and pull request`);
  });
}

const MERGEABLE_ARGV = [{ autoRestartUntilMergeable: true }, { autoMerge: true }, { 'auto-restart-until-mergeable': true }];

for (const argv of MERGEABLE_ARGV) {
  await test(`in a mergeable mode (${JSON.stringify(argv)}) the sub-prompt hands the state to hive-mind`, () => {
    const subPrompt = getPullRequestLifecycleSubPrompt({ argv, prNumber: 2 });
    assert(/Hive Mind system/.test(subPrompt), 'the prompt must say the Hive Mind system handles the state');
    assert(/draft/.test(subPrompt), 'the prompt must mention the draft state');
    assert(/ready for review/.test(subPrompt), 'the prompt must mention the ready for review state');
    assert(/ready to merge/.test(subPrompt), 'the prompt must mention the ready to merge state');
    assert(!/gh pr ready/.test(subPrompt), 'the AI must not be told to take the pull request out of draft');
  });
}

// Review feedback on #2248: "what if no --auto-restart-until-mergeable option selected?
// I think we should keep previous line for that case." With a single working session
// there is no monitoring loop and no ready hold, so the pre-#2246 line still applies.
await test('without a mergeable mode the sub-prompt keeps the previous "gh pr ready" line', () => {
  const subPrompt = getPullRequestLifecycleSubPrompt({ argv: {}, prNumber: 2 });
  assert(subPrompt === '   - When you finish implementation, use gh pr ready 2.', `unexpected single-pass line: ${subPrompt}`);
});

await test('a tool that needs an explicit repository gets it in the single-pass line', () => {
  const subPrompt = getPullRequestLifecycleSubPrompt({ argv: {}, prNumber: 2, repoSuffix: ' --repo o/r' });
  assert(subPrompt === '   - When you finish implementation, use gh pr ready 2 --repo o/r.', `unexpected gemini-style line: ${subPrompt}`);
});

// Review feedback on #2248: the system prompt is re-sent on every conversation turn,
// so the replacement for "use gh pr ready <n>" must stay one line, not a paragraph.
await test('every lifecycle sub-prompt variant is a single prompt line', () => {
  for (const variant of PULL_REQUEST_LIFECYCLE_PROMPT_VARIANTS) {
    const line = `   - ${variant.text.replace('{{prNumber}}', '2').replace('{{repoSuffix}}', '')}`;
    assert(!line.includes('\n'), `variant ${variant.id} must be one line, got:\n${line}`);
    assert(line.startsWith('   - '), `variant ${variant.id} must be formatted as one item of the surrounding list`);
    // A budget, not a measurement: this line is paid for on every turn of every session.
    assert(line.length <= 280, `variant ${variant.id} must stay compact, got ${line.length} characters`);
  }
});

// Review feedback on #2248: "we should propose at least 10-20 options, try to find the
// most compact/concise version. And use it, yet keep other options."
await test("the catalogue offers at least 10 phrasings and the active one is the rule's pick", () => {
  assert(PULL_REQUEST_LIFECYCLE_PROMPT_VARIANTS.length >= 10, `expected at least 10 candidate phrasings, got ${PULL_REQUEST_LIFECYCLE_PROMPT_VARIANTS.length}`);
  const ids = PULL_REQUEST_LIFECYCLE_PROMPT_VARIANTS.map(v => v.id);
  assert(new Set(ids).size === ids.length, `variant ids must be unique: ${ids.join(', ')}`);
  assert(ids.includes(ACTIVE_VARIANT_ID), `the active variant ${ACTIVE_VARIANT_ID} must be in the catalogue`);
  assert(ids.includes(SINGLE_PASS_VARIANT_ID), `the single-pass variant ${SINGLE_PASS_VARIANT_ID} must be in the catalogue`);
  assert(ACTIVE_VARIANT_ID === selectActiveVariantId(), `the active variant must be the shortest complete when-clause phrasing, which is ${selectActiveVariantId()}`);
  const active = PULL_REQUEST_LIFECYCLE_PROMPT_VARIANTS.find(variant => variant.id === ACTIVE_VARIANT_ID);
  assert(getPullRequestLifecycleSubPrompt({ argv: { autoRestartUntilMergeable: true }, prNumber: 2 }) === `   - ${active.text}`, 'production must use the wording selected during development without selecting it at runtime');
});

await test('the coverage flags of every variant match its own text', () => {
  const evidence = {
    states: /ready to merge/,
    ownership: /Hive Mind system/,
    noChange: /do not change|no need to change|no need to touch|not by you|not you|leave the draft|Do not do its job/,
  };
  for (const variant of PULL_REQUEST_LIFECYCLE_PROMPT_VARIANTS) {
    for (const fact of REQUIRED_FACTS) {
      assert(typeof variant.covers[fact] === 'boolean', `variant ${variant.id} must declare coverage of "${fact}"`);
      if (variant.covers[fact]) {
        assert(evidence[fact].test(variant.text), `variant ${variant.id} claims to cover "${fact}" but its text does not say it`);
      }
    }
  }
  assert(
    PULL_REQUEST_LIFECYCLE_PROMPT_VARIANTS.some(v => !isVariantComplete(v)),
    'incomplete phrasings are kept on purpose, so the choice can be revisited'
  );
});

await test('the universal CI/CD checklist remains in every mode and covers pre-existing failures', async () => {
  const params = { owner: 'o', repo: 'r', issueNumber: 1, prNumber: 2, branchName: 'b', workspaceTmpDir: '/tmp', modelSupportsVision: false };
  for (const file of promptFiles) {
    const { buildSystemPrompt } = await import(`../src/${file}`);
    for (const argv of [{}, { autoRestartUntilMergeable: true }, { autoMerge: true }]) {
      const prompt = buildSystemPrompt({ ...params, argv });
      assert(prompt.includes('check that all CI checks are passing if they exist before you finish'), `${file} must preserve the universal CI instruction in ${JSON.stringify(argv)}`);
      assert(prompt.includes('usually this includes all CI/CD checks'), `${file} must clarify the universal CI/CD scope in ${JSON.stringify(argv)}`);
      assert(/predate your changes/.test(prompt), `${file} must cover pre-existing failures in ${JSON.stringify(argv)}`);
      assert(/seem unrelated to the issue/.test(prompt), `${file} must cover unrelated failures in ${JSON.stringify(argv)}`);
    }
  }
});

await test('all tool prompts prefer autonomous delivery over avoidable clarification', () => {
  for (const file of promptFiles) {
    const src = readSrc(file);
    assert(/work autonomously/.test(src), `${file} must tell the worker to choose autonomously`);
    assert(/fully implement the best option/.test(src), `${file} must require the selected option to be delivered`);
    assert(/document the options considered/.test(src), `${file} must preserve alternatives for review`);
    assert(/ask for human input only when work cannot safely continue/.test(src), `${file} must reserve questions for true blockers`);
  }
});

await test('production lifecycle rendering contains no variant catalogue or selection', () => {
  const src = readSrc('pr-lifecycle.prompts.lib.mjs');
  assert(!/PROMPT_VARIANTS|selectActiveVariantId|\.sort\(/.test(src), 'variant analysis belongs in experiments/tests, not production');
  assert(src.split('\n').length <= 60, `the runtime lifecycle module should stay concise, got ${src.split('\n').length} lines`);
});

console.log('\nWiring (RC-B, RC-C, RC-D):\n');

const solveSrc = readSrc('solve.mjs');
const autoMergeSrc = readSrc('solve.auto-merge.lib.mjs');
const autoPrSrc = readSrc('solve.auto-pr.lib.mjs');
const sessionSrc = readSrc('solve.session.lib.mjs');

await test('solve.mjs ends the AI session through the ready transition, then releases it', () => {
  const sessionEnd = solveSrc.indexOf('await endAiSessionReadyTransition(');
  const watchLoop = solveSrc.indexOf('await startAutoRestartUntilMergeable(');
  const release = solveSrc.indexOf('await releaseReadyTransitionHold(');
  assert(sessionEnd !== -1, 'solve.mjs must end the working session through the ready transition (RC-B)');
  assert(sessionEnd < watchLoop, 'the session end runs before the monitoring loop');
  assert(release > watchLoop, 'the hold may only be released after the monitoring loop returns');
});

await test('the watch loop takes the PR out of draft when it becomes mergeable', () => {
  assert(autoMergeSrc.includes('await confirmReadyToMergeState('), 'the watch loop must perform the ready-to-merge transition');
  const transition = autoMergeSrc.indexOf('await confirmReadyToMergeState(');
  const merge = autoMergeSrc.indexOf('await mergePullRequest(');
  const readyToMergeComment = autoMergeSrc.indexOf('await announceReadyToMerge(');
  assert(transition !== -1 && transition < merge, 'the PR must leave draft before the merge attempt');
  assert(transition < readyToMergeComment, 'the PR must leave draft before the "Ready to merge" comment is posted');
  assert(/leftDraft: leftDraftOnMergeable/.test(autoMergeSrc), 'the "Ready to merge" comment must state that the PR left draft');
});

await test('continued monitoring reclaims draft ownership when readiness becomes stale', () => {
  const reclaim = autoMergeSrc.match(/if \(!draftIsIntentional && leftDraftOnMergeable && blockers\.length > 0\) \{([\s\S]*?)\n\s*\}/)?.[1] || '';
  assert(reclaim.includes('holdReadyForReview('), 'a new blocker after leaving draft must restore the ready hold');
  assert(reclaim.includes('ensurePullRequestIsDraft('), 'a pull request with newly stale readiness must return to draft');
  assert(reclaim.includes('leftDraftOnMergeable = false'), 'the next verified transition must report its own draft change');
});

await test('the "Ready to merge" comment says the PR was taken out of draft', () => {
  const announced = buildReadyToMergeComment({ leftDraft: true });
  assert(announced.includes('Taken out of draft'), `the comment must state the transition, got: ${announced}`);
  assert(announced.includes('All CI checks have passed'), 'the comment must still report the CI state');
  assert(!buildReadyToMergeComment({ leftDraft: false }).includes('draft'), 'a PR that was already ready for review must not claim a transition');
});

// The transition itself is exercised directly: the draft state hides GitHub's real merge
// state, so "mergeable while draft" is not the same claim as "mergeable".
const transitionHarness = () => {
  const calls = [];
  const log = async () => {};
  const formatAligned = (...parts) => parts.join(' ');
  return {
    calls,
    log,
    formatAligned,
    deps: (mergeableAfterLeavingDraft, held = true) => ({
      isHeld: () => held,
      release: () => calls.push('release'),
      hold: () => {
        calls.push('hold');
        held = true;
      },
      markReady: async ({ ignoreReadyHold }) => {
        calls.push(`ready(ignoreReadyHold=${ignoreReadyHold === true})`);
        return { ok: true, changed: true, skipped: false, reason: null, error: null };
      },
      markDraft: async () => calls.push('draft'),
      checkMergeable: async () => {
        calls.push('recheck');
        return mergeableAfterLeavingDraft ? { mergeable: true } : { mergeable: false, reason: 'PR is blocked (possibly by branch protection rules)' };
      },
    }),
  };
};

await test('the ready-to-merge transition leaves draft and re-verifies without the draft mask', async () => {
  const harness = transitionHarness();
  const result = await confirmReadyToMergeState({ owner: 'o', repo: 'r', prNumber: 1, log: harness.log, formatAligned: harness.formatAligned, guardState: {}, deps: harness.deps(true) });
  assert(result.confirmed === true && result.leftDraft === true, `expected a confirmed transition, got ${JSON.stringify(result)}`);
  assert(harness.calls.join(',') === 'release,ready(ignoreReadyHold=true),recheck', `unexpected call order: ${harness.calls.join(',')}`);
});

await test('a failed ready-for-review conversion is not reported as a successful transition', async () => {
  const harness = transitionHarness();
  const deps = harness.deps(true);
  deps.markReady = async ({ ignoreReadyHold }) => {
    harness.calls.push(`ready(ignoreReadyHold=${ignoreReadyHold === true})`);
    return { ok: false, changed: false, skipped: false, reason: 'conversion_failed', error: 'permission denied' };
  };
  const result = await confirmReadyToMergeState({ owner: 'o', repo: 'r', prNumber: 1, log: harness.log, formatAligned: harness.formatAligned, guardState: {}, deps });
  assert(result.confirmed === false && result.leftDraft === false, `a failed conversion must keep monitoring, got ${JSON.stringify(result)}`);
  assert(result.reason === 'permission denied', `the conversion error must be preserved, got ${JSON.stringify(result)}`);
  assert(harness.calls.includes('hold'), `the ready hold must be restored, got ${harness.calls.join(',')}`);
  assert(!harness.calls.includes('recheck'), `GitHub mergeability cannot be strictly rechecked while the PR is still a draft, got ${harness.calls.join(',')}`);
});

await test('a deliberate empty-diff draft is not mistaken for a completed transition', async () => {
  const harness = transitionHarness();
  const deps = harness.deps(true);
  deps.markReady = async ({ ignoreReadyHold }) => {
    harness.calls.push(`ready(ignoreReadyHold=${ignoreReadyHold === true})`);
    return { ok: true, changed: false, skipped: true, reason: 'left_in_draft_on_purpose', error: null };
  };
  const result = await confirmReadyToMergeState({ owner: 'o', repo: 'r', prNumber: 1, log: harness.log, formatAligned: harness.formatAligned, guardState: {}, deps });
  assert(result.confirmed === false && result.leftDraft === false, `an intentionally retained draft must keep monitoring, got ${JSON.stringify(result)}`);
  assert(harness.calls.includes('hold') && !harness.calls.includes('recheck'), `the draft must remain held without a masked recheck, got ${harness.calls.join(',')}`);
});

await test('a PR that is not mergeable once the draft is gone goes back into draft', async () => {
  const harness = transitionHarness();
  const guardState = {};
  const result = await confirmReadyToMergeState({ owner: 'o', repo: 'r', prNumber: 1, log: harness.log, formatAligned: harness.formatAligned, guardState, deps: harness.deps(false) });
  assert(result.confirmed === false, 'a masked blocker must stop the merge');
  assert(harness.calls.includes('hold') && harness.calls.includes('draft'), `the PR must return to draft, got ${harness.calls.join(',')}`);
  assert(guardState.readyRecheckFailures === 1, 'the re-check failure must be counted');
});

await test('the draft/ready flapping is bounded', async () => {
  const harness = transitionHarness();
  const guardState = { readyRecheckFailures: MAX_READY_FOR_REVIEW_RECHECKS - 1 };
  const result = await confirmReadyToMergeState({ owner: 'o', repo: 'r', prNumber: 1, log: harness.log, formatAligned: harness.formatAligned, guardState, deps: harness.deps(false) });
  assert(result.confirmed === false && result.leftDraft === true, `expected the PR to stay ready for review, got ${JSON.stringify(result)}`);
  assert(!harness.calls.includes('draft'), `after ${MAX_READY_FOR_REVIEW_RECHECKS} re-checks the PR must stay out of draft, got ${harness.calls.join(',')}`);
});

await test('without the hold the transition is a no-op (single-pass mode, PR already ready)', async () => {
  const harness = transitionHarness();
  const result = await confirmReadyToMergeState({ owner: 'o', repo: 'r', prNumber: 1, log: harness.log, formatAligned: harness.formatAligned, guardState: {}, deps: harness.deps(true, false) });
  assert(result.confirmed === true && result.leftDraft === false, `expected a pass-through, got ${JSON.stringify(result)}`);
  assert(harness.calls.length === 0, `nothing may be changed, got ${harness.calls.join(',')}`);
});

await test('ending the AI session in a mergeable mode leaves the PR in draft', async () => {
  resetWorkingSessionDrafts();
  const state = { isDraft: true };
  const $ = makeFakeDollar(state);
  await endAiSessionReadyTransition({ ...baseArgs($), argv: { autoRestartUntilMergeable: true }, formatAligned: (...parts) => parts.join(' ') });
  assert(isReadyForReviewHeld(), 'the ready transition must be held while hive-mind keeps working (RC-B)');
  assert(state.isDraft === true, 'the end of the AI session must not publish the PR for review yet');

  // ...and the run's exit path always undoes both (issue #2182's invariant).
  assert((await releaseReadyTransitionHold({ ...baseArgs($), formatAligned: (...parts) => parts.join(' ') })) === true, 'the exit path must report that it released the hold');
  assert(!isReadyForReviewHeld() && state.isDraft === false, 'a finished run never leaves the PR in draft');
  assert((await releaseReadyTransitionHold({ ...baseArgs($), formatAligned: (...parts) => parts.join(' ') })) === false, 'releasing twice is a no-op');
});

await test('ending a single-pass session publishes the PR for review immediately', async () => {
  resetWorkingSessionDrafts();
  const state = { isDraft: true };
  const $ = makeFakeDollar(state);
  await endAiSessionReadyTransition({ ...baseArgs($), argv: {}, formatAligned: (...parts) => parts.join(' ') });
  assert(!isReadyForReviewHeld(), 'a single-pass run has nothing left to wait for');
  assert(state.isDraft === false, 'the PR must be ready for review when the only session ends (issue #2182)');
});

await test('the watch loop re-asserts the draft on every check while the hold is engaged', () => {
  assert(/if \(draftIsIntentional\) \{\s*\n\s*await ensurePullRequestIsDraft\(/.test(autoMergeSrc), "the monitoring loop must restore a draft that somebody removed behind hive-mind's back (issue #2246)");
  assert(/preserveDeliberateDraft: true/.test(autoMergeSrc), 'the re-assertion must not count as a new session for #2247');
});

await test('an intentional draft is not reported as a merge blocker', () => {
  // The exact API answer GitHub gives for a draft with no other blocker (#2182).
  const held = evaluatePullRequestMergeability({ isDraft: true, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' }, { ignoreDraft: true });
  assert(held.mergeable === true, 'an intentional draft must not block the mergeability verdict');
  assert(held.isDraft === true, 'the draft state is still reported to the caller');
  // ...but a real blocker behind the draft mask still is one.
  const conflicting = evaluatePullRequestMergeability({ isDraft: true, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }, { ignoreDraft: true });
  assert(conflicting.mergeable === false && /conflict/i.test(conflicting.reason), `expected the conflict to survive, got ${JSON.stringify(conflicting)}`);
  // And the default is unchanged: without the option a draft is a blocker (#2182).
  assert(evaluatePullRequestMergeability({ isDraft: true, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' }).mergeable === false, 'the #2182 behaviour must be the default');
});

await test('an intentional draft is not fought by the draft self-heal guard', () => {
  assert(autoMergeSrc.includes('isReadyForReviewHeld('), 'the watch loop must know the draft state is intentional (otherwise resolveDraftBlocker stops the run after 3 self-heals)');
  assert(/ignoreDraft/.test(autoMergeSrc), 'the mergeability check must ignore the intentional draft state');
});

await test('PR creation verifies the pull request really was created as a draft (RC-C)', () => {
  assert(/--json number,url,state,isDraft|isDraft/.test(autoPrSrc), 'the post-create verification must query isDraft');
  assert(autoPrSrc.includes('ensurePullRequestIsDraft('), 'a PR that was not created as a draft must be converted');
});

await test('the PR body tells the user how to read the status (RC-D)', () => {
  assert(autoPrSrc.includes('buildPullRequestStatusNotice('), 'the PR body must carry the mode notice');
});

await test('work session comments carry the mode notice too (RC-D)', () => {
  assert(sessionSrc.includes('buildWorkSessionStatusLine('), 'session comments must state the mode and the signal to wait for');
});

console.log('');
console.log('================================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================================');

process.exit(failed === 0 ? 0 : 1);
