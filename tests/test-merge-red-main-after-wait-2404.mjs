#!/usr/bin/env node
/**
 * Issue #2404: /merge didn't recognize a CI/CD failure on main and kept merging.
 *
 * Replays the production timeline from the issue log:
 *   1. `/merge` starts while main's HEAD (cb3bb2d, merge of PR #2403) still has
 *      "Checks and release" in progress, so the pre-start health check returns
 *      `healthy: true, pending: true`.
 *   2. The queue waits for the active run to finish (waitForBranchCI → success).
 *   3. That run actually concluded `failure`, but the queue never looked at the
 *      conclusion again and merged PR #2398 on top of a red main.
 *
 * The fixed queue must re-check the branch health after every wait and before
 * every merge, and stop when main is red.
 *
 * Run with: node tests/test-merge-red-main-after-wait-2404.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2404
 */

import assert from 'node:assert/strict';
import { MergeQueueProcessor, MergeStatus, MergeItemStatus } from '../src/telegram-merge-queue.lib.mjs';
import { evaluateBranchCIHealth } from '../src/github-branch-ci-health.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

const FAILED_RUN = { id: 36914477944, name: 'Checks and release', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/link-assistant/hive-mind/actions/runs/36914477944' };
const PENDING_RUN = { ...FAILED_RUN, status: 'in_progress', conclusion: null };

const healthy = () => ({ healthy: true, pending: false, failedRuns: [], pendingRuns: [], error: null });
const pending = () => ({ healthy: true, pending: true, failedRuns: [], pendingRuns: [PENDING_RUN], error: null });
const red = () => ({ healthy: false, pending: false, failedRuns: [FAILED_RUN], pendingRuns: [], error: '1 CI run(s) failed on main: Checks and release' });

/**
 * Build a processor whose GitHub calls are all scripted.
 * @param {Object} opts
 * @param {Array<Function>} opts.healthSequence - successive checkBranchCIHealth results (last one repeats)
 * @param {Array<Object>} [opts.branchWaitSequence] - successive waitForBranchCI results (last one repeats)
 * @param {Object} [opts.commitCI] - waitForCommitCI result
 * @param {number[]} [opts.prNumbers]
 */
async function buildProcessor({ healthSequence, branchWaitSequence = [{ success: true, waitedForRuns: false, completedRuns: 0, error: null }], commitCI = { success: true, status: 'success', runs: [], failedRuns: [], error: null }, prNumbers = [2398, 2401] }) {
  const calls = { health: 0, branchWait: 0, merged: [], errors: [] };
  const next = (seq, i) => seq[Math.min(i, seq.length - 1)];
  const processor = new MergeQueueProcessor({
    owner: 'link-assistant',
    repo: 'hive-mind',
    onError: async error => calls.errors.push(error.message),
    ensureReadyLabel: async () => ({ success: true, created: false }),
    syncReadyTags: async () => ({ synced: 0, errors: 0 }),
    getAllReadyPRs: async () => prNumbers.map(number => ({ pr: { number, title: `PR ${number}`, url: `https://github.com/link-assistant/hive-mind/pull/${number}`, createdAt: new Date().toISOString() }, issue: null })),
    getDefaultBranch: async () => 'main',
    checkBranchCIHealth: async () => next(healthSequence, calls.health++)(),
    waitForBranchCI: async () => next(branchWaitSequence, calls.branchWait++),
    waitForCommitCI: async () => commitCI,
    checkPRMergeable: async () => ({ mergeable: true }),
    checkPRCIStatus: async () => ({ status: 'success', checks: [] }),
    mergePullRequest: async (owner, repo, number) => {
      calls.merged.push(number);
      return { success: true };
    },
    closeLinkedIssueIfNotAutoClosed: async () => ({ closed: false }),
    getMergeCommitSha: async (owner, repo, number) => ({ sha: `${number}abcdef0`, error: null }),
  });
  processor.sleep = async () => ({ cancelled: processor.isCancelled });
  const init = await processor.initialize();
  assert.equal(init.success, true, 'initialize should succeed');
  return { processor, calls };
}

console.log('\n📋 Issue #2404: /merge must stop when main CI turns red\n');

await asyncTest('Production replay: HEAD CI pending at start, then fails → queue stops, nothing merged', async () => {
  const { processor, calls } = await buildProcessor({
    healthSequence: [pending, red],
    branchWaitSequence: [{ success: true, waitedForRuns: true, completedRuns: 1, error: null }],
  });
  const result = await processor.run();
  assert.deepEqual(calls.merged, [], `No PR may be merged on top of a red main, merged: ${calls.merged.join(', ')}`);
  assert.equal(result.success, false, 'run() should report failure');
  assert.equal(processor.status, MergeStatus.FAILED, 'queue status should be FAILED');
  assert.match(result.error, /Checks and release/, 'error should name the failed workflow');
  assert.deepEqual(processor.branchCIFailedRuns, [FAILED_RUN], 'failed runs should be kept for the final report');
  assert.equal(calls.errors.length, 1, 'onError should be called once');
  assert.ok(
    processor.items.every(item => item.status === MergeItemStatus.PENDING),
    'all PRs should stay pending'
  );
});

await asyncTest('Main turns red between PRs (commit pushed outside the queue) → next PR is not merged', async () => {
  // start: healthy; after PR #2398 merged + its post-merge CI passed, main HEAD is red.
  const { processor, calls } = await buildProcessor({ healthSequence: [healthy, red] });
  const result = await processor.run();
  assert.deepEqual(calls.merged, [2398], 'only the first PR may be merged');
  assert.equal(result.success, false);
  assert.equal(processor.status, MergeStatus.FAILED);
  assert.equal(processor.items[1].status, MergeItemStatus.PENDING, 'second PR stays pending');
});

await asyncTest('HEAD CI still running after the wait timed out → queue stops instead of merging blind', async () => {
  const { processor, calls } = await buildProcessor({
    healthSequence: [pending],
    branchWaitSequence: [{ success: false, waitedForRuns: true, completedRuns: 0, error: 'Timeout waiting for 1 CI runs on main branch' }],
  });
  const result = await processor.run();
  assert.deepEqual(calls.merged, [], 'nothing may be merged while main HEAD CI is unresolved');
  assert.equal(result.success, false);
  assert.match(result.error, /still running|Timeout/i);
});

await asyncTest('HEAD CI pending at start, then passes → queue merges everything', async () => {
  const { processor, calls } = await buildProcessor({
    healthSequence: [pending, healthy],
    branchWaitSequence: [
      { success: true, waitedForRuns: true, completedRuns: 1, error: null },
      { success: true, waitedForRuns: false, completedRuns: 0, error: null },
    ],
  });
  const result = await processor.run();
  assert.equal(result.success, true, `run() should succeed: ${result.error}`);
  assert.deepEqual(calls.merged, [2398, 2401]);
});

await asyncTest('Healthy main → health is verified before every merge', async () => {
  const { processor, calls } = await buildProcessor({ healthSequence: [healthy] });
  const result = await processor.run();
  assert.equal(result.success, true);
  assert.deepEqual(calls.merged, [2398, 2401]);
  assert.ok(calls.health >= 2, `health should be checked before each merge, checked ${calls.health} time(s)`);
});

await asyncTest('Red main at start → fails fast without waiting for branch CI', async () => {
  const { processor, calls } = await buildProcessor({ healthSequence: [red] });
  const result = await processor.run();
  assert.equal(result.success, false);
  assert.deepEqual(calls.merged, []);
  assert.equal(calls.branchWait, 0, 'should not wait for branch CI when main is already red');
  assert.match(result.error, /Cannot start merge queue/);
});

await asyncTest('Cancel during the branch CI wait → queue is cancelled, nothing merged', async () => {
  const { processor, calls } = await buildProcessor({ healthSequence: [pending] });
  processor.waitForBranchCI = async () => {
    processor.cancel();
    return { success: false, waitedForRuns: true, completedRuns: 0, error: 'Operation was cancelled' };
  };
  const result = await processor.run();
  assert.deepEqual(calls.merged, []);
  assert.equal(processor.status, MergeStatus.CANCELLED, `status should be CANCELLED, got ${processor.status} (${result.error})`);
});

await asyncTest('Exact production timeline: HEAD moves to the run-less 2.33.4 bump while waiting → queue stops', async () => {
  // GitHub "world" as seen through the API, using the real branch health evaluator.
  const cb3bb2d = { sha: 'cb3bb2d4dc9d7c50d4e262dcfcc01a912027618b', parent: 'c62b9fb', date: '2026-10-01T19:27:54Z' };
  const bump = { sha: '6702efe57cd1ddd86927d242381bf012f85ca27d', parent: cb3bb2d.sha, date: '2026-10-01T19:37:27Z' };
  const world = { now: Date.parse('2026-10-01T19:33:00Z'), commits: [cb3bb2d], runs: { [cb3bb2d.sha]: [{ ...PENDING_RUN, event: 'push' }] } };
  const { processor, calls } = await buildProcessor({ healthSequence: [pending] });
  processor.checkBranchCIHealth = async () => {
    calls.health++;
    return evaluateBranchCIHealth({ branch: 'main', commits: world.commits, getRuns: async sha => world.runs[sha] || [], now: world.now });
  };
  processor.waitForBranchCI = async () => {
    if (world.commits[0] === bump) return { success: true, waitedForRuns: false, completedRuns: 0, error: null };
    // 19:37:27 the release job pushes 2.33.4 (no workflows); 19:56:18 "Checks and release" fails.
    world.commits = [bump, cb3bb2d];
    world.runs[cb3bb2d.sha] = [{ ...FAILED_RUN, event: 'push' }];
    world.now = Date.parse('2026-10-01T19:56:20Z');
    return { success: true, waitedForRuns: true, completedRuns: 1, error: null };
  };
  const result = await processor.run();
  assert.deepEqual(calls.merged, [], `PR #2398 must not be merged on top of a red main, merged: ${calls.merged.join(', ')}`);
  assert.equal(result.success, false);
  assert.match(result.error, /Checks and release/);
  assert.match(result.error, /cb3bb2d/, 'error should point at the commit whose CI failed');
});

console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed\n`);
if (testsFailed > 0) process.exit(1);
