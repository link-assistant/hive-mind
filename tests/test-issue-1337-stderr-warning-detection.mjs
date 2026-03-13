#!/usr/bin/env node

/**
 * Unit tests for stderr warning detection logic (isStderrError)
 *
 * Prevents regression of Issue #1337: JSON-format SDK warnings that contain
 * error keywords (e.g. "failed") were falsely flagged as errors, causing:
 *   ❌ Command failed: No messages processed and errors detected in stderr
 *
 * The fix: parse lines starting with '{' as JSON; only treat them as errors
 * when their "level" field is "error" or "fatal".
 *
 * References:
 * - Issue #1337: https://github.com/link-assistant/hive-mind/issues/1337
 * - Issue #477:  Emoji-prefixed warnings (⚠️) excluded from error detection
 * - Issue #1165: "command not found" (exit 127) error detection
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

console.log('🧪 Testing stderr warning detection (isStderrError)\n');
console.log('='.repeat(60));

// ── Issue #1337: JSON-structured SDK warnings ─────────────────────────────

console.log('\n📋 Suite 1: JSON-structured SDK messages (Issue #1337)\n');

test('JSON warn level with "failed" keyword — root cause of #1337', isStderrError('{"level":"warn","message":"[BashTool] Pre-flight check is taking longer than expected. Run with ANTHROPIC_LOG=debug to check for failed or slow API requests."}'), false);

test('JSON error level — should still be detected as error', isStderrError('{"level":"error","message":"API Error: 500 Internal Server Error"}'), true);

test('JSON fatal level — should still be detected as error', isStderrError('{"level":"fatal","message":"Connection failed permanently"}'), true);

test('JSON info level — should NOT be an error', isStderrError('{"level":"info","message":"Session started successfully"}'), false);

test('JSON debug level — should NOT be an error', isStderrError('{"level":"debug","message":"Sending request to API, timeout may occur"}'), false);

test('JSON warn level with "error" keyword in message text', isStderrError('{"level":"warn","message":"Possible error-like condition detected, but not critical"}'), false);

test('JSON warn level with "not found" keyword in message text', isStderrError('{"level":"warn","message":"Some resource not found but non-critical"}'), false);

test('JSON warn level with "failed" keyword in message text', isStderrError('{"level":"warn","message":"Request failed but will retry automatically"}'), false);

test('JSON object without level field — falls through to keyword matching, "failed" present', isStderrError('{"message":"Something failed"}'), true);

test('JSON WARN level (uppercase) — case-insensitive, should NOT be an error', isStderrError('{"level":"WARN","message":"Something failed but it is a warning"}'), false);

test('JSON Warning level (mixed case) — case-insensitive, should NOT be an error', isStderrError('{"level":"Warning","message":"Pre-flight failed"}'), false);

// ── Issue #477: Emoji-prefixed warnings ──────────────────────────────────

console.log('\n📋 Suite 2: Emoji-prefixed warnings (Issue #477)\n');

test('Emoji ⚠️ with "failed" keyword — should NOT be an error', isStderrError('⚠️  [BashTool] Pre-flight check is taking longer than expected. Run with ANTHROPIC_LOG=debug to check for failed or slow API requests.'), false);

test('Emoji ⚠ (alternative) with error keywords — should NOT be an error', isStderrError('⚠ Something failed and was not found'), false);

// ── Real errors that must still be detected ───────────────────────────────

console.log('\n📋 Suite 3: Real errors (must still be detected)\n');

test('Plain "Error:" prefix', isStderrError('Error: Something went wrong'), true);

test('npm error code', isStderrError('npm error code ENOENT'), true);

test('Command failed with exit code', isStderrError('Command failed with exit code 1'), true);

test('"command not found" — Issue #1165', isStderrError('/bin/sh: 1: claude: not found'), true);

test('Lowercase "error" keyword', isStderrError('fatal error: cannot open file'), true);

// ── Edge cases ────────────────────────────────────────────────────────────

console.log('\n📋 Suite 4: Edge cases\n');

test('Empty string — should NOT be an error', isStderrError(''), false);

test('Whitespace-only — should NOT be an error', isStderrError('   '), false);

test('Invalid JSON starting with { — falls through to keyword matching, "failed" present', isStderrError('{not valid json: failed}'), true);

test('Invalid JSON starting with { — no error keywords, should NOT be an error', isStderrError('{not valid json: harmless}'), false);

test('Leading whitespace before ⚠️ — trim() normalizes it, should NOT be an error', isStderrError('  ⚠️  Warning text with failed in it'), false);

test('Benign message with no error keywords', isStderrError('Session initializing, please wait...'), false);

test('Message containing "error" as substring of another word — e.g. "errored" — should be detected', isStderrError('The process errored out'), true);

// ── Summary ───────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log('\n📊 Test Results Summary\n');
console.log(`Total tests: ${testsPassed + testsFailed}`);
console.log(`✅ Passed: ${testsPassed}`);
console.log(`❌ Failed: ${testsFailed}`);

if (testsFailed === 0) {
  console.log('\n🎉 All tests passed! Issue #1337 fix verified.');
  process.exit(0);
} else {
  console.log(`\n❌ ${testsFailed} test(s) failed`);
  process.exit(1);
}
