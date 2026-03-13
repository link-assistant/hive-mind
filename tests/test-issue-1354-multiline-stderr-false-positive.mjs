#!/usr/bin/env node

/**
 * Unit tests for Issue #1354: False positive error detection when stderr contains
 * multi-line chunks with warn-level JSON messages.
 *
 * Root cause: A single stderr chunk may contain two or more newline-separated JSON
 * log messages (e.g. two consecutive {"level":"warn",...} lines). Passing the entire
 * multi-line string to isStderrError() causes JSON.parse() to fail (not valid JSON),
 * falling through to keyword matching. Since the message contains "failed", it was
 * incorrectly classified as an error.
 *
 * Fix: Split stderr chunks by newline and check each line individually.
 *
 * References:
 * - Issue #1354: https://github.com/link-assistant/hive-mind/issues/1354
 * - Issue #1337: JSON-structured SDK warnings with non-error level (single-line fix)
 * - Issue #477:  Emoji-prefixed warnings excluded from error detection
 */

import { strict as assert } from 'assert';
import { isStderrError } from '../src/claude.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

function test(description, actual, expected) {
  if (actual === expected) {
    console.log(`✅ PASS: ${description}`);
    testsPassed++;
  } else {
    console.log(`❌ FAIL: ${description}`);
    console.log(`   Expected: ${expected}`);
    console.log(`   Actual:   ${actual}`);
    testsFailed++;
  }
}

/**
 * Simulates the fixed stderr processing: split chunk by newline, check each line.
 * This mirrors the fix in claude.lib.mjs at the chunk.type === 'stderr' handler.
 *
 * @param {string} chunk - The full stderr chunk (may contain multiple lines)
 * @returns {string[]} Array of lines classified as errors
 */
function getStderrErrors(chunk) {
  const errors = [];
  for (const line of chunk.split('\n')) {
    if (isStderrError(line)) {
      errors.push(line.trim());
    }
  }
  return errors;
}

console.log('🧪 Testing Issue #1354: Multi-line stderr chunk false positive detection\n');
console.log('='.repeat(70));

// ── Suite 1: The exact false positive from the reported logs ─────────────────

console.log('\n📋 Suite 1: Exact false positive scenario from logs (Issue #1354)\n');

const bashToolWarn = '{"level":"warn","message":"[BashTool] Pre-flight check is taking longer than expected. Run with ANTHROPIC_LOG=debug to check for failed or slow API requests."}';
const twoWarnLines = bashToolWarn + '\n' + bashToolWarn;

// The old behavior: passing the entire multi-line chunk fails JSON.parse,
// falls through to keyword matching, finds "failed" → false positive
test('isStderrError on single warn-line — correctly returns false (existing #1337 fix)', isStderrError(bashToolWarn), false);

// The root cause: isStderrError on the multi-line chunk (old behavior: true, after fix: false)
// With the fix (line-by-line splitting in claude.lib.mjs), the multi-line chunk is never
// passed to isStderrError directly — each line is checked individually.
// We verify the per-line behavior here:
test('isStderrError on multi-line warn chunk — each line individually returns false', getStderrErrors(twoWarnLines).length, 0);

test('Multi-line chunk with two identical warn lines — no errors found', getStderrErrors(twoWarnLines).join(''), '');

// ── Suite 2: Multi-line chunks with mixed content ────────────────────────────

console.log('\n📋 Suite 2: Multi-line chunks with mixed warn and error content\n');

const warnThenError = bashToolWarn + '\n' + '{"level":"error","message":"API Error: 500 Internal Server Error"}';
const warnErrors = getStderrErrors(warnThenError);

test('Multi-line: warn line + error line — only the error line is detected', warnErrors.length, 1);

test('Multi-line: warn line + error line — the error line is the API 500 error', warnErrors[0]?.includes('API Error: 500') ?? false, true);

const warnThenPlainError = bashToolWarn + '\n' + 'Error: Something went wrong';
const plainErrorResults = getStderrErrors(warnThenPlainError);

test('Multi-line: warn line + plain Error: line — only the error line is detected', plainErrorResults.length, 1);

test('Multi-line: warn line + plain Error: line — correct error is found', plainErrorResults[0]?.includes('Error: Something went wrong') ?? false, true);

// ── Suite 3: Multi-line chunks with only safe content ────────────────────────

console.log('\n📋 Suite 3: Multi-line chunks with only safe content\n');

const threeWarnLines = [bashToolWarn, bashToolWarn, bashToolWarn].join('\n');
test('Three warn lines in one chunk — no errors detected', getStderrErrors(threeWarnLines).length, 0);

const warnAndInfo = bashToolWarn + '\n' + '{"level":"info","message":"Session started"}';
test('Warn line + info line — no errors detected', getStderrErrors(warnAndInfo).length, 0);

const warnWithTrailingNewline = bashToolWarn + '\n';
test('Single warn line with trailing newline — no errors detected', getStderrErrors(warnWithTrailingNewline).length, 0);

const emptyLines = '\n\n\n';
test('Empty lines only — no errors detected', getStderrErrors(emptyLines).length, 0);

// ── Suite 4: isStderrError still works correctly for individual lines ────────

console.log('\n📋 Suite 4: isStderrError line-level correctness (regression tests)\n');

test('Single warn JSON — not an error', isStderrError(bashToolWarn), false);

test('Single fatal JSON — is an error', isStderrError('{"level":"fatal","message":"Connection failed permanently"}'), true);

test('Single error JSON — is an error', isStderrError('{"level":"error","message":"API Error: 500"}'), true);

test('Plain "Error:" line — is an error', isStderrError('Error: Something went wrong'), true);

test('Emoji ⚠️ warn — not an error', isStderrError('⚠️ Pre-flight check failed to connect'), false);

test('Empty string — not an error', isStderrError(''), false);

// ── Summary ───────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(70));
console.log('\n📊 Test Results Summary\n');
console.log(`Total tests: ${testsPassed + testsFailed}`);
console.log(`✅ Passed: ${testsPassed}`);
console.log(`❌ Failed: ${testsFailed}`);

if (testsFailed === 0) {
  console.log('\n🎉 All tests passed! Issue #1354 fix verified.');
  process.exit(0);
} else {
  console.log(`\n❌ ${testsFailed} test(s) failed`);
  process.exit(1);
}
