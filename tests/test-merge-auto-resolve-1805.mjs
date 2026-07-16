#!/usr/bin/env node
/**
 * Merge Queue Tests — Issue #1805
 *
 * Covers the `--auto-resolve` flag added to the `/merge` Telegram command and
 * the clickable PR/issue links rendered in progress and final messages.
 *
 * Run with: node tests/test-merge-auto-resolve-1805.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1805
 */

import assert from 'node:assert/strict';
import { MergeStatus, MergeItemStatus, MergeQueueProcessor, MERGE_CONFLICT_SKIP_REASON } from '../src/telegram-merge-queue.lib.mjs';
import { parseMergeArgs } from '../src/telegram-merge-command.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

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

console.log('\n📋 Issue #1805: --auto-resolve and clickable PR links\n');

function makeStubItem(overrides = {}) {
  const base = {
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
      const issueRef = this.issue ? ` (Issue #${this.issue.number})` : '';
      return `PR #${this.pr.number}: ${this.pr.title}${issueRef}`;
    },
  };
  return base;
}

test('Issue #1805: MergeItemStatus exposes RESOLVING and RESOLVE_FAILED', () => {
  assert.equal(MergeItemStatus.RESOLVING, 'resolving', 'RESOLVING value');
  assert.equal(MergeItemStatus.RESOLVE_FAILED, 'resolve_failed', 'RESOLVE_FAILED value');
});

test('Issue #1805: MERGE_CONFLICT_SKIP_REASON matches the github-merge reason text', () => {
  // The constant has to match the literal string `checkPRMergeable()` returns
  // for DIRTY PRs; tests in this file already use that exact string.
  assert.equal(MERGE_CONFLICT_SKIP_REASON, 'PR has merge conflicts');
});

test('Issue #1805: constructor accepts autoResolve and spawnSolveSession', () => {
  const spawn = () => ({ success: true });
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r', autoResolve: true, spawnSolveSession: spawn });
  assert.equal(p.autoResolve, true, 'autoResolve should be flagged on');
  assert.equal(p.spawnSolveSession, spawn, 'spawnSolveSession should be stored');
  assert.equal(p.stats.autoResolved, 0);
  assert.equal(p.stats.autoResolveFailed, 0);
});

test('Issue #1805: constructor defaults autoResolve to false', () => {
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r' });
  assert.equal(p.autoResolve, false);
  assert.equal(p.spawnSolveSession, null);
});

test('Issue #1805: getConflictedItems returns only SKIPPED + merge-conflict items', () => {
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r' });
  p.items = [makeStubItem({ prNumber: 1, status: MergeItemStatus.SKIPPED, error: MERGE_CONFLICT_SKIP_REASON }), makeStubItem({ prNumber: 2, status: MergeItemStatus.SKIPPED, error: 'Cancelled' }), makeStubItem({ prNumber: 3, status: MergeItemStatus.FAILED, error: 'CI failed' }), makeStubItem({ prNumber: 4, status: MergeItemStatus.MERGED }), makeStubItem({ prNumber: 5, status: MergeItemStatus.SKIPPED, error: MERGE_CONFLICT_SKIP_REASON })];
  const conflicted = p.getConflictedItems();
  assert.equal(conflicted.length, 2, 'should match only conflict-skipped items');
  assert.equal(conflicted[0].pr.number, 1);
  assert.equal(conflicted[1].pr.number, 5);
});

await asyncTest('Issue #1805: runAutoResolve dispatches each conflicted PR exactly once', async () => {
  const calls = [];
  const spawn = async target => {
    calls.push(target);
    return { success: true, sessionName: `session-${target.prNumber}` };
  };
  // Issue #1807: the queue now waits for each spawned session to actually
  // land its PR. Stub `getPRStatus` so the wait resolves immediately as
  // MERGED instead of polling the real gh CLI.
  const getPRStatus = async () => ({ state: 'MERGED', mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', error: null });
  const getMergeCommitSha = async () => ({ sha: 'deadbeefdeadbeef', error: null });
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r', autoResolve: true, spawnSolveSession: spawn, getPRStatus, getMergeCommitSha });
  p.items = [makeStubItem({ prNumber: 1, status: MergeItemStatus.SKIPPED, error: MERGE_CONFLICT_SKIP_REASON }), makeStubItem({ prNumber: 2, status: MergeItemStatus.MERGED }), makeStubItem({ prNumber: 3, status: MergeItemStatus.SKIPPED, error: MERGE_CONFLICT_SKIP_REASON })];
  // Issue #1807: skip the post-merge CI wait — exercised in dedicated tests.
  p.waitForPostMergeCI = async () => ({ success: true, failedRuns: [], error: null });
  // Pretend the conflicted PRs were tallied as skipped during the main loop,
  // so we can verify runAutoResolve decrements that count on merge.
  p.stats.skipped = 2;
  // Speed up: avoid the real 5s post-merge sleep before fetching SHA.
  p.sleep = async () => undefined;
  await p.runAutoResolve();
  assert.equal(calls.length, 2, 'spawner should be called for both conflict items');
  assert.equal(calls[0].prNumber, 1);
  assert.equal(calls[1].prNumber, 3);
  // Issue #1807: autoResolved is now bumped only when the PR actually merges.
  assert.equal(p.stats.autoResolved, 2, 'stats.autoResolved bumped twice after merge');
  assert.equal(p.stats.autoResolveFailed, 0);
  assert.equal(p.items[0].autoResolveSession, 'session-1');
  assert.equal(p.items[2].autoResolveSession, 'session-3');
  assert.equal(p.items[0].status, MergeItemStatus.MERGED, 'PR #1 should be MERGED after auto-resolve');
  assert.equal(p.items[2].status, MergeItemStatus.MERGED, 'PR #3 should be MERGED after auto-resolve');
  assert.equal(p.autoResolveActive, false, 'flag should reset after the pass');
  assert.equal(p.autoResolveCurrent, null);
  assert.equal(p.autoResolvePhase, null);
});

await asyncTest('Issue #1805: runAutoResolve marks RESOLVE_FAILED when no spawner is provided', async () => {
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r', autoResolve: true });
  p.items = [makeStubItem({ prNumber: 11, status: MergeItemStatus.SKIPPED, error: MERGE_CONFLICT_SKIP_REASON })];
  await p.runAutoResolve();
  assert.equal(p.items[0].status, MergeItemStatus.RESOLVE_FAILED);
  assert.equal(p.stats.autoResolveFailed, 1);
  assert.equal(p.stats.autoResolved, 0);
});

await asyncTest('Issue #1805: runAutoResolve records errors when the spawner rejects', async () => {
  const spawn = async () => {
    throw new Error('start-screen missing');
  };
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r', autoResolve: true, spawnSolveSession: spawn });
  p.items = [makeStubItem({ prNumber: 21, status: MergeItemStatus.SKIPPED, error: MERGE_CONFLICT_SKIP_REASON })];
  await p.runAutoResolve();
  assert.equal(p.items[0].status, MergeItemStatus.RESOLVE_FAILED);
  assert.equal(p.items[0].autoResolveError, 'start-screen missing');
  assert.equal(p.stats.autoResolveFailed, 1);
});

await asyncTest('Issue #1805: runAutoResolve records warning when the spawner returns success=false', async () => {
  const spawn = async () => ({ success: false, error: 'screen exited 1' });
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r', autoResolve: true, spawnSolveSession: spawn });
  p.items = [makeStubItem({ prNumber: 31, status: MergeItemStatus.SKIPPED, error: MERGE_CONFLICT_SKIP_REASON })];
  await p.runAutoResolve();
  assert.equal(p.items[0].status, MergeItemStatus.RESOLVE_FAILED);
  assert.equal(p.items[0].autoResolveError, 'screen exited 1');
  assert.equal(p.stats.autoResolveFailed, 1);
});

await asyncTest('Issue #1805: runAutoResolve stops mid-pass when cancelled', async () => {
  const calls = [];
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r', autoResolve: true });
  const spawn = async target => {
    calls.push(target.prNumber);
    p.isCancelled = true; // cancel after the first dispatch
    return { success: true };
  };
  p.spawnSolveSession = spawn;
  // Issue #1807: stub getPRStatus so the wait loop exits quickly on cancel
  // (it checks cancellation before its first poll anyway).
  p.getPRStatus = async () => ({ state: 'OPEN', mergeStateStatus: 'DIRTY', mergeable: 'CONFLICTING', error: null });
  p.items = [makeStubItem({ prNumber: 41, status: MergeItemStatus.SKIPPED, error: MERGE_CONFLICT_SKIP_REASON }), makeStubItem({ prNumber: 42, status: MergeItemStatus.SKIPPED, error: MERGE_CONFLICT_SKIP_REASON })];
  await p.runAutoResolve();
  assert.equal(calls.length, 1, 'second dispatch should be skipped');
  // Issue #1807: the cancel happens before the first PR finishes merging, so
  // autoResolved must stay 0 — the resolution wasn't completed.
  assert.equal(p.stats.autoResolved, 0, 'autoResolved is only bumped after a successful merge');
});

test('Issue #1805: escapeMarkdownLinkUrl escapes only ) and backslash', () => {
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r' });
  assert.equal(p.escapeMarkdownLinkUrl('https://example.com/path'), 'https://example.com/path');
  assert.equal(p.escapeMarkdownLinkUrl('https://example.com/(p)ath'), 'https://example.com/(p\\)ath');
  assert.equal(p.escapeMarkdownLinkUrl('a\\b)c'), 'a\\\\b\\)c');
});

test('Issue #1805: formatPrLink emits a clickable MarkdownV2 link', () => {
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r' });
  const out = p.formatPrLink(42, 'Fix bug', 'https://github.com/owner/repo/pull/42');
  // Label: `\#42: Fix bug` (Fix bug has no specials so it survives escaping verbatim)
  assert.ok(out.startsWith('[\\#42: Fix bug]('), `expected MarkdownV2 link prefix, got: ${out}`);
  assert.ok(out.endsWith(')'), 'expected closing paren');
  assert.ok(out.includes('https://github.com/owner/repo/pull/42'), 'should keep URL intact');
});

test('Issue #1805: formatPrLink truncates long titles and escapes ellipsis', () => {
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r' });
  const longTitle = 'a'.repeat(80);
  const out = p.formatPrLink(7, longTitle, 'https://example.com/pull/7');
  assert.ok(out.endsWith('\\.\\.\\.](https://example.com/pull/7)'), `expected escaped ellipsis suffix in: ${out}`);
});

test('Issue #1805: formatPrLink falls back to escaped plain text without a URL', () => {
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r' });
  const out = p.formatPrLink(5, 'Title', null);
  assert.equal(out, '\\#5: Title', 'no brackets/url means plain escaped text');
});

test('Issue #1805: formatPrLink without title still emits the bare number', () => {
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r' });
  const out = p.formatPrLink(8, '', 'https://example.com/pull/8');
  assert.equal(out, '[\\#8](https://example.com/pull/8)');
});

test('Issue #1805: formatIssueRef renders a clickable issue suffix', () => {
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r' });
  const out = p.formatIssueRef(99, 'https://github.com/owner/repo/issues/99');
  assert.equal(out, ' \\([Issue \\#99](https://github.com/owner/repo/issues/99)\\)');
});

test('Issue #1805: formatIssueRef returns empty string when no issue is linked', () => {
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r' });
  assert.equal(p.formatIssueRef(null, null), '');
});

test('Issue #1805: formatProgressMessage Queue contains clickable PR links', () => {
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r' });
  p.items = [makeStubItem({ prNumber: 314, title: 'Pi', prUrl: 'https://github.com/owner/repo/pull/314', status: MergeItemStatus.PENDING })];
  p.stats.total = 1;
  const msg = p.formatProgressMessage();
  assert.ok(msg.includes('[\\#314: Pi](https://github.com/owner/repo/pull/314)'), `expected link in queue: ${msg}`);
});

test('Issue #1805: formatFinalMessage Results section emits links and issue ref links', () => {
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r' });
  p.items = [
    makeStubItem({
      prNumber: 200,
      title: 'Merged item',
      prUrl: 'https://github.com/owner/repo/pull/200',
      issue: { number: 199, url: 'https://github.com/owner/repo/issues/199' },
      status: MergeItemStatus.MERGED,
    }),
  ];
  p.stats.total = 1;
  p.stats.merged = 1;
  p.startedAt = new Date();
  p.completedAt = new Date();
  p.status = MergeStatus.COMPLETED;
  const msg = p.formatFinalMessage();
  assert.ok(msg.includes('[\\#200: Merged item](https://github.com/owner/repo/pull/200)'), `PR link missing: ${msg}`);
  assert.ok(msg.includes('[Issue \\#199](https://github.com/owner/repo/issues/199)'), `Issue link missing: ${msg}`);
});

test('Issue #1805: formatFinalMessage shows auto-resolve summary when enabled', () => {
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r', autoResolve: true, spawnSolveSession: async () => ({ success: true }) });
  p.items = [];
  p.stats.total = 0;
  p.stats.autoResolved = 3;
  p.stats.autoResolveFailed = 1;
  p.startedAt = new Date();
  p.completedAt = new Date();
  p.status = MergeStatus.COMPLETED;
  const msg = p.formatFinalMessage();
  assert.ok(msg.includes('Auto\\-resolve dispatched: 3'), `expected dispatched count, got: ${msg}`);
  assert.ok(msg.includes('Auto\\-resolve failed: 1'), `expected failed count, got: ${msg}`);
});

test('Issue #1805: formatFinalMessage omits auto-resolve summary when not enabled', () => {
  const p = new MergeQueueProcessor({ owner: 'o', repo: 'r' });
  p.items = [];
  p.stats.total = 0;
  p.startedAt = new Date();
  p.completedAt = new Date();
  p.status = MergeStatus.COMPLETED;
  const msg = p.formatFinalMessage();
  assert.ok(!msg.includes('Auto\\-resolve'), 'no auto-resolve summary when flag is off');
});

test('Issue #1805: parseMergeArgs accepts --auto-resolve', () => {
  const out = parseMergeArgs(['https://github.com/owner/repo', '--auto-resolve']);
  assert.deepEqual(out.positionals, ['https://github.com/owner/repo']);
  assert.equal(out.flags['auto-resolve'], true);
});

test('Issue #1805: parseMergeArgs accepts --auto-resolve=true|false', () => {
  assert.equal(parseMergeArgs(['url', '--auto-resolve=true']).flags['auto-resolve'], true);
  assert.equal(parseMergeArgs(['url', '--auto-resolve=false']).flags['auto-resolve'], false);
  assert.equal(parseMergeArgs(['url', '--auto-resolve=0']).flags['auto-resolve'], false);
  assert.equal(parseMergeArgs(['url', '--auto-resolve=no']).flags['auto-resolve'], false);
});

test('Issue #1805: parseMergeArgs accepts --no-auto-resolve', () => {
  const out = parseMergeArgs(['url', '--no-auto-resolve']);
  assert.equal(out.flags['auto-resolve'], false);
});

test('Issue #1805: parseMergeArgs preserves positional ordering with flags interleaved', () => {
  const out = parseMergeArgs(['--auto-resolve', 'https://example.com', 'extra']);
  assert.deepEqual(out.positionals, ['https://example.com', 'extra']);
  assert.equal(out.flags['auto-resolve'], true);
});

test('Issue #1805: parseMergeArgs returns empty results for empty input', () => {
  const out = parseMergeArgs([]);
  assert.deepEqual(out.positionals, []);
  assert.deepEqual(out.flags, {});
});

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Test Results: ${testsPassed} passed, ${testsFailed} failed\n`);

if (testsFailed > 0) {
  process.exit(1);
}
