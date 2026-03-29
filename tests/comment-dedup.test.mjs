#!/usr/bin/env node
/**
 * Comment Deduplication Library Unit Tests
 *
 * Tests for the comment-dedup.lib.mjs module, including:
 * - normalizeCommentForComparison() text normalization
 * - computeSimilarity() Jaccard similarity calculation
 * - Deduplication logic for various comment types
 *
 * Run with: node tests/comment-dedup.test.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1495
 */

import assert from 'node:assert/strict';
import { normalizeCommentForComparison, computeSimilarity, computeCommentSimilarity, extractCommentHeader } from '../src/comment-dedup.lib.mjs';

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

// ============================================================================
// normalizeCommentForComparison Tests
// ============================================================================

console.log('\n📋 normalizeCommentForComparison Tests\n');

test('normalizes empty string', () => {
  assert.equal(normalizeCommentForComparison(''), '');
});

test('normalizes null/undefined', () => {
  assert.equal(normalizeCommentForComparison(null), '');
  assert.equal(normalizeCommentForComparison(undefined), '');
});

test('removes markdown headers', () => {
  const input = '## ✅ Validation Complete\n\nAll checks passed.';
  const result = normalizeCommentForComparison(input);
  assert.ok(!result.includes('##'));
});

test('removes timestamps', () => {
  const input = 'Session started at 2026-03-29T11:20:47.435Z';
  const result = normalizeCommentForComparison(input);
  assert.ok(!result.includes('2026'));
  assert.ok(!result.includes('11:20'));
});

test('removes markdown bold formatting', () => {
  const input = '**Bold text** and *italic text*';
  const result = normalizeCommentForComparison(input);
  assert.ok(!result.includes('**'));
  assert.ok(!result.includes('*'));
  assert.ok(result.includes('bold text'));
});

test('removes markdown links but keeps text', () => {
  const input = 'See [this link](https://github.com/example) for details';
  const result = normalizeCommentForComparison(input);
  assert.ok(!result.includes('https://'));
  assert.ok(result.includes('this link'));
});

test('removes table formatting', () => {
  const input = '| Requirement | Status |\n|---|---|\n| Test | ✅ |';
  const result = normalizeCommentForComparison(input);
  assert.ok(!result.includes('|'));
});

test('removes hive-mind signature lines', () => {
  const input = 'Content here\n\n---\n*Monitored by hive-mind with --auto-restart-until-mergeable flag*';
  const result = normalizeCommentForComparison(input);
  assert.ok(!result.includes('monitored by'));
});

test('collapses whitespace', () => {
  const input = 'Multiple   spaces   and\n\nnewlines';
  const result = normalizeCommentForComparison(input);
  assert.ok(!result.includes('  '));
});

test('converts to lowercase', () => {
  const input = 'UPPERCASE Text';
  const result = normalizeCommentForComparison(input);
  assert.equal(result, 'uppercase text');
});

// ============================================================================
// computeSimilarity Tests
// ============================================================================

console.log('\n📋 computeSimilarity Tests\n');

test('identical strings return 1', () => {
  const text = 'all checks passed no merge conflicts';
  assert.equal(computeSimilarity(text, text), 1);
});

test('empty strings return 1', () => {
  assert.equal(computeSimilarity('', ''), 1);
});

test('one empty string returns 0', () => {
  assert.equal(computeSimilarity('some text here', ''), 0);
  assert.equal(computeSimilarity('', 'some text here'), 0);
});

test('completely different strings return low similarity', () => {
  const a = 'apple banana cherry dragonfruit elderberry';
  const b = 'quantum relativity neutron proton electron';
  const similarity = computeSimilarity(a, b);
  assert.ok(similarity < 0.1, `Expected < 0.1, got ${similarity}`);
});

test('similar validation comments have high similarity', () => {
  const a = normalizeCommentForComparison('## ✅ Validation Complete\n\nAll changes have been reviewed, validated, and tested.\n\n| Check | Status |\n|---|---|\n| No /home/sandbox in active code | ✅ |\n| User creation with -d /workspace | ✅ |\n| CI passed | ✅ |');
  const b = normalizeCommentForComparison('## ✅ Validation Complete — All Checks Passed\n\nAll changes have been reviewed, validated, and tested against the requirements.\n\n| Check | Status |\n|---|---|\n| No /home/sandbox in active code | ✅ |\n| User creation with -d /workspace | ✅ |\n| CI builds and tests pass | ✅ |');
  const similarity = computeSimilarity(a, b);
  assert.ok(similarity > 0.7, `Expected > 0.7, got ${similarity}`);
});

test('different comment types have low similarity', () => {
  const a = normalizeCommentForComparison('## ✅ Ready to merge\n\nThis pull request is now ready to be merged:\n- All CI checks have passed\n- No merge conflicts');
  const b = normalizeCommentForComparison('## 🤖 Solution Draft Log\n\nThis log file contains the complete execution trace.\n\n### Cost estimation:\n- Public pricing: $12.37');
  const similarity = computeSimilarity(a, b);
  assert.ok(similarity < 0.3, `Expected < 0.3, got ${similarity}`);
});

test('"Ready to merge" comments across sessions have high similarity', () => {
  const a = normalizeCommentForComparison('## ✅ Ready to merge\n\nThis pull request is now ready to be merged:\n- All CI checks have passed\n- No merge conflicts\n- No pending changes\n\n---\n*Monitored by hive-mind with --auto-restart-until-mergeable flag*');
  const b = normalizeCommentForComparison('## ✅ Ready to merge\n\nThis pull request is now ready to be merged:\n- All CI checks have passed\n- No merge conflicts\n- No pending changes\n\n---\n*Monitored by hive-mind with --auto-restart-until-mergeable flag*');
  const similarity = computeSimilarity(a, b);
  assert.equal(similarity, 1, `Expected 1, got ${similarity}`);
});

test('session start and session end comments have low similarity', () => {
  const a = normalizeCommentForComparison('🤖 **AI Work Session Started**\n\nStarting automated work session at 2026-03-29T11:20:47.435Z');
  const b = normalizeCommentForComparison('🤖 **AI Work Session Completed**\n\nWork session ended at 2026-03-29T12:00:06.499Z');
  const similarity = computeSimilarity(a, b);
  assert.ok(similarity < 0.7, `Expected < 0.7, got ${similarity}`);
});

// ============================================================================
// extractCommentHeader Tests
// ============================================================================

console.log('\n📋 extractCommentHeader Tests\n');

test('extracts header from markdown comment', () => {
  const header = extractCommentHeader('## ✅ Validation Complete\n\nBody text here.');
  assert.ok(header.includes('validation complete'));
});

test('extracts header from non-markdown comment', () => {
  const header = extractCommentHeader('Simple first line\n\nMore text.');
  assert.ok(header.includes('simple first line'));
});

test('handles empty input', () => {
  assert.equal(extractCommentHeader(''), '');
  assert.equal(extractCommentHeader(null), '');
});

// ============================================================================
// computeCommentSimilarity Tests
// ============================================================================

console.log('\n📋 computeCommentSimilarity Tests\n');

test('boosts similarity for matching headers', () => {
  const a = '## ✅ Validation Complete\n\nDifferent body text here with unique words.';
  const b = '## ✅ Validation Complete\n\nCompletely other content that is unique.';
  const simWithBoost = computeCommentSimilarity(a, b);
  const normA = normalizeCommentForComparison(a);
  const normB = normalizeCommentForComparison(b);
  const simWithout = computeSimilarity(normA, normB);
  assert.ok(simWithBoost > simWithout, `Header boost should increase similarity: ${simWithBoost} > ${simWithout}`);
});

test('does not boost for different headers', () => {
  const a = '## ✅ Ready to merge\n\nSome content here.';
  const b = '## 🤖 Solution Draft Log\n\nSome content here.';
  const sim = computeCommentSimilarity(a, b);
  const normA = normalizeCommentForComparison(a);
  const normB = normalizeCommentForComparison(b);
  const simDirect = computeSimilarity(normA, normB);
  // Should be roughly equal (no header boost)
  assert.ok(Math.abs(sim - simDirect) < 0.01, `No boost expected for different headers: ${sim} vs ${simDirect}`);
});

// ============================================================================
// Integration-style Tests: Real duplicate detection from Issue #1495
// ============================================================================

console.log('\n📋 Real-world Duplicate Detection Tests (Issue #1495)\n');

test('detects duplicate validation comments from PR #73 incident', () => {
  const comment1 = `## ✅ Validation Complete — Ready to merge

All changes have been thoroughly validated against the issue requirements:

### What was done in this session
- **Fixed**: measure-disk-space.sh, essentials-sandbox/install.sh, and ubuntu-24-server-install.sh
- **Merged**: Latest main branch into PR branch — no conflicts
- **Verified**: All CI checks pass

### Validation checklist
| Requirement | Status |
|---|---|
| /etc/passwd alignment | ✅ |
| No hardcoded /home/sandbox | ✅ |
| All toolchains in /workspace | ✅ |`;

  const comment2 = `## ✅ Validation Complete

All changes have been reviewed, validated, and tested. Here's the summary:

### What was done in this session
- **Found and fixed 3 scripts** where sandbox user creation was missing
- **Merged latest main** into the branch — no conflicts
- **Updated PR description** with verification checklist

### Validation results
| Check | Status |
|---|---|
| No /home/sandbox references | ✅ |
| All Dockerfiles use WORKDIR /workspace | ✅ |
| All ENV variables point to /workspace | ✅ |`;

  // Use computeCommentSimilarity which combines header matching + word overlap
  const similarity = computeCommentSimilarity(comment1, comment2);
  assert.ok(similarity >= 0.7, `Expected >= 0.7 for duplicate validation comments, got ${similarity}`);
});

test('does not flag session start comment as duplicate of validation', () => {
  const sessionStart = '🤖 **AI Work Session Started**\n\nStarting automated work session at 2026-03-29T11:20:47.435Z\n\nThe PR has been converted to draft mode while work is in progress.';
  const validation = '## ✅ Validation Complete\n\nAll changes have been reviewed, validated, and tested.\n- No /home/sandbox references remain\n- All CI checks passed';

  const norm1 = normalizeCommentForComparison(sessionStart);
  const norm2 = normalizeCommentForComparison(validation);
  const similarity = computeSimilarity(norm1, norm2);
  assert.ok(similarity < 0.7, `Expected < 0.7 for different comment types, got ${similarity}`);
});

test('short words (<=2 chars) are ignored in similarity', () => {
  // This ensures noise words like "a", "to", "is" etc. don't inflate similarity
  const a = 'a to is on at in';
  const b = 'x y z w v u';
  const similarity = computeSimilarity(a, b);
  // Both sets are empty after filtering (all words <=2 chars), so overlap is 1 (vacuous truth)
  assert.equal(similarity, 1, `Expected 1 since both word sets are empty after filtering, got ${similarity}`);
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(50));
console.log(`Results: ${testsPassed} passed, ${testsFailed} failed`);
console.log('='.repeat(50) + '\n');

if (testsFailed > 0) {
  process.exit(1);
}
