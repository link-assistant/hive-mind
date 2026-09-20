#!/usr/bin/env node
/**
 * Merge Queue Tests - Issue #2013
 *
 * Covers `/merge` support for replying to messages that contain issue/PR
 * links and waiting for unfinished PRs to become mergeable instead of
 * skipping them immediately.
 *
 * Run with: node tests/test-merge-targets-2013.mjs
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2013
 */

import assert from 'node:assert/strict';
import { extractMergeTargetUrlFromText, parseMergeTargetUrl } from '../src/github-merge-targets.lib.mjs';
import { shouldIgnoreMergeCommand } from '../src/telegram-merge-command.lib.mjs';
import { MergeItemStatus, MergeQueueProcessor, MERGE_CONFLICT_SKIP_REASON } from '../src/telegram-merge-queue.lib.mjs';

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

function makeStubItem(overrides = {}) {
  return {
    pr: {
      number: overrides.prNumber ?? 42,
      title: overrides.title ?? 'Finish merge command',
      url: overrides.prUrl ?? 'https://github.com/owner/repo/pull/42',
      createdAt: new Date().toISOString(),
    },
    issue: overrides.issue ?? null,
    status: overrides.status ?? MergeItemStatus.PENDING,
    error: overrides.error ?? null,
    ciStatus: null,
    startedAt: null,
    completedAt: null,
    mergeCommitSha: null,
    getDescription() {
      const issueRef = this.issue ? ` (Issue #${this.issue.number})` : '';
      return `PR #${this.pr.number}: ${this.pr.title}${issueRef}`;
    },
  };
}

console.log('\n📋 Issue #2013: /merge issue and PR targets\n');

test('Issue #2013: parseMergeTargetUrl accepts issue URLs', () => {
  const result = parseMergeTargetUrl('https://github.com/link-assistant/formal-ai/issues/621');

  assert.equal(result.valid, true);
  assert.equal(result.mode, 'issue');
  assert.equal(result.owner, 'link-assistant');
  assert.equal(result.repo, 'formal-ai');
  assert.equal(result.issueNumber, 621);
});

test('Issue #2013: parseMergeTargetUrl accepts pull request URLs', () => {
  const result = parseMergeTargetUrl('https://github.com/link-assistant/formal-ai/pull/622');

  assert.equal(result.valid, true);
  assert.equal(result.mode, 'pull');
  assert.equal(result.owner, 'link-assistant');
  assert.equal(result.repo, 'formal-ai');
  assert.equal(result.prNumber, 622);
});

test('Issue #2013: reply extraction finds one issue link in a /codex message', () => {
  const text = '/codex https://github.com/link-assistant/formal-ai/issues/621 --think max';
  const result = extractMergeTargetUrlFromText(text);

  assert.equal(result.valid, true);
  assert.equal(result.url, 'https://github.com/link-assistant/formal-ai/issues/621');
  assert.equal(result.target.mode, 'issue');
  assert.equal(result.target.issueNumber, 621);
});

test('Issue #2013: /merge ignores forwards but allows replies', () => {
  const replyCtx = {
    message: {
      message_id: 10,
      reply_to_message: { message_id: 9, text: '/codex https://github.com/o/r/issues/1' },
    },
  };
  const forwardCtx = {
    message: {
      message_id: 11,
      forward_origin: { type: 'user' },
    },
  };
  const filters = {
    isOldMessage: () => false,
    isForwarded: ctx => Boolean(ctx.message.forward_origin),
    isForwardedOrReply: ctx => Boolean(ctx.message.forward_origin || ctx.message.reply_to_message),
  };

  assert.equal(shouldIgnoreMergeCommand(replyCtx, filters), false);
  assert.equal(shouldIgnoreMergeCommand(forwardCtx, filters), true);
});

await asyncTest('Issue #2013: initialize waits for a PR to appear for an issue target', async () => {
  const target = {
    mode: 'issue',
    owner: 'owner',
    repo: 'repo',
    issueNumber: 7,
    url: 'https://github.com/owner/repo/issues/7',
  };
  const calls = [];
  const processor = new MergeQueueProcessor({
    owner: 'owner',
    repo: 'repo',
    target,
    ensureReadyLabel: async () => ({ success: true, created: false }),
    resolveMergeTargetItems: async () => {
      calls.push('resolve');
      if (calls.length === 1) return [];
      return [
        {
          pr: {
            number: 8,
            title: 'Fix issue 7',
            url: 'https://github.com/owner/repo/pull/8',
            createdAt: new Date().toISOString(),
          },
          issue: { number: 7, url: target.url },
          sortDate: new Date(),
        },
      ];
    },
    targetItemsTimeoutMs: 1,
    targetItemsPollIntervalMs: 1,
  });
  processor.sleep = async () => {};

  const result = await processor.initialize();

  assert.equal(result.success, true);
  assert.equal(result.count, 1);
  assert.equal(processor.items.length, 1);
  assert.equal(processor.items[0].pr.number, 8);
  assert.equal(calls.length, 2);
});

await asyncTest('Issue #2013: processItem waits for an unfinished PR before merging it', async () => {
  const item = makeStubItem();
  const mergeabilityChecks = [
    { mergeable: false, terminal: false, reason: 'PR is a draft' },
    { mergeable: true, terminal: false, reason: null },
  ];
  const calls = [];
  const processor = new MergeQueueProcessor({
    owner: 'owner',
    repo: 'repo',
    checkPRMergeable: async () => {
      calls.push('mergeable');
      return mergeabilityChecks.shift();
    },
    checkPRCIStatus: async () => {
      calls.push('ci');
      return { status: 'success', checks: [] };
    },
    mergePullRequest: async () => {
      calls.push('merge');
      return { success: true };
    },
    getMergeCommitSha: async () => ({ sha: 'abc1234567890' }),
    closeLinkedIssueIfNotAutoClosed: async () => ({ closed: false }),
  });
  processor.sleep = async () => {};

  await processor.processItem(item);

  assert.equal(item.status, MergeItemStatus.MERGED);
  assert.equal(processor.stats.merged, 1);
  assert.equal(processor.stats.skipped, 0);
  assert.deepEqual(calls, ['mergeable', 'mergeable', 'ci', 'merge']);
});

await asyncTest('Issue #2013: processItem still skips conflicted PRs for auto-resolve', async () => {
  const item = makeStubItem();
  const processor = new MergeQueueProcessor({
    owner: 'owner',
    repo: 'repo',
    checkPRMergeable: async () => ({ mergeable: false, terminal: false, reason: MERGE_CONFLICT_SKIP_REASON }),
  });

  await processor.processItem(item);

  assert.equal(item.status, MergeItemStatus.SKIPPED);
  assert.equal(item.error, MERGE_CONFLICT_SKIP_REASON);
  assert.equal(processor.stats.skipped, 1);
});

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Test Results: ${testsPassed} passed, ${testsFailed} failed\n`);

if (testsFailed > 0) {
  process.exit(1);
}
