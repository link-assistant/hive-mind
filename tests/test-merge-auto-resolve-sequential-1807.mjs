#!/usr/bin/env node
/**
 * Merge Queue Tests — Issue #1807
 *
 * Covers the **sequential** behaviour added to `/merge --auto-resolve`:
 * conflict PRs are handed off one at a time, the queue waits for each
 * spawned `/solve --auto-merge` session to actually land its PR, and only
 * after the post-merge CI drains does the next session start.
 *
 * Run with: node tests/test-merge-auto-resolve-sequential-1807.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1807
 */

import assert from 'node:assert/strict';
import { MergeItemStatus, MergeQueueProcessor, MERGE_CONFLICT_SKIP_REASON, MERGE_QUEUE_CONFIG } from '../src/telegram-merge-queue.lib.mjs';

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
    if (process.env.HIVE_MIND_TEST_TRACE === '1' && error.stack) {
      console.log(error.stack);
    }
    testsFailed++;
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    if (process.env.HIVE_MIND_TEST_TRACE === '1' && error.stack) {
      console.log(error.stack);
    }
    testsFailed++;
  }
}

function makeStubItem(overrides = {}) {
  return {
    pr: { number: overrides.prNumber ?? 100, title: overrides.title ?? 'Demo PR', url: overrides.prUrl ?? 'https://github.com/owner/repo/pull/100', createdAt: new Date().toISOString() },
    issue: overrides.issue ?? null,
    status: overrides.status ?? MergeItemStatus.PENDING,
    error: overrides.error ?? null,
    autoResolveError: overrides.autoResolveError ?? null,
    autoResolveSession: overrides.autoResolveSession ?? null,
    mergeCommitSha: null,
    startedAt: null,
    completedAt: null,
    ciStatus: null,
    getStatusEmoji() {
      switch (this.status) {
        case MergeItemStatus.MERGED:
          return '✅';
        case MergeItemStatus.FAILED:
          return '❌';
        case MergeItemStatus.SKIPPED:
          return '⏭️';
        case MergeItemStatus.RESOLVING:
          return '🛠️';
        case MergeItemStatus.RESOLVE_FAILED:
          return '⚠️';
        default:
          return '⏳';
      }
    },
    getDescription() {
      return `PR #${this.pr.number}: ${this.pr.title}`;
    },
  };
}

const ORIGINAL_POLL = MERGE_QUEUE_CONFIG.AUTO_RESOLVE_POLL_INTERVAL_MS;
const ORIGINAL_TIMEOUT = MERGE_QUEUE_CONFIG.AUTO_RESOLVE_WAIT_TIMEOUT_MS;

console.log('\n📋 Issue #1807: sequential auto-resolve queue\n');

test('Issue #1807: MERGE_QUEUE_CONFIG exposes AUTO_RESOLVE_WAIT_TIMEOUT_MS and AUTO_RESOLVE_POLL_INTERVAL_MS', () => {
  assert.equal(typeof MERGE_QUEUE_CONFIG.AUTO_RESOLVE_WAIT_TIMEOUT_MS, 'number', 'timeout must be a number');
  assert.ok(MERGE_QUEUE_CONFIG.AUTO_RESOLVE_WAIT_TIMEOUT_MS > 0, 'timeout must be positive');
  assert.equal(typeof MERGE_QUEUE_CONFIG.AUTO_RESOLVE_POLL_INTERVAL_MS, 'number', 'poll must be a number');
  assert.ok(MERGE_QUEUE_CONFIG.AUTO_RESOLVE_POLL_INTERVAL_MS > 0, 'poll must be positive');
});

test('Issue #1807: constructor accepts injectable getPRStatus and getMergeCommitSha hooks', () => {
  const stubStatus = async () => ({ state: 'MERGED', mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', error: null });
  const stubSha = async () => ({ sha: 'abc', error: null });
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r', autoResolve: true, spawnSolveSession: async () => ({ success: true }), getPRStatus: stubStatus, getMergeCommitSha: stubSha });
  assert.equal(p.getPRStatus, stubStatus, 'getPRStatus is overridden by constructor option');
  assert.equal(p.getMergeCommitSha, stubSha, 'getMergeCommitSha is overridden by constructor option');
});

await asyncTest('Issue #1807: spawner for PR N is only called after PR N-1 has resolved', async () => {
  // Setup — three conflict PRs, two resolve fast, the middle one is held in
  // an OPEN state for a few polls. The assertion is that the second spawn
  // does not start until the first PR reports MERGED.
  const spawnOrder = [];
  const completionOrder = [];
  let firstMerged = false;

  const spawn = async target => {
    spawnOrder.push(target.prNumber);
    return { success: true, sessionName: `s-${target.prNumber}` };
  };

  let pollsForFirst = 0;
  const getPRStatus = async (_owner, _repo, prNumber) => {
    if (prNumber === 1) {
      pollsForFirst++;
      // Stay OPEN for two polls, then merge.
      if (pollsForFirst < 3) {
        return { state: 'OPEN', mergeStateStatus: 'DIRTY', mergeable: 'CONFLICTING', error: null };
      }
      firstMerged = true;
      completionOrder.push(1);
      return { state: 'MERGED', mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', error: null };
    }
    if (prNumber === 2) {
      // PR 2 must only be polled AFTER PR 1 has merged. Fail loudly otherwise.
      assert.ok(firstMerged, `PR 2 polled before PR 1 merged (spawnOrder=${JSON.stringify(spawnOrder)})`);
      completionOrder.push(2);
      return { state: 'MERGED', mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', error: null };
    }
    return { state: 'OPEN', mergeStateStatus: 'DIRTY', mergeable: 'CONFLICTING', error: null };
  };

  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r', autoResolve: true, spawnSolveSession: spawn, getPRStatus, getMergeCommitSha: async () => ({ sha: 'sha', error: null }) });
  // Disable the post-merge CI wait for this test — exercised separately below.
  p.waitForPostMergeCI = async () => ({ success: true, failedRuns: [], error: null });
  p.sleep = async () => undefined; // collapse the 5s SHA delay
  // Tight polling so the wait completes in milliseconds.
  MERGE_QUEUE_CONFIG.AUTO_RESOLVE_POLL_INTERVAL_MS = 5;
  try {
    p.items = [makeStubItem({ prNumber: 1, status: MergeItemStatus.SKIPPED, error: MERGE_CONFLICT_SKIP_REASON }), makeStubItem({ prNumber: 2, status: MergeItemStatus.SKIPPED, error: MERGE_CONFLICT_SKIP_REASON })];
    await p.runAutoResolve();
  } finally {
    MERGE_QUEUE_CONFIG.AUTO_RESOLVE_POLL_INTERVAL_MS = ORIGINAL_POLL;
  }

  assert.deepEqual(spawnOrder, [1, 2], 'spawns must happen in queue order');
  assert.deepEqual(completionOrder, [1, 2], 'second spawn must wait for first to merge');
  assert.equal(p.stats.autoResolved, 2);
  assert.equal(p.stats.autoResolveFailed, 0);
});

await asyncTest('Issue #1807: waitForPostMergeCI is invoked between resolutions, blocking the next spawn', async () => {
  const events = []; // unified timeline so we can assert ordering across phases

  const spawn = async target => {
    events.push(`spawn-${target.prNumber}`);
    return { success: true, sessionName: `s-${target.prNumber}` };
  };
  const getPRStatus = async (_owner, _repo, prNumber) => {
    events.push(`poll-${prNumber}`);
    return { state: 'MERGED', mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', error: null };
  };
  const getMergeCommitSha = async (_owner, _repo, prNumber) => ({ sha: `sha-${prNumber}`, error: null });

  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r', autoResolve: true, spawnSolveSession: spawn, getPRStatus, getMergeCommitSha });
  p.sleep = async () => undefined;
  p.waitForPostMergeCI = async function (item) {
    events.push(`ci-${item.pr.number}`);
    return { success: true, failedRuns: [], error: null };
  };

  MERGE_QUEUE_CONFIG.AUTO_RESOLVE_POLL_INTERVAL_MS = 1;
  try {
    p.items = [makeStubItem({ prNumber: 10, status: MergeItemStatus.SKIPPED, error: MERGE_CONFLICT_SKIP_REASON }), makeStubItem({ prNumber: 20, status: MergeItemStatus.SKIPPED, error: MERGE_CONFLICT_SKIP_REASON })];
    await p.runAutoResolve();
  } finally {
    MERGE_QUEUE_CONFIG.AUTO_RESOLVE_POLL_INTERVAL_MS = ORIGINAL_POLL;
  }

  // The expected timeline is: spawn-10 → poll-10 → ci-10 → spawn-20 → poll-20 → ci-20.
  // Some incidental polls may repeat, but the relative order of the events
  // above is the requirement (each phase finishes before the next phase
  // for that PR, and the *next* PR's spawn waits for ci-10).
  const indexSpawn10 = events.indexOf('spawn-10');
  const indexPoll10 = events.indexOf('poll-10');
  const indexCi10 = events.indexOf('ci-10');
  const indexSpawn20 = events.indexOf('spawn-20');
  const indexCi20 = events.indexOf('ci-20');
  assert.notEqual(indexSpawn10, -1, 'spawn-10 must occur');
  assert.notEqual(indexPoll10, -1, 'poll-10 must occur');
  assert.notEqual(indexCi10, -1, 'ci-10 must occur');
  assert.notEqual(indexSpawn20, -1, 'spawn-20 must occur');
  assert.ok(indexSpawn10 < indexPoll10, 'spawn-10 must come before poll-10');
  assert.ok(indexPoll10 < indexCi10, 'poll-10 must come before ci-10');
  assert.ok(indexCi10 < indexSpawn20, 'ci-10 must come before spawn-20 — back-pressure failed');
  assert.ok(indexSpawn20 < indexCi20, 'spawn-20 must come before ci-20');

  assert.equal(p.stats.autoResolved, 2);
  assert.equal(p.items[0].mergeCommitSha, 'sha-10', 'PR #10 captures its merge SHA');
  assert.equal(p.items[1].mergeCommitSha, 'sha-20', 'PR #20 captures its merge SHA');
});

await asyncTest('Issue #1807: cancellation during wait halts the loop and leaves subsequent PRs untouched', async () => {
  let firstSpawnHandled = false;
  const spawn = async () => {
    firstSpawnHandled = true;
    return { success: true };
  };
  let calls = 0;
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r', autoResolve: true, spawnSolveSession: spawn });
  p.getPRStatus = async () => {
    calls++;
    // Trip cancellation on the second poll (so we exercise the in-loop check).
    if (calls === 2) p.isCancelled = true;
    return { state: 'OPEN', mergeStateStatus: 'DIRTY', mergeable: 'CONFLICTING', error: null };
  };
  p.waitForPostMergeCI = async () => {
    throw new Error('should never get here on cancel');
  };
  p.sleep = async () => undefined;
  MERGE_QUEUE_CONFIG.AUTO_RESOLVE_POLL_INTERVAL_MS = 1;
  try {
    p.items = [makeStubItem({ prNumber: 200, status: MergeItemStatus.SKIPPED, error: MERGE_CONFLICT_SKIP_REASON }), makeStubItem({ prNumber: 201, status: MergeItemStatus.SKIPPED, error: MERGE_CONFLICT_SKIP_REASON })];
    await p.runAutoResolve();
  } finally {
    MERGE_QUEUE_CONFIG.AUTO_RESOLVE_POLL_INTERVAL_MS = ORIGINAL_POLL;
  }
  assert.ok(firstSpawnHandled, 'first PR should still get its spawn');
  // The second PR's item must NOT have started — it's still SKIPPED, never RESOLVING.
  assert.equal(p.items[1].status, MergeItemStatus.SKIPPED, 'second PR must not transition to RESOLVING after cancel');
  // The first PR was not merged because we cancelled mid-wait, so autoResolved
  // (which now counts actual merges) stays at 0.
  assert.equal(p.stats.autoResolved, 0, 'autoResolved is only bumped on actual merge');
  // The current PR must keep its RESOLVING status — the user can resume.
  assert.equal(p.items[0].status, MergeItemStatus.RESOLVING, 'in-progress PR keeps RESOLVING on cancel');
});

await asyncTest('Issue #1807: timed-out wait marks item RESOLVE_FAILED', async () => {
  const spawn = async () => ({ success: true });
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r', autoResolve: true, spawnSolveSession: spawn });
  // PR never transitions away from OPEN — the wait must time out.
  p.getPRStatus = async () => ({ state: 'OPEN', mergeStateStatus: 'DIRTY', mergeable: 'CONFLICTING', error: null });
  p.waitForPostMergeCI = async () => ({ success: true, failedRuns: [], error: null });
  p.sleep = async () => undefined;
  MERGE_QUEUE_CONFIG.AUTO_RESOLVE_POLL_INTERVAL_MS = 1;
  MERGE_QUEUE_CONFIG.AUTO_RESOLVE_WAIT_TIMEOUT_MS = 30; // 30ms — completes in ~6 polls
  try {
    p.items = [makeStubItem({ prNumber: 300, status: MergeItemStatus.SKIPPED, error: MERGE_CONFLICT_SKIP_REASON })];
    await p.runAutoResolve();
  } finally {
    MERGE_QUEUE_CONFIG.AUTO_RESOLVE_POLL_INTERVAL_MS = ORIGINAL_POLL;
    MERGE_QUEUE_CONFIG.AUTO_RESOLVE_WAIT_TIMEOUT_MS = ORIGINAL_TIMEOUT;
  }
  assert.equal(p.items[0].status, MergeItemStatus.RESOLVE_FAILED, 'timeout should mark RESOLVE_FAILED');
  assert.ok(p.items[0].autoResolveError && p.items[0].autoResolveError.includes('timed out'), `expected timeout error, got: ${p.items[0].autoResolveError}`);
  assert.equal(p.stats.autoResolveFailed, 1);
  assert.equal(p.stats.autoResolved, 0);
});

await asyncTest('Issue #1807: closed PR (without merge) marks item RESOLVE_FAILED', async () => {
  const spawn = async () => ({ success: true });
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r', autoResolve: true, spawnSolveSession: spawn });
  p.getPRStatus = async () => ({ state: 'CLOSED', mergeStateStatus: 'DIRTY', mergeable: 'CONFLICTING', error: null });
  p.sleep = async () => undefined;
  MERGE_QUEUE_CONFIG.AUTO_RESOLVE_POLL_INTERVAL_MS = 1;
  try {
    p.items = [makeStubItem({ prNumber: 400, status: MergeItemStatus.SKIPPED, error: MERGE_CONFLICT_SKIP_REASON })];
    await p.runAutoResolve();
  } finally {
    MERGE_QUEUE_CONFIG.AUTO_RESOLVE_POLL_INTERVAL_MS = ORIGINAL_POLL;
  }
  assert.equal(p.items[0].status, MergeItemStatus.RESOLVE_FAILED, 'closed-without-merge should mark RESOLVE_FAILED');
  assert.equal(p.items[0].autoResolveError, 'PR was closed without merging');
  assert.equal(p.stats.autoResolveFailed, 1);
});

await asyncTest('Issue #1807: getProgressUpdate exposes the current auto-resolve phase and elapsed time', async () => {
  const phases = [];
  const spawn = async () => ({ success: true });
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r', autoResolve: true, spawnSolveSession: spawn });
  p.getPRStatus = async () => ({ state: 'MERGED', mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', error: null });
  p.getMergeCommitSha = async () => ({ sha: 'abc', error: null });
  p.sleep = async () => undefined;
  p.waitForPostMergeCI = async () => ({ success: true, failedRuns: [], error: null });
  p.onProgress = async update => {
    if (update.autoResolve && update.autoResolve.active) {
      phases.push(update.autoResolve.phase);
    }
  };
  MERGE_QUEUE_CONFIG.AUTO_RESOLVE_POLL_INTERVAL_MS = 1;
  try {
    p.items = [makeStubItem({ prNumber: 500, status: MergeItemStatus.SKIPPED, error: MERGE_CONFLICT_SKIP_REASON })];
    await p.runAutoResolve();
  } finally {
    MERGE_QUEUE_CONFIG.AUTO_RESOLVE_POLL_INTERVAL_MS = ORIGINAL_POLL;
  }
  // Order: spawning → awaiting-resolution → awaiting-ci → null (final tick).
  assert.ok(phases.includes('spawning'), `expected 'spawning' phase in ${JSON.stringify(phases)}`);
  assert.ok(phases.includes('awaiting-resolution'), `expected 'awaiting-resolution' phase in ${JSON.stringify(phases)}`);
  assert.ok(phases.includes('awaiting-ci'), `expected 'awaiting-ci' phase in ${JSON.stringify(phases)}`);
  const spawnIndex = phases.indexOf('spawning');
  const resolveIndex = phases.indexOf('awaiting-resolution');
  const ciIndex = phases.indexOf('awaiting-ci');
  assert.ok(spawnIndex < resolveIndex, 'spawning must come before awaiting-resolution');
  assert.ok(resolveIndex < ciIndex, 'awaiting-resolution must come before awaiting-ci');
});

await asyncTest('Issue #1807: formatProgressMessage renders phase-aware auto-resolve lines', async () => {
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r', autoResolve: true });
  p.items = [makeStubItem({ prNumber: 600, status: MergeItemStatus.RESOLVING, prUrl: 'https://github.com/o/r/pull/600' })];
  p.stats.total = 1;
  p.autoResolveActive = true;
  p.autoResolveCurrent = 600;
  p.autoResolveWaitStartedAt = new Date();

  p.autoResolvePhase = 'spawning';
  let msg = p.formatProgressMessage();
  assert.ok(msg.includes('dispatching solve session'), `'spawning' phase missing in: ${msg}`);

  p.autoResolvePhase = 'awaiting-resolution';
  msg = p.formatProgressMessage();
  assert.ok(msg.includes('waiting for resolution'), `'awaiting-resolution' phase missing in: ${msg}`);

  p.autoResolvePhase = 'awaiting-ci';
  msg = p.formatProgressMessage();
  assert.ok(msg.includes('waiting for post\\-merge CI'), `'awaiting-ci' phase missing in: ${msg}`);
});

await asyncTest('Issue #1807: stops the pass when post-merge CI fails and STOP_ON_POST_MERGE_CI_FAILURE is on', async () => {
  const spawned = [];
  const spawn = async target => {
    spawned.push(target.prNumber);
    return { success: true };
  };
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r', autoResolve: true, spawnSolveSession: spawn });
  p.getPRStatus = async () => ({ state: 'MERGED', mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', error: null });
  p.getMergeCommitSha = async () => ({ sha: 'abc', error: null });
  p.sleep = async () => undefined;
  p.waitForPostMergeCI = async () => ({ success: false, failedRuns: [{ name: 'release', html_url: 'https://github.com/o/r/actions/runs/1' }], error: 'release failed' });

  MERGE_QUEUE_CONFIG.AUTO_RESOLVE_POLL_INTERVAL_MS = 1;
  // STOP_ON_POST_MERGE_CI_FAILURE is true by default — verify it.
  const originalStop = MERGE_QUEUE_CONFIG.STOP_ON_POST_MERGE_CI_FAILURE;
  MERGE_QUEUE_CONFIG.STOP_ON_POST_MERGE_CI_FAILURE = true;
  try {
    p.items = [makeStubItem({ prNumber: 700, status: MergeItemStatus.SKIPPED, error: MERGE_CONFLICT_SKIP_REASON }), makeStubItem({ prNumber: 701, status: MergeItemStatus.SKIPPED, error: MERGE_CONFLICT_SKIP_REASON })];
    await p.runAutoResolve();
  } finally {
    MERGE_QUEUE_CONFIG.AUTO_RESOLVE_POLL_INTERVAL_MS = ORIGINAL_POLL;
    MERGE_QUEUE_CONFIG.STOP_ON_POST_MERGE_CI_FAILURE = originalStop;
  }
  assert.deepEqual(spawned, [700], 'must not spawn next PR after CI failure');
  assert.equal(p.items[0].status, MergeItemStatus.MERGED, 'first PR is merged even though its CI failed');
  assert.equal(p.items[1].status, MergeItemStatus.SKIPPED, 'second PR never started');
  assert.ok(Array.isArray(p.postMergeCIFailedRuns), 'failed runs recorded for the final report');
});

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Test Results: ${testsPassed} passed, ${testsFailed} failed\n`);

if (testsFailed > 0) {
  process.exit(1);
}
