#!/usr/bin/env node

/**
 * Regression test for issue #2182: hive-mind itself must put the pull request back to
 * "ready for review" when a working session ends.
 *
 * Reported symptom: a task stayed "Processing" for 4d 12h 13m 35s. Maintainer verdict on
 * PR #2183: "When task is finished or any working session, our hive mind logic must put PR
 * from draft to ready, and only when any working session starts it goes from ready to draft.
 * So we should not fix consequences, we must find the root cause we didn't go into ready
 * state by ourselves on working session end."
 *
 * Root cause (evidence: docs/case-studies/issue-2182/):
 *   the draft transition was code-driven and unconditional, while the matching ready
 *   transition was
 *     (a) missing from executeToolIteration() — restart iterations drafted and never restored;
 *     (b) gated behind `isContinueMode` in endWorkSession() — false for the whole failing run;
 *     (c) sequenced *after* the auto-merge watch loop in solve.mjs, so it was unreachable
 *         while the loop spun for four days;
 *     (d) otherwise delegated to the AI model by a prompt line ("use gh pr ready <n>") —
 *         a request, not a guarantee. In the failing run the model simply did not run it.
 *
 * The state machine is now symmetric: every draft handed out by pr-draft-state.lib.mjs is
 * tracked, and every exit path (normal end, tool exception, CTRL+C, fatal error) restores it.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2182
 * @see https://github.com/link-assistant/hive-mind/pull/2183
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensurePullRequestIsDraft, ensurePullRequestIsReady, getOutstandingWorkingSessionDrafts, restorePullRequestsLeftInDraft, resetWorkingSessionDrafts } from '../src/pr-draft-state.lib.mjs';

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
      if (state.readyFails) return Promise.resolve({ code: 1, stdout: '', stderr: 'permission denied' });
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
console.log('Regression: a finished working session never leaves a PR in draft (Issue #2182)');
console.log('================================================================================\n');

console.log('The draft registry — every draft handed out must be restorable:\n');

await test('drafting a PR registers it as an outstanding working-session draft', async () => {
  resetWorkingSessionDrafts();
  const $ = makeFakeDollar({ isDraft: false, state: 'OPEN' });
  await ensurePullRequestIsDraft(baseArgs($, { reason: 'restart iteration' }));
  const outstanding = getOutstandingWorkingSessionDrafts();
  assert(outstanding.length === 1, `expected 1 tracked draft, got ${JSON.stringify(outstanding)}`);
  assert(outstanding[0].owner === 'o' && outstanding[0].repo === 'r' && outstanding[0].prNumber === 42, `unexpected entry ${JSON.stringify(outstanding[0])}`);
  assert(outstanding[0].reason === 'restart iteration', 'the reason must be kept for diagnostics');
});

await test('a PR that already was a draft is tracked too — the session still owns it', async () => {
  resetWorkingSessionDrafts();
  const $ = makeFakeDollar({ isDraft: true, state: 'OPEN' });
  const result = await ensurePullRequestIsDraft(baseArgs($));
  assert(result.skipped && result.reason === 'already_in_target_state', `expected a skip, got ${JSON.stringify(result)}`);
  assert(getOutstandingWorkingSessionDrafts().length === 1, 'an already-draft PR must still be restored at session end');
});

await test('marking the PR ready clears it from the registry', async () => {
  resetWorkingSessionDrafts();
  const state = { isDraft: false, state: 'OPEN' };
  const $ = makeFakeDollar(state);
  await ensurePullRequestIsDraft(baseArgs($));
  await ensurePullRequestIsReady(baseArgs($));
  assert(state.isDraft === false, 'the PR must end up ready for review');
  assert(getOutstandingWorkingSessionDrafts().length === 0, 'nothing may stay outstanding after a successful ready conversion');
});

await test('a merged PR is dropped from the registry instead of retried forever', async () => {
  resetWorkingSessionDrafts();
  const state = { isDraft: true, state: 'OPEN' };
  const $ = makeFakeDollar(state);
  await ensurePullRequestIsDraft(baseArgs($));
  state.state = 'MERGED';
  await ensurePullRequestIsReady(baseArgs($));
  assert(getOutstandingWorkingSessionDrafts().length === 0, 'a merged PR cannot be converted and must not stay tracked');
});

await test('a failed ready conversion keeps the PR tracked for the next safety net', async () => {
  resetWorkingSessionDrafts();
  const state = { isDraft: false, state: 'OPEN' };
  const $ = makeFakeDollar(state);
  await ensurePullRequestIsDraft(baseArgs($));
  state.readyFails = true;
  const result = await ensurePullRequestIsReady(baseArgs($));
  assert(!result.ok && result.reason === 'conversion_failed', `expected conversion_failed, got ${JSON.stringify(result)}`);
  assert(getOutstandingWorkingSessionDrafts().length === 1, 'a PR whose restore failed must remain outstanding');
});

console.log('\nThe safety net — restorePullRequestsLeftInDraft():\n');

await test('restores every PR this process left in draft', async () => {
  resetWorkingSessionDrafts();
  const state = { isDraft: false, state: 'OPEN' };
  const $ = makeFakeDollar(state);
  await ensurePullRequestIsDraft(baseArgs($));
  assert(state.isDraft === true, 'precondition: the PR is a draft');

  const results = await restorePullRequestsLeftInDraft({ $, log: silentLog, reason: 'session interrupted (CTRL+C)' });
  assert(results.length === 1 && results[0].changed === true, `expected one conversion, got ${JSON.stringify(results)}`);
  assert(state.isDraft === false, 'the interrupted session must leave the PR ready for review');
  assert(getOutstandingWorkingSessionDrafts().length === 0, 'the registry must be drained');
});

await test('is a cheap no-op when nothing is outstanding', async () => {
  resetWorkingSessionDrafts();
  const $ = makeFakeDollar({ isDraft: false, state: 'OPEN' });
  const results = await restorePullRequestsLeftInDraft({ $, log: silentLog });
  assert(results.length === 0, 'nothing to restore');
  assert($.commands.length === 0, 'no gh call may be made when the registry is empty');
});

console.log('\nendWorkSession() must not be gated behind --continue mode:\n');

await test('a non-continue session still converts the PR back to ready', async () => {
  // Reproduces the failing run: isContinueMode was false for the whole process
  // (full.log line 8110), so the old `if (isContinueMode && prNumber)` gate made
  // endWorkSession a no-op and the PR stayed a draft for 4d 12h.
  resetWorkingSessionDrafts();
  const previousOwner = global.owner;
  const previousRepo = global.repo;
  global.owner = 'o';
  global.repo = 'r';
  try {
    const { endWorkSession } = await import('../src/solve.session.lib.mjs');
    const state = { isDraft: true, state: 'OPEN' };
    const $ = makeFakeDollar(state);
    await endWorkSession({ isContinueMode: false, prNumber: 42, argv: {}, log: silentLog, formatAligned: (icon, key, value) => `${icon} ${key} ${value}`, $ });
    assert(state.isDraft === false, 'endWorkSession must mark the PR ready even when isContinueMode is false');
    assert(
      $.commands.some(c => c.includes('gh pr ready 42') && !c.includes('--undo')),
      `expected a ready conversion, got ${JSON.stringify($.commands)}`
    );
  } finally {
    global.owner = previousOwner;
    global.repo = previousRepo;
  }
});

await test('a non-continue session does not post work-session comments', async () => {
  resetWorkingSessionDrafts();
  const previousOwner = global.owner;
  const previousRepo = global.repo;
  global.owner = 'o';
  global.repo = 'r';
  try {
    const { endWorkSession } = await import('../src/solve.session.lib.mjs');
    const $ = makeFakeDollar({ isDraft: true, state: 'OPEN' });
    await endWorkSession({ isContinueMode: false, prNumber: 42, argv: { watch: true }, log: silentLog, formatAligned: (icon, key, value) => `${icon} ${key} ${value}`, $ });
    assert(!$.commands.some(c => c.includes('gh pr comment') || c.includes('gh api')), `no session comment may be posted outside continue mode, got ${JSON.stringify($.commands)}`);
  } finally {
    global.owner = previousOwner;
    global.repo = previousRepo;
  }
});

console.log('\nWiring: every session-end path must restore "ready for review":\n');

const sessionSrc = readSrc('solve.session.lib.mjs');
const restartSrc = readSrc('solve.restart-shared.lib.mjs');
const solveSrc = readSrc('solve.mjs');
const interruptSrc = readSrc('solve.interrupt.lib.mjs');
const resultsSrc = readSrc('solve.results.lib.mjs');

await test('endWorkSession no longer requires continue mode for the state transition', () => {
  const start = sessionSrc.indexOf('export async function endWorkSession');
  assert(start !== -1, 'endWorkSession must exist');
  const body = sessionSrc.slice(start);
  assert(!body.includes('if (isContinueMode && prNumber) {'), 'the isContinueMode gate around the ready conversion must be gone (issue #2182)');
  assert(body.includes('if (prNumber) {'), 'the ready conversion must run for every session that has a PR');
});

await test('executeToolIteration restores the PR from a finally block', () => {
  const start = restartSrc.indexOf('export const executeToolIteration');
  const readyCall = restartSrc.indexOf('ensurePullRequestIsReady(', start);
  const finallyBlock = restartSrc.indexOf('} finally {', start);
  assert(readyCall !== -1, 'executeToolIteration must call ensurePullRequestIsReady');
  assert(finallyBlock !== -1 && finallyBlock < readyCall, 'the ready conversion must live in a finally block so a crashing AI tool cannot skip it');
});

await test('solve.mjs marks the PR ready BEFORE the auto-merge watch loop starts', () => {
  const readyCall = solveSrc.indexOf("reason: 'AI working session finished'");
  const watchLoop = solveSrc.indexOf('await startAutoRestartUntilMergeable(');
  assert(readyCall !== -1, 'solve.mjs must end the AI working session explicitly');
  assert(watchLoop !== -1, 'the auto-merge watch loop must still be started');
  assert(readyCall < watchLoop, 'the ready conversion must happen before a loop that can run for days (issue #2182)');
});

await test('the fatal-error path restores pull requests left in draft', () => {
  assert(solveSrc.includes('restorePullRequestsLeftInDraft('), 'the main catch block must drain the draft registry');
});

await test('CTRL+C restores pull requests left in draft, before the slow log upload', () => {
  assert(interruptSrc.includes('restorePullRequestsLeftInDraft('), 'the interrupt handler must restore the draft state');
  const restore = interruptSrc.indexOf('restorePullRequestsLeftInDraft(');
  const upload = interruptSrc.indexOf('attachLogToGitHub(');
  assert(restore < upload, 'restoring the PR must not be starved by a multi-MB log upload that SIGKILL can cut off (#2052)');
});

await test('no code path bypasses pr-draft-state.lib.mjs with an inline gh pr ready', () => {
  const inlineReadyCall = /\$`gh pr ready/;
  assert(!inlineReadyCall.test(resultsSrc), 'solve.results.lib.mjs must use ensurePullRequestIsReady instead of an inline gh call');
  assert(resultsSrc.includes('ensurePullRequestIsReady('), 'solve.results.lib.mjs must use the shared helper');
  assert(!inlineReadyCall.test(sessionSrc), 'solve.session.lib.mjs must use the shared helper');
  assert(!inlineReadyCall.test(restartSrc), 'solve.restart-shared.lib.mjs must use the shared helper');
  assert(!inlineReadyCall.test(solveSrc), 'solve.mjs must use the shared helper');
});

console.log('');
console.log('================================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================================');

process.exit(failed === 0 ? 0 : 1);
