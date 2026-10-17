#!/usr/bin/env node

/**
 * Regression test for issue #3469: "solution logs were marked, but no
 * auto-resume/restart session starting" (PR #3446, comment 6232524845).
 *
 * What the 2026-10-17 run did (docs/case-studies/issue-3469/data/pr-3446-execution.log.txt):
 *
 *   1. The primary session ended on 2ba2553.
 *   2. A completion restart (#2406) only reworded the PR description - correct
 *      work, but HEAD and the working tree stayed the same, so the session was
 *      recorded as "ended exactly like the previous one" with a changed input.
 *   3. solve pushed its own .gitkeep revert: the branch moved to 18cf114.
 *   4. auto-restart-until-mergeable saw failing CI on 18cf114 and, before
 *      starting a single session for it, read that stale verdict and stopped:
 *      "NO PROGRESS BETWEEN SESSIONS ... Budget left unused: 5 restart iterations".
 *
 * Fixed: a verdict stops a loop only while the branch is still where the
 * repeated session left it, and a completion restart is not stall evidence.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describeVerdict, getLastSessionProgress, getRecordedSessions, hasNoProgressFailure, recordSessionOutcome, resetNoProgressFailure, resetSessionProgress, stopWhenSessionRepeated } from '../src/session-progress.lib.mjs';
import { runIssueCompletionUntilVerified } from '../src/solve.issue-completion.lib.mjs';

const PRIMARY_HEAD = '2ba2553397e8cdaf9adf092cc894533670672861';
const GITKEEP_REVERT_HEAD = '18cf114c0bf4c7afd0f5d335e7b7f823d348c045';

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

/** A `$` whose workspace HEAD is `head`; every other command fails, so nothing is committed or posted. */
const fakeWorkspace = head => {
  const commands = [];
  const $ =
    () =>
    async (strings, ...values) => {
      const command = strings.reduce((out, part, index) => out + part + (index < values.length ? String(values[index]) : ''), '');
      commands.push(command);
      if (command.startsWith('git rev-parse HEAD')) return { code: 0, stdout: `${head}\n`, stderr: '' };
      return { code: 1, stdout: '', stderr: 'not available in this test' };
    };
  return { $, commands };
};

const tempDir = mkdtempSync(join(tmpdir(), 'hive-3469-progress-'));
const logs = [];
const stopParams = command => ({ owner: 'link-assistant', repo: 'hive-mind', prNumber: null, tempDir, branchName: 'issue-3445-7cd6fd7f1b0b', $: command, log: async line => logs.push(String(line)), mode: 'auto-restart-until-mergeable', verbose: true });

console.log('\nIssue #3469: auto-restart after a completion restart and the .gitkeep revert\n');

await test('the PR #3446 sequence: the branch moved after the repeated session, so the loop restarts', async () => {
  recordSessionOutcome({ gitStatus: '', head: PRIMARY_HEAD, label: 'Primary session', input: 'solve' });
  // Before the fix the completion restart was recorded like any other session.
  const verdict = recordSessionOutcome({ gitStatus: '', head: PRIMARY_HEAD, sessionId: '6be2f76a', input: 'completion feedback' });
  assert.equal(verdict.repeated, true);
  assert.equal(verdict.inputChanged, true);
  const { $ } = fakeWorkspace(GITKEEP_REVERT_HEAD);
  assert.equal(await stopWhenSessionRepeated(stopParams($)), null, 'a session for the new commit must start');
  assert.equal(hasNoProgressFailure(), false);
  assert.ok(
    logs.some(line => line.includes('the branch moved from 2ba2553 to 18cf114')),
    'the decision is logged'
  );
  assert.ok(
    logs.some(line => line.includes('[session-progress] auto-restart-until-mergeable: repeated=true inputChanged=true')),
    'verbose mode shows the verdict it decided from'
  );
});

await test('a genuine stall on an unmoved branch still stops (issue #2247 stays fixed)', async () => {
  recordSessionOutcome({ gitStatus: '?? Main.jar', head: PRIMARY_HEAD, label: 'Auto-restart 1/5', input: 'ci failure' });
  recordSessionOutcome({ gitStatus: '?? Main.jar', head: PRIMARY_HEAD, label: 'Auto-restart 2/5', input: 'ci failure + escalation' });
  const { $ } = fakeWorkspace(PRIMARY_HEAD);
  const stop = await stopWhenSessionRepeated(stopParams($));
  assert.ok(stop, 'two identical sessions after a changed input still stop the loop');
  assert.equal(stop.reason, 'no_progress_between_sessions');
});

await test('an unreadable HEAD keeps the previous behaviour instead of guessing', async () => {
  recordSessionOutcome({ gitStatus: '', head: PRIMARY_HEAD, input: 'a' });
  recordSessionOutcome({ gitStatus: '', head: PRIMARY_HEAD, input: 'b' });
  const stop = await stopWhenSessionRepeated({ ...stopParams(() => async () => ({ code: 128, stdout: '', stderr: 'fatal' })) });
  assert.ok(stop, 'without a HEAD to compare, the recorded verdict decides');
});

await test('a completion restart is recorded but is not stall evidence itself', async () => {
  recordSessionOutcome({ gitStatus: '', head: PRIMARY_HEAD, label: 'Primary session', input: 'solve' });
  const completion = recordSessionOutcome({ gitStatus: '', head: PRIMARY_HEAD, label: 'Completion restart 1/3', input: 'completion feedback', stallEvidence: false });
  assert.equal(completion.repeated, false, 'editing only the PR description is the work it was asked to do');
  assert.equal(getRecordedSessions().length, 2, 'it is still recorded');
  assert.match(describeVerdict(getLastSessionProgress()), /stallEvidence=false last=Completion restart 1\/3/);
  const { $ } = fakeWorkspace(PRIMARY_HEAD);
  assert.equal(await stopWhenSessionRepeated(stopParams($)), null);
  // A later auto-restart that changes nothing is compared with it, and is a stall.
  const next = recordSessionOutcome({ gitStatus: '', head: PRIMARY_HEAD, label: 'Auto-restart 1/5', input: 'ci failure' });
  assert.equal(next.repeated, true);
});

await test('completion restarts are labelled and marked as no stall evidence', async () => {
  const calls = [];
  const blocker = { reason: 'issue_requirements_not_verified', message: 'Issue requirements have not been verified for this pull request.', details: [], resolution: 'Refresh the report.' };
  let checks = 0;
  await runIssueCompletionUntilVerified(
    { owner: 'link-assistant', repo: 'hive-mind', issueNumber: 3445, prNumber: 3446, argv: { requirementsReport: true } },
    {
      check: async () => (checks++ === 0 ? { blocker } : { blocker: null }),
      execute: async iteration => {
        calls.push(iteration);
        return { success: true };
      },
      sync: async () => {},
    }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sessionLabel, 'Completion restart 1/3', 'the stop comment can name it');
  assert.equal(calls[0].stallEvidence, false);
});

rmSync(tempDir, { recursive: true, force: true });
console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
