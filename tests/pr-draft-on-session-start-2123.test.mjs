#!/usr/bin/env node

/**
 * Regression test for issue #2123: a working session that starts, restarts or resumes must put
 * the pull request back into draft mode.
 *
 * Reported symptom (link-assistant/formal-ai#880): an auto-restart iteration ("Detected
 * uncommitted changes from previous run. Starting new session…") ran while the PR stayed
 * "ready for review".
 *
 * Root cause: the only draft conversion lived inline in startWorkSession() and was gated behind
 * `isContinueMode && prNumber && (argv.watch || argv.autoContinue)`. Restart iterations do not
 * go through startWorkSession at all — they go through executeToolIteration() in
 * solve.restart-shared.lib.mjs, which had no draft handling.
 *
 * Fix: src/pr-draft-state.lib.mjs is the single implementation, called from startWorkSession()
 * (for every continue-mode session) and from executeToolIteration() (for every restart/resume
 * iteration of watch, auto-restart-until-mergeable, escalate, keep-working and auto-ensure).
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2123
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensurePullRequestIsDraft, ensurePullRequestIsReady, getPullRequestDraftState } from '../src/pr-draft-state.lib.mjs';

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

/**
 * Build a fake command-stream `$` tagged-template runner.
 * Records every executed command and answers `gh pr view` from `state`.
 */
const makeFakeDollar = state => {
  const commands = [];
  const runner = (strings, ...values) => {
    const command = strings.reduce((acc, part, i) => acc + part + (i < values.length ? String(values[i]) : ''), '');
    commands.push(command);

    if (command.includes('gh pr view')) {
      if (state.viewFails) {
        return Promise.resolve({ code: 1, stdout: '', stderr: 'not found' });
      }
      return Promise.resolve({
        code: 0,
        stdout: JSON.stringify({ isDraft: state.isDraft, state: state.state || 'OPEN' }),
        stderr: '',
      });
    }

    if (command.includes('gh pr ready')) {
      if (state.readyFails) {
        return Promise.resolve({ code: 1, stdout: '', stderr: 'permission denied' });
      }
      state.isDraft = command.includes('--undo');
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    }

    return Promise.resolve({ code: 0, stdout: '', stderr: '' });
  };
  runner.commands = commands;
  return runner;
};

const silentLog = async () => {};
const baseArgs = $ => ({ owner: 'o', repo: 'r', prNumber: 42, $, log: silentLog });

console.log('================================================================================');
console.log('Regression: working sessions must put the PR into draft (Issue #2123)');
console.log('================================================================================\n');

console.log('Behavior of src/pr-draft-state.lib.mjs:\n');

await test('converts a ready PR to draft', async () => {
  const state = { isDraft: false, state: 'OPEN' };
  const $ = makeFakeDollar(state);
  const result = await ensurePullRequestIsDraft(baseArgs($));
  assert(result.ok && result.changed, `expected a conversion, got ${JSON.stringify(result)}`);
  assert(
    $.commands.some(c => c.includes('gh pr ready 42') && c.includes('--undo')),
    `expected "gh pr ready 42 --undo", got ${JSON.stringify($.commands)}`
  );
  assert(state.isDraft === true, 'PR should end up in draft state');
});

await test('is a no-op when the PR is already a draft', async () => {
  const state = { isDraft: true, state: 'OPEN' };
  const $ = makeFakeDollar(state);
  const result = await ensurePullRequestIsDraft(baseArgs($));
  assert(result.ok && !result.changed && result.skipped, `expected a skip, got ${JSON.stringify(result)}`);
  assert(!$.commands.some(c => c.includes('gh pr ready')), 'no conversion command should be issued');
});

await test('does not touch a merged PR', async () => {
  const state = { isDraft: false, state: 'MERGED' };
  const $ = makeFakeDollar(state);
  const result = await ensurePullRequestIsDraft(baseArgs($));
  assert(result.skipped && result.reason === 'pr_merged', `expected pr_merged skip, got ${JSON.stringify(result)}`);
  assert(!$.commands.some(c => c.includes('gh pr ready')), 'no conversion command should be issued for merged PRs');
});

await test('does not touch a closed PR', async () => {
  const state = { isDraft: false, state: 'CLOSED' };
  const $ = makeFakeDollar(state);
  const result = await ensurePullRequestIsDraft(baseArgs($));
  assert(result.skipped && result.reason === 'pr_closed', `expected pr_closed skip, got ${JSON.stringify(result)}`);
});

await test('reports a failed conversion without throwing', async () => {
  const $ = makeFakeDollar({ isDraft: false, state: 'OPEN', readyFails: true });
  const result = await ensurePullRequestIsDraft(baseArgs($));
  assert(!result.ok && result.reason === 'conversion_failed', `expected conversion_failed, got ${JSON.stringify(result)}`);
});

await test('reports a failed status check without throwing', async () => {
  const $ = makeFakeDollar({ viewFails: true });
  const result = await ensurePullRequestIsDraft(baseArgs($));
  assert(!result.ok && result.reason === 'status_check_failed', `expected status_check_failed, got ${JSON.stringify(result)}`);
});

await test('skips when there is no PR context', async () => {
  const $ = makeFakeDollar({ isDraft: false, state: 'OPEN' });
  const result = await ensurePullRequestIsDraft({ owner: 'o', repo: 'r', prNumber: null, $, log: silentLog });
  assert(result.skipped && result.reason === 'missing_pr_context', `expected missing_pr_context, got ${JSON.stringify(result)}`);
  assert($.commands.length === 0, 'no gh command should run without a PR number');
});

await test('ensurePullRequestIsReady converts a draft back to ready', async () => {
  const state = { isDraft: true, state: 'OPEN' };
  const $ = makeFakeDollar(state);
  const result = await ensurePullRequestIsReady(baseArgs($));
  assert(result.ok && result.changed, `expected a conversion, got ${JSON.stringify(result)}`);
  assert(
    $.commands.some(c => c.includes('gh pr ready 42') && !c.includes('--undo')),
    `expected "gh pr ready 42", got ${JSON.stringify($.commands)}`
  );
  assert(state.isDraft === false, 'PR should end up ready for review');
});

await test('getPullRequestDraftState parses gh JSON output', async () => {
  const $ = makeFakeDollar({ isDraft: true, state: 'open' });
  const status = await getPullRequestDraftState(baseArgs($));
  assert(status.ok && status.isDraft === true && status.state === 'OPEN', `unexpected status ${JSON.stringify(status)}`);
});

console.log('\nWiring into every session-start path:\n');

const sessionSrc = readSrc('solve.session.lib.mjs');
const restartSrc = readSrc('solve.restart-shared.lib.mjs');
const autoContinueSrc = readSrc('solve.auto-continue.lib.mjs');

await test('startWorkSession uses the shared draft helper', () => {
  assert(sessionSrc.includes("from './pr-draft-state.lib.mjs'"), 'solve.session.lib.mjs should import pr-draft-state.lib.mjs');
  assert(sessionSrc.includes('ensurePullRequestIsDraft('), 'startWorkSession should call ensurePullRequestIsDraft');
  assert(sessionSrc.includes('ensurePullRequestIsReady('), 'endWorkSession should call ensurePullRequestIsReady');
});

await test('the draft conversion is no longer gated behind --watch/--auto-continue', () => {
  assert(!sessionSrc.includes('if (isContinueMode && prNumber && (argv.watch || argv.autoContinue))'), 'the old gate must be gone: it skipped draft conversion for plain resume sessions');
  assert(sessionSrc.includes('if (isContinueMode && prNumber) {'), 'draft conversion must run for every continue-mode session with a PR');
});

await test('startWorkSession no longer contains an inline gh pr ready call', () => {
  assert(!sessionSrc.includes('gh pr ready'), 'draft/ready transitions must live only in pr-draft-state.lib.mjs');
});

await test('executeToolIteration drafts the PR before every restart iteration', () => {
  assert(restartSrc.includes("await import('./pr-draft-state.lib.mjs')"), 'solve.restart-shared.lib.mjs should import pr-draft-state.lib.mjs');
  const iterationStart = restartSrc.indexOf('export const executeToolIteration');
  const draftCall = restartSrc.indexOf('ensurePullRequestIsDraft(', iterationStart);
  assert(iterationStart !== -1 && draftCall !== -1, 'executeToolIteration should call ensurePullRequestIsDraft');
  const toolExecution = restartSrc.indexOf('let toolResult;', iterationStart);
  assert(draftCall < toolExecution, 'the draft conversion must happen before the AI tool runs');
});

await test('limit-reset resume keeps --auto-continue so the PR is found and drafted', () => {
  assert(autoContinueSrc.includes("resumeArgs.push('--auto-continue')"), 'auto-resume/auto-restart must forward --auto-continue to the spawned session');
});

console.log('');
console.log('================================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================================');

process.exit(failed === 0 ? 0 : 1);
