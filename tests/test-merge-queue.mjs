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
    owner: 'test-owner',
    repo: 'test-repo',
  });

  const message = processor.formatProgressMessage();

  assert.equal(typeof message, 'string', 'Should return a string');
  assert.ok(message.length > 0, 'Should not be empty');
  assert.ok(message.includes('test-owner'), 'Should include owner');
  assert.ok(message.includes('test-repo'), 'Should include repo');
});

test('MergeQueueProcessor formatFinalMessage returns string', () => {
  const processor = new MergeQueueProcessor({
    owner: 'test-owner',
    repo: 'test-repo',
  });

  const message = processor.formatFinalMessage();

  assert.equal(typeof message, 'string', 'Should return a string');
  assert.ok(message.length > 0, 'Should not be empty');
  assert.ok(message.includes('test-owner'), 'Should include owner');
  assert.ok(message.includes('test-repo'), 'Should include repo');
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
  assert.ok(message.includes('Errors'), 'Should include Errors section for failed items');
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
  assert.ok(!message.includes('⚠️ *Errors:*'), 'Should not include Errors section when no failures');
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Test Results: ${testsPassed} passed, ${testsFailed} failed\n`);

if (testsFailed > 0) {
  process.exit(1);
}
