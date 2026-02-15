#!/usr/bin/env node
/**
 * Merge Queue Unit Tests
 *
 * Test suite for the github-merge.lib.mjs and telegram-merge-queue.lib.mjs modules.
 * Tests URL parsing, label operations, queue processing, and edge cases.
 *
 * Run with: node tests/test-merge-queue.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1143
 */

import assert from 'node:assert/strict';
import { parseRepositoryUrl, READY_LABEL } from '../src/github-merge.lib.mjs';
import { MergeStatus, MergeItemStatus, MERGE_QUEUE_CONFIG, MergeQueueProcessor } from '../src/telegram-merge-queue.lib.mjs';

// Test utilities
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

// ============================================================================
// Configuration Tests
// ============================================================================

console.log('\n📋 Configuration Tests\n');

test('READY_LABEL has correct structure', () => {
  assert.ok(READY_LABEL.name !== undefined, 'READY_LABEL.name should be defined');
  assert.ok(READY_LABEL.description !== undefined, 'READY_LABEL.description should be defined');
  assert.ok(READY_LABEL.color !== undefined, 'READY_LABEL.color should be defined');
  assert.equal(READY_LABEL.name, 'ready', 'READY_LABEL.name should be "ready"');
});

test('MERGE_QUEUE_CONFIG has all required fields', () => {
  assert.ok(MERGE_QUEUE_CONFIG.CI_POLL_INTERVAL_MS !== undefined, 'CI_POLL_INTERVAL_MS should be defined');
  assert.ok(MERGE_QUEUE_CONFIG.CI_TIMEOUT_MS !== undefined, 'CI_TIMEOUT_MS should be defined');
  assert.ok(MERGE_QUEUE_CONFIG.POST_MERGE_WAIT_MS !== undefined, 'POST_MERGE_WAIT_MS should be defined');
  assert.ok(MERGE_QUEUE_CONFIG.MESSAGE_UPDATE_INTERVAL_MS !== undefined, 'MESSAGE_UPDATE_INTERVAL_MS should be defined');
  assert.ok(MERGE_QUEUE_CONFIG.MAX_PRS_PER_SESSION !== undefined, 'MAX_PRS_PER_SESSION should be defined');
});

test('MERGE_QUEUE_CONFIG values are reasonable', () => {
  // CI polling should be at least 1 minute (default is 5 minutes per issue #1143)
  assert.ok(MERGE_QUEUE_CONFIG.CI_POLL_INTERVAL_MS >= 60000, 'CI_POLL_INTERVAL_MS should be at least 1 minute');
  assert.ok(MERGE_QUEUE_CONFIG.CI_TIMEOUT_MS >= 60000, 'CI_TIMEOUT_MS should be at least 1 minute');
  assert.ok(MERGE_QUEUE_CONFIG.POST_MERGE_WAIT_MS >= 1000, 'POST_MERGE_WAIT_MS should be at least 1 second');
  assert.ok(MERGE_QUEUE_CONFIG.MAX_PRS_PER_SESSION >= 1, 'MAX_PRS_PER_SESSION should be at least 1');
  // Default is 10, but allow up to 100 via ENV configuration
  assert.ok(MERGE_QUEUE_CONFIG.MAX_PRS_PER_SESSION <= 100, 'MAX_PRS_PER_SESSION should be at most 100');
});

// ============================================================================
// Status Enum Tests
// ============================================================================

console.log('\n📋 Status Enum Tests\n');

test('MergeStatus has all required values', () => {
  assert.ok(MergeStatus.IDLE !== undefined, 'MergeStatus.IDLE should be defined');
  assert.ok(MergeStatus.RUNNING !== undefined, 'MergeStatus.RUNNING should be defined');
  assert.ok(MergeStatus.PAUSED !== undefined, 'MergeStatus.PAUSED should be defined');
  assert.ok(MergeStatus.COMPLETED !== undefined, 'MergeStatus.COMPLETED should be defined');
  assert.ok(MergeStatus.FAILED !== undefined, 'MergeStatus.FAILED should be defined');
  assert.ok(MergeStatus.CANCELLED !== undefined, 'MergeStatus.CANCELLED should be defined');
});

test('MergeItemStatus has all required values', () => {
  assert.ok(MergeItemStatus.PENDING !== undefined, 'MergeItemStatus.PENDING should be defined');
  assert.ok(MergeItemStatus.CHECKING_CI !== undefined, 'MergeItemStatus.CHECKING_CI should be defined');
  assert.ok(MergeItemStatus.WAITING_CI !== undefined, 'MergeItemStatus.WAITING_CI should be defined');
  assert.ok(MergeItemStatus.READY_TO_MERGE !== undefined, 'MergeItemStatus.READY_TO_MERGE should be defined');
  assert.ok(MergeItemStatus.MERGING !== undefined, 'MergeItemStatus.MERGING should be defined');
  assert.ok(MergeItemStatus.MERGED !== undefined, 'MergeItemStatus.MERGED should be defined');
  assert.ok(MergeItemStatus.FAILED !== undefined, 'MergeItemStatus.FAILED should be defined');
  assert.ok(MergeItemStatus.SKIPPED !== undefined, 'MergeItemStatus.SKIPPED should be defined');
});

// ============================================================================
// URL Parsing Tests
// ============================================================================

console.log('\n📋 URL Parsing Tests\n');

test('parseRepositoryUrl accepts valid repository URLs', () => {
  const result = parseRepositoryUrl('https://github.com/owner/repo');
  assert.ok(result.valid, 'Should accept valid repo URL');
  assert.equal(result.owner, 'owner', 'Should extract owner');
  assert.equal(result.repo, 'repo', 'Should extract repo');
  assert.equal(result.error, null, 'Should have no error');
});

test('parseRepositoryUrl accepts issues list URLs', () => {
  const result = parseRepositoryUrl('https://github.com/owner/repo/issues');
  assert.ok(result.valid, 'Should accept issues list URL');
  assert.equal(result.owner, 'owner', 'Should extract owner');
  assert.equal(result.repo, 'repo', 'Should extract repo');
});

test('parseRepositoryUrl accepts pulls list URLs', () => {
  const result = parseRepositoryUrl('https://github.com/owner/repo/pulls');
  assert.ok(result.valid, 'Should accept pulls list URL');
  assert.equal(result.owner, 'owner', 'Should extract owner');
  assert.equal(result.repo, 'repo', 'Should extract repo');
});

test('parseRepositoryUrl rejects user/organization URLs', () => {
  const result = parseRepositoryUrl('https://github.com/owner');
  assert.ok(!result.valid, 'Should reject user URL');
  assert.ok(result.error.includes('user/organization'), 'Should mention user/organization in error');
});

test('parseRepositoryUrl rejects issue URLs', () => {
  const result = parseRepositoryUrl('https://github.com/owner/repo/issues/123');
  assert.ok(!result.valid, 'Should reject issue URL');
  assert.ok(result.error.includes('not supported'), 'Should mention unsupported in error');
});

test('parseRepositoryUrl rejects PR URLs', () => {
  const result = parseRepositoryUrl('https://github.com/owner/repo/pull/123');
  assert.ok(!result.valid, 'Should reject PR URL');
  assert.ok(result.error.includes('not supported'), 'Should mention unsupported in error');
});

test('parseRepositoryUrl handles URLs without https', () => {
  const result = parseRepositoryUrl('github.com/owner/repo');
  assert.ok(result.valid, 'Should accept URL without https');
  assert.equal(result.owner, 'owner', 'Should extract owner');
  assert.equal(result.repo, 'repo', 'Should extract repo');
});

test('parseRepositoryUrl handles shorthand format', () => {
  const result = parseRepositoryUrl('owner/repo');
  assert.ok(result.valid, 'Should accept shorthand format');
  assert.equal(result.owner, 'owner', 'Should extract owner');
  assert.equal(result.repo, 'repo', 'Should extract repo');
});

test('parseRepositoryUrl rejects empty input', () => {
  const result = parseRepositoryUrl('');
  assert.ok(!result.valid, 'Should reject empty input');
});

test('parseRepositoryUrl rejects null input', () => {
  const result = parseRepositoryUrl(null);
  assert.ok(!result.valid, 'Should reject null input');
});

test('parseRepositoryUrl rejects non-GitHub URLs', () => {
  const result = parseRepositoryUrl('https://gitlab.com/owner/repo');
  assert.ok(!result.valid, 'Should reject non-GitHub URL');
});

// ============================================================================
// MergeQueueProcessor Tests
// ============================================================================

console.log('\n📋 MergeQueueProcessor Tests\n');

test('MergeQueueProcessor initializes with correct defaults', () => {
  const processor = new MergeQueueProcessor({
    owner: 'test-owner',
    repo: 'test-repo',
  });

  assert.equal(processor.owner, 'test-owner', 'Should set owner');
  assert.equal(processor.repo, 'test-repo', 'Should set repo');
  assert.equal(processor.verbose, false, 'Should default verbose to false');
  assert.equal(processor.status, MergeStatus.IDLE, 'Should start in IDLE status');
  assert.equal(processor.items.length, 0, 'Should start with empty items');
  assert.equal(processor.isCancelled, false, 'Should not be cancelled initially');
});

test('MergeQueueProcessor initializes with verbose option', () => {
  const processor = new MergeQueueProcessor({
    owner: 'test-owner',
    repo: 'test-repo',
    verbose: true,
  });

  assert.equal(processor.verbose, true, 'Should respect verbose option');
});

test('MergeQueueProcessor cancel sets isCancelled flag', () => {
  const processor = new MergeQueueProcessor({
    owner: 'test-owner',
    repo: 'test-repo',
  });

  processor.cancel();
  assert.ok(processor.isCancelled, 'Should set isCancelled to true');
});

test('MergeQueueProcessor getProgressUpdate returns valid structure', () => {
  const processor = new MergeQueueProcessor({
    owner: 'test-owner',
    repo: 'test-repo',
  });

  const update = processor.getProgressUpdate();

  assert.ok(update.status !== undefined, 'Should have status');
  assert.ok(update.progress !== undefined, 'Should have progress');
  assert.ok(update.stats !== undefined, 'Should have stats');
  assert.ok(update.items !== undefined, 'Should have items');
  assert.ok(update.progress.processed !== undefined, 'Should have processed count');
  assert.ok(update.progress.total !== undefined, 'Should have total count');
  assert.ok(update.progress.percentage !== undefined, 'Should have percentage');
});

test('MergeQueueProcessor getFinalReport returns valid structure', () => {
  const processor = new MergeQueueProcessor({
    owner: 'test-owner',
    repo: 'test-repo',
  });

  const report = processor.getFinalReport();

  assert.ok(report.status !== undefined, 'Should have status');
  assert.ok(report.duration !== undefined, 'Should have duration');
  assert.ok(report.stats !== undefined, 'Should have stats');
  assert.ok(report.items !== undefined, 'Should have items');
  assert.ok(report.stats.total !== undefined, 'Should have total count');
  assert.ok(report.stats.merged !== undefined, 'Should have merged count');
  assert.ok(report.stats.failed !== undefined, 'Should have failed count');
  assert.ok(report.stats.skipped !== undefined, 'Should have skipped count');
});

test('MergeQueueProcessor escapeMarkdown escapes special characters', () => {
  const processor = new MergeQueueProcessor({
    owner: 'test-owner',
    repo: 'test-repo',
  });

  const input = 'Test *bold* _italic_ `code` [link](url)';
  const escaped = processor.escapeMarkdown(input);

  assert.ok(!escaped.includes('*') || escaped.includes('\\*'), 'Should escape asterisk');
  assert.ok(!escaped.includes('_') || escaped.includes('\\_'), 'Should escape underscore');
  assert.ok(!escaped.includes('`') || escaped.includes('\\`'), 'Should escape backtick');
  assert.ok(!escaped.includes('[') || escaped.includes('\\['), 'Should escape bracket');
});

test('MergeQueueProcessor formatProgressMessage returns string', () => {
  const processor = new MergeQueueProcessor({
    owner: 'testowner',
    repo: 'testrepo',
  });

  const message = processor.formatProgressMessage();

  assert.equal(typeof message, 'string', 'Should return a string');
  assert.ok(message.length > 0, 'Should not be empty');
  assert.ok(message.includes('testowner'), 'Should include owner');
  assert.ok(message.includes('testrepo'), 'Should include repo');
});

test('MergeQueueProcessor formatFinalMessage returns string', () => {
  const processor = new MergeQueueProcessor({
    owner: 'testowner',
    repo: 'testrepo',
  });

  const message = processor.formatFinalMessage();

  assert.equal(typeof message, 'string', 'Should return a string');
  assert.ok(message.length > 0, 'Should not be empty');
  assert.ok(message.includes('testowner'), 'Should include owner');
  assert.ok(message.includes('testrepo'), 'Should include repo');
});

// Issue #1269: Test error display in progress message
test('MergeQueueProcessor formatProgressMessage shows errors inline', () => {
  const processor = new MergeQueueProcessor({
    owner: 'test-owner',
    repo: 'test-repo',
  });

  // Simulate adding a failed item with all required methods
  processor.items = [
    {
      pr: { number: 123, title: 'Test PR', createdAt: new Date().toISOString() },
      issue: null,
      status: MergeItemStatus.FAILED,
      error: 'CI checks failed',
      getStatusEmoji: () => '❌',
      getDescription: () => 'PR #123: Test PR',
    },
  ];
  processor.stats.total = 1;
  processor.stats.failed = 1;

  const message = processor.formatProgressMessage();

  assert.equal(typeof message, 'string', 'Should return a string');
  // Issue #1294: Changed from "Errors" to "Issues" to include both failed and skipped items
  assert.ok(message.includes('Issues'), 'Should include Issues section for failed items');
  assert.ok(message.includes('CI checks failed'), 'Should include the error message');
  assert.ok(message.includes('123'), 'Should include the PR number');
});

test('MergeQueueProcessor formatProgressMessage hides errors section when no failures', () => {
  const processor = new MergeQueueProcessor({
    owner: 'test-owner',
    repo: 'test-repo',
  });

  // Simulate adding a successful item with all required methods
  processor.items = [
    {
      pr: { number: 456, title: 'Successful PR', createdAt: new Date().toISOString() },
      issue: null,
      status: MergeItemStatus.MERGED,
      error: null,
      getStatusEmoji: () => '✅',
      getDescription: () => 'PR #456: Successful PR',
    },
  ];
  processor.stats.total = 1;
  processor.stats.merged = 1;

  const message = processor.formatProgressMessage();

  assert.equal(typeof message, 'string', 'Should return a string');
  // Issue #1294: Changed from "Errors" to "Issues"
  assert.ok(!message.includes('⚠️ *Issues:*'), 'Should not include Issues section when no failures');
});

// ============================================================================
// Issue #1294: Skip Reason Display Tests
// ============================================================================

console.log('\n📋 Issue #1294: Skip Reason Display Tests\n');

test('MergeQueueProcessor formatProgressMessage shows skipped items with reasons', () => {
  const processor = new MergeQueueProcessor({
    owner: 'test-owner',
    repo: 'test-repo',
  });

  // Simulate adding a skipped item with all required methods
  processor.items = [
    {
      pr: { number: 1241, title: 'Skipped PR', createdAt: new Date().toISOString() },
      issue: { number: 1240 },
      status: MergeItemStatus.SKIPPED,
      error: 'PR has merge conflicts',
      getStatusEmoji: () => '⏭️',
      getDescription: () => 'PR #1241: Skipped PR (Issue #1240)',
    },
  ];
  processor.stats.total = 1;
  processor.stats.skipped = 1;

  const message = processor.formatProgressMessage();

  assert.equal(typeof message, 'string', 'Should return a string');
  assert.ok(message.includes('Issues'), 'Should include Issues section for skipped items');
  assert.ok(message.includes('PR has merge conflicts'), 'Should include the skip reason');
  assert.ok(message.includes('1241'), 'Should include the PR number');
});

test('MergeQueueProcessor formatFinalMessage shows skip reasons in results', () => {
  const processor = new MergeQueueProcessor({
    owner: 'link-assistant',
    repo: 'hive-mind',
  });

  // Simulate completed queue with skipped items
  processor.status = MergeStatus.COMPLETED;
  processor.items = [
    {
      pr: { number: 1241, title: 'Skipped PR 1', createdAt: new Date().toISOString() },
      issue: { number: 1240 },
      status: MergeItemStatus.SKIPPED,
      error: 'PR has merge conflicts',
      getStatusEmoji: () => '⏭️',
      getDescription: () => 'PR #1241: Skipped PR 1 (Issue #1240)',
    },
    {
      pr: { number: 1257, title: 'Skipped PR 2', createdAt: new Date().toISOString() },
      issue: { number: 1256 },
      status: MergeItemStatus.SKIPPED,
      error: 'PR has merge conflicts',
      getStatusEmoji: () => '⏭️',
      getDescription: () => 'PR #1257: Skipped PR 2 (Issue #1256)',
    },
  ];
  processor.stats.total = 2;
  processor.stats.skipped = 2;
  processor.startedAt = new Date();
  processor.completedAt = new Date();

  const message = processor.formatFinalMessage();

  assert.equal(typeof message, 'string', 'Should return a string');
  assert.ok(message.includes('Results'), 'Should include Results section');
  assert.ok(message.includes('1241'), 'Should include first PR number');
  assert.ok(message.includes('1257'), 'Should include second PR number');
  // Issue #1294: The key assertion - skip reasons should be shown
  assert.ok(message.includes('PR has merge conflicts'), 'Should include skip reason in final message');
});

test('MergeQueueProcessor formatFinalMessage shows fail reasons in results', () => {
  const processor = new MergeQueueProcessor({
    owner: 'test-owner',
    repo: 'test-repo',
  });

  processor.status = MergeStatus.COMPLETED;
  processor.items = [
    {
      pr: { number: 100, title: 'Failed PR', createdAt: new Date().toISOString() },
      issue: null,
      status: MergeItemStatus.FAILED,
      error: 'CI checks failed',
      getStatusEmoji: () => '❌',
      getDescription: () => 'PR #100: Failed PR',
    },
  ];
  processor.stats.total = 1;
  processor.stats.failed = 1;
  processor.startedAt = new Date();
  processor.completedAt = new Date();

  const message = processor.formatFinalMessage();

  assert.equal(typeof message, 'string', 'Should return a string');
  assert.ok(message.includes('CI checks failed'), 'Should include fail reason in final message');
});

test('MergeQueueProcessor formatFinalMessage does not show reasons for merged items', () => {
  const processor = new MergeQueueProcessor({
    owner: 'test-owner',
    repo: 'test-repo',
  });

  processor.status = MergeStatus.COMPLETED;
  processor.items = [
    {
      pr: { number: 200, title: 'Merged PR', createdAt: new Date().toISOString() },
      issue: null,
      status: MergeItemStatus.MERGED,
      error: null,
      getStatusEmoji: () => '✅',
      getDescription: () => 'PR #200: Merged PR',
    },
  ];
  processor.stats.total = 1;
  processor.stats.merged = 1;
  processor.startedAt = new Date();
  processor.completedAt = new Date();

  const message = processor.formatFinalMessage();

  assert.equal(typeof message, 'string', 'Should return a string');
  // For merged items, there should be no reason appended
  // Line should just be: ✅ \#200
  assert.ok(!message.includes('\\#200:'), 'Should not have colon after PR number for merged items (no reason)');
});

test('MergeQueueProcessor formatFinalMessage escapes special chars in skip reasons', () => {
  const processor = new MergeQueueProcessor({
    owner: 'test-owner',
    repo: 'test-repo',
  });

  processor.status = MergeStatus.COMPLETED;
  processor.items = [
    {
      pr: { number: 300, title: 'Special PR', createdAt: new Date().toISOString() },
      issue: null,
      status: MergeItemStatus.SKIPPED,
      error: 'Error with *bold* and _italic_ chars',
      getStatusEmoji: () => '⏭️',
      getDescription: () => 'PR #300: Special PR',
    },
  ];
  processor.stats.total = 1;
  processor.stats.skipped = 1;
  processor.startedAt = new Date();
  processor.completedAt = new Date();

  const message = processor.formatFinalMessage();

  assert.equal(typeof message, 'string', 'Should return a string');
  // Special chars should be escaped for MarkdownV2
  assert.ok(message.includes('\\*bold\\*'), 'Should escape asterisks in reason');
  assert.ok(message.includes('\\_italic\\_'), 'Should escape underscores in reason');
});

test('MergeQueueProcessor formatFinalMessage truncates long skip reasons', () => {
  const processor = new MergeQueueProcessor({
    owner: 'test-owner',
    repo: 'test-repo',
  });

  processor.status = MergeStatus.COMPLETED;
  const longReason = 'This is a very long error message that exceeds the maximum character limit and should be truncated';
  processor.items = [
    {
      pr: { number: 400, title: 'Long Error PR', createdAt: new Date().toISOString() },
      issue: null,
      status: MergeItemStatus.SKIPPED,
      error: longReason,
      getStatusEmoji: () => '⏭️',
      getDescription: () => 'PR #400: Long Error PR',
    },
  ];
  processor.stats.total = 1;
  processor.stats.skipped = 1;
  processor.startedAt = new Date();
  processor.completedAt = new Date();

  const message = processor.formatFinalMessage();

  assert.equal(typeof message, 'string', 'Should return a string');
  // Long reasons should be truncated (47 chars + "...")
  // Note: "..." gets escaped to "\.\.\." for MarkdownV2
  assert.ok(message.includes('\\.\\.\\.'), 'Should truncate long reasons with escaped ellipsis');
  assert.ok(!message.includes('truncated'), 'Should not include full text beyond truncation point');
});

// ============================================================================
// Issue #1292: MarkdownV2 Escaping Tests
// ============================================================================

console.log('\n📋 Issue #1292: MarkdownV2 Escaping Tests\n');

test('MergeQueueProcessor escapeMarkdown escapes hyphens', () => {
  const processor = new MergeQueueProcessor({
    owner: 'test-owner',
    repo: 'test-repo',
  });

  const input = 'link-assistant/hive-mind';
  const escaped = processor.escapeMarkdown(input);

  assert.ok(escaped.includes('\\-'), 'Should escape hyphens');
  assert.equal(escaped, 'link\\-assistant/hive\\-mind', 'Should properly escape all hyphens');
});

test('MergeQueueProcessor escapeMarkdown escapes underscores', () => {
  const processor = new MergeQueueProcessor({
    owner: 'test_owner',
    repo: 'test_repo',
  });

  const input = 'test_owner/test_repo';
  const escaped = processor.escapeMarkdown(input);

  assert.ok(escaped.includes('\\_'), 'Should escape underscores');
  assert.equal(escaped, 'test\\_owner/test\\_repo', 'Should properly escape all underscores');
});

test('MergeQueueProcessor escapeMarkdown escapes periods', () => {
  const processor = new MergeQueueProcessor({
    owner: 'test.owner',
    repo: 'test.repo',
  });

  const input = 'test.owner/test.repo';
  const escaped = processor.escapeMarkdown(input);

  assert.ok(escaped.includes('\\.'), 'Should escape periods');
  assert.equal(escaped, 'test\\.owner/test\\.repo', 'Should properly escape all periods');
});

test('MergeQueueProcessor formatProgressMessage escapes owner/repo with hyphens (Issue #1292)', () => {
  const processor = new MergeQueueProcessor({
    owner: 'link-assistant',
    repo: 'hive-mind',
  });

  const message = processor.formatProgressMessage();

  // The message should contain escaped hyphens in owner/repo
  assert.ok(message.includes('link\\-assistant'), 'Should include escaped owner');
  assert.ok(message.includes('hive\\-mind'), 'Should include escaped repo');
  // Should NOT contain unescaped versions outside of code blocks
  // (We check the raw message, which should have escaped special chars)
});

test('MergeQueueProcessor formatFinalMessage escapes owner/repo with hyphens (Issue #1292)', () => {
  const processor = new MergeQueueProcessor({
    owner: 'link-assistant',
    repo: 'hive-mind',
  });

  const message = processor.formatFinalMessage();

  // The message should contain escaped hyphens in owner/repo
  assert.ok(message.includes('link\\-assistant'), 'Should include escaped owner');
  assert.ok(message.includes('hive\\-mind'), 'Should include escaped repo');
});

test('MergeQueueProcessor formatProgressMessage escapes special chars in owner/repo', () => {
  const processor = new MergeQueueProcessor({
    owner: 'org.name_test-123',
    repo: 'repo.name_test-456',
  });

  const message = processor.formatProgressMessage();

  // Check that all special characters are escaped
  assert.ok(message.includes('org\\.name\\_test\\-123'), 'Should escape all special chars in owner');
  assert.ok(message.includes('repo\\.name\\_test\\-456'), 'Should escape all special chars in repo');
});

// ============================================================================
// Issue #1269: Merge Method Configuration Tests
// ============================================================================

console.log('\n📋 Issue #1269: Merge Method Configuration Tests\n');

test('MERGE_QUEUE_CONFIG has MERGE_METHOD field', () => {
  assert.ok(MERGE_QUEUE_CONFIG.MERGE_METHOD !== undefined, 'MERGE_METHOD should be defined');
  assert.ok(typeof MERGE_QUEUE_CONFIG.MERGE_METHOD === 'string', 'MERGE_METHOD should be a string');
});

test('MERGE_QUEUE_CONFIG.MERGE_METHOD has valid default value', () => {
  const validMethods = ['merge', 'squash', 'rebase'];
  assert.ok(validMethods.includes(MERGE_QUEUE_CONFIG.MERGE_METHOD), `MERGE_METHOD should be one of: ${validMethods.join(', ')}`);
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Test Results: ${testsPassed} passed, ${testsFailed} failed\n`);

if (testsFailed > 0) {
  process.exit(1);
}
