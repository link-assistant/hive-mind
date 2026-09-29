#!/usr/bin/env node

/**
 * Regression test for issue #2312: a deliberate draft must restart the AI, not
 * stop the run after three fake "Draft restored" rounds.
 *
 * Rust run (2026-09-27, `--tool codex`): the session ended with an empty diff,
 * `ensurePullRequestIsReady({ requireChanges: true })` recorded a deliberate
 * draft, and the auto-restart-until-mergeable loop called `resolveDraftBlocker`.
 * `ensurePullRequestIsReady` answered `{ ok: true, reason: 'left_in_draft_on_purpose' }`,
 * which the guard counted as a restore - three times - and then posted
 * `🛑 Automation stopped … draft_pull_request`. No AI session was restarted and the
 * PR, ready for review before the run, was left a draft.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2312
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDeliberateDraftFeedback, MAX_DRAFT_SELF_HEALS, resolveDraftBlocker } from '../src/solve.auto-merge-guards.lib.mjs';
import { ensurePullRequestIsDraft, ensurePullRequestIsReady, ensurePullRequestStaysDraftAfterFailure, getPullRequestLeftInDraft, markPullRequestCreatedByThisRun, resetWorkingSessionDrafts, restoreDeliberateDraftsAtRunEnd } from '../src/pr-draft-state.lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readSrc = name => readFileSync(join(__dirname, '..', 'src', name), 'utf8');

let passed = 0;
let failed = 0;
const test = async (description, fn) => {
  resetWorkingSessionDrafts();
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

const silentLog = async () => {};
const formatAligned = (icon, key, value) => `${icon} ${key} ${value}`;

/**
 * A fake `gh` that keeps a PR's draft flag and records every command.
 * `gh pr ready` flips it to ready, `gh pr ready --undo` to draft.
 */
const createFakeGh = ({ isDraft }) => {
  const pr = { isDraft };
  const commands = [];
  const $ = (strings, ...values) => {
    const command = strings.reduce((out, part, index) => out + part + (index < values.length ? String(values[index]) : ''), '');
    commands.push(command);
    if (command.includes('--json isDraft,state')) {
      return Promise.resolve({ code: 0, stdout: JSON.stringify({ isDraft: pr.isDraft, state: 'OPEN' }), stderr: '' });
    }
    if (command.startsWith('gh pr ready')) {
      pr.isDraft = command.includes('--undo');
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    }
    return Promise.resolve({ code: 1, stdout: '', stderr: `unexpected command: ${command}` });
  };
  return { $, pr, commands };
};

const emptyDiff = { measured: true, hasChanges: false, additions: 0, deletions: 0, changedFiles: 0 };
const pr = { owner: 'konard', repo: 'test-hello-world-019fb331', prNumber: 2 };

console.log('Issue #2312: a deliberate draft is answered with an AI restart\n');

await test('empty-diff deliberate draft + auto-merge loop -> next action is restart, not stop', async () => {
  const gh = createFakeGh({ isDraft: false });
  // The session starts (draft) and ends with an empty diff (deliberate draft).
  await ensurePullRequestIsDraft({ ...pr, $: gh.$, log: silentLog });
  const ready = await ensurePullRequestIsReady({ ...pr, $: gh.$, log: silentLog, requireChanges: true, changeStats: emptyDiff });
  assert.equal(ready.reason, 'no_changes');

  const state = { draftSelfHealCount: 0, consecutiveMergeFailures: 0 };
  const stops = [];
  const reportAutomationStop = async payload => stops.push(payload);
  // The Rust run: the loop saw `blockers: draft` on every check.
  for (let check = 0; check <= MAX_DRAFT_SELF_HEALS + 1; check++) {
    const decision = await resolveDraftBlocker({ ...pr, $: gh.$, log: silentLog, formatAligned, reportError: null, reportAutomationStop, verbose: false, state });
    assert.equal(decision.action, 'restart', `check ${check}: expected restart, got ${JSON.stringify(decision)}`);
    assert.equal(decision.deliberate.kind, 'no_changes');
  }
  assert.equal(stops.length, 0, 'no draft_pull_request stop may be posted for a draft this process left on purpose');
  assert.equal(state.draftSelfHealCount, 0, 'a left_in_draft_on_purpose skip is not a restore');
  assert.equal(gh.pr.isDraft, true, 'the guard must not publish an empty diff as ready');
});

await test('a left_in_draft_on_purpose answer from ensureReady is never counted as "Draft restored"', async () => {
  const state = { draftSelfHealCount: 0 };
  const ensureReady = async () => {
    // Recorded concurrently by the session that just ended.
    await ensurePullRequestStaysDraftAfterFailure({ ...pr, $: createFakeGh({ isDraft: true }).$, log: silentLog, reason: 'no progress between sessions' });
    return { ok: true, changed: false, skipped: true, reason: 'left_in_draft_on_purpose' };
  };
  const decision = await resolveDraftBlocker({ ...pr, $: null, log: silentLog, formatAligned, reportAutomationStop: async () => assert.fail('must not stop'), state, ensureReady });
  assert.equal(decision.action, 'restart');
  assert.equal(state.draftSelfHealCount, 0);
});

await test('a failed-session draft restarts with the concrete failure as feedback', async () => {
  const gh = createFakeGh({ isDraft: false });
  await ensurePullRequestStaysDraftAfterFailure({ ...pr, $: gh.$, log: silentLog, reason: 'Final tool result failed: Main.java:3: error: not a statement' });
  const decision = await resolveDraftBlocker({ ...pr, $: gh.$, log: silentLog, formatAligned, reportAutomationStop: async () => assert.fail('must not stop'), state: { draftSelfHealCount: 0 } });
  assert.equal(decision.action, 'restart');
  const feedback = buildDeliberateDraftFeedback(decision.deliberate);
  assert.match(feedback.restartReason, /previous working session failed/);
  assert.ok(
    feedback.feedbackLines.some(line => line.includes('Main.java:3: error: not a statement')),
    'the next session must see the real error'
  );
});

await test('empty-diff feedback names the empty diff and asks for a commit', () => {
  const feedback = buildDeliberateDraftFeedback({ kind: 'no_changes', reason: 'no changes were produced by this session' });
  assert.match(feedback.feedbackLines.join('\n'), /diff against the base branch is empty/);
  assert.match(feedback.feedbackLines.join('\n'), /commit it to the pull request branch/);
});

await test('a draft this process did not leave on purpose is still self-healed and counted', async () => {
  const gh = createFakeGh({ isDraft: true });
  const state = { draftSelfHealCount: 0 };
  const decision = await resolveDraftBlocker({ ...pr, $: gh.$, log: silentLog, formatAligned, reportAutomationStop: async () => assert.fail('must not stop'), state });
  assert.equal(decision.action, 'retry');
  assert.equal(state.draftSelfHealCount, 1);
  assert.equal(gh.pr.isDraft, false);
});

await test('a draft that keeps coming back after real restores still stops (human/external draft)', async () => {
  const gh = createFakeGh({ isDraft: true });
  const stops = [];
  const state = { draftSelfHealCount: MAX_DRAFT_SELF_HEALS };
  const decision = await resolveDraftBlocker({ ...pr, $: gh.$, log: silentLog, formatAligned, reportAutomationStop: async payload => stops.push(payload), state });
  assert.equal(decision.action, 'stop');
  assert.equal(decision.reason, 'draft_pull_request');
  assert.equal(stops.length, 1);
});

console.log('\nIssue #2312: the run never ends with a draft the tool made\n');

await test('a PR that was ready before the run is ready again at the end, even with an empty diff', async () => {
  const gh = createFakeGh({ isDraft: false });
  await ensurePullRequestIsDraft({ ...pr, $: gh.$, log: silentLog });
  await ensurePullRequestIsReady({ ...pr, $: gh.$, log: silentLog, requireChanges: true, changeStats: emptyDiff });
  assert.equal(gh.pr.isDraft, true);
  const results = await restoreDeliberateDraftsAtRunEnd({ $: gh.$, log: silentLog });
  assert.equal(results.length, 1);
  assert.equal(gh.pr.isDraft, false, 'gh pr view --json isDraft must be false after the run');
  assert.equal(getPullRequestLeftInDraft(pr), null);
});

await test('a PR created (as a draft) by this run is ready at the end of a failed run', async () => {
  const gh = createFakeGh({ isDraft: true });
  markPullRequestCreatedByThisRun(pr);
  await ensurePullRequestStaysDraftAfterFailure({ ...pr, $: gh.$, log: silentLog, reason: 'auto-restart limit 5/5 reached' });
  await restoreDeliberateDraftsAtRunEnd({ $: gh.$, log: silentLog });
  assert.equal(gh.pr.isDraft, false);
});

await test('a draft made by a human before the run stays a draft', async () => {
  const gh = createFakeGh({ isDraft: true });
  // First observation of the PR (session start) sees a draft this run did not create.
  await ensurePullRequestIsDraft({ ...pr, $: gh.$, log: silentLog });
  await ensurePullRequestIsReady({ ...pr, $: gh.$, log: silentLog, requireChanges: true, changeStats: emptyDiff });
  const results = await restoreDeliberateDraftsAtRunEnd({ $: gh.$, log: silentLog });
  assert.equal(results[0].reason, 'human_draft');
  assert.equal(gh.pr.isDraft, true);
  assert.ok(!gh.commands.some(command => command.startsWith('gh pr ready 2 --repo') && !command.includes('--undo')), 'must not convert a human draft');
});

await test('no deliberate draft -> the run-end restore is a no-op', async () => {
  const gh = createFakeGh({ isDraft: false });
  assert.deepEqual(await restoreDeliberateDraftsAtRunEnd({ $: gh.$, log: silentLog }), []);
  assert.equal(gh.commands.length, 0);
});

console.log('\nWiring\n');

await test('the watch loop turns a restart decision into an AI restart with the draft verdict as feedback', () => {
  const src = readSrc('solve.auto-merge.lib.mjs');
  assert.match(src, /decision\.action === 'restart'\) deliberateDraft = decision\.deliberate/);
  assert.match(src, /buildDeliberateDraftFeedback\(deliberateDraft\)/);
  assert.doesNotMatch(src, /reason: 'solution_session_failed'/, 'a failed session must not end the loop before a restart');
});

await test('every exit path restores deliberate drafts and PR creation is recorded', () => {
  assert.match(readSrc('solve.mjs'), /setRunEndHook\([\s\S]{0,200}restoreDeliberateDraftsAtRunEnd/);
  assert.match(readSrc('exit-handler.lib.mjs'), /await runRunEndHookOnce\(\{ code, reason \}\);\n\s+try \{\n\s+await showExitMessage/);
  assert.match(readSrc('solve.auto-pr.lib.mjs'), /markPullRequestCreatedByThisRun\(\{ owner, repo, prNumber: localPrNumber \}\)/);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
