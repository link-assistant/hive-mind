#!/usr/bin/env node
/**
 * Meaningless Error Fragment Unit Tests (Issue #1941)
 *
 * Reproduces the bug from issue #1941: "Failed to deliver working session".
 * When a Claude run was interrupted mid-stream (CTRL+C / SIGINT, exit code 130),
 * the last captured stdout line was a stray JSON-structural fragment — a lone
 * "}" — which was stored as `errorInfo.message`. That junk then surfaced in the
 * GitHub failure comment as:
 *
 *   "CLAUDE execution failed with }"          (the reported PR comment)
 *   "failed by {"                             (the issue title shorthand)
 *
 * The fix adds two shared helpers in src/lib.mjs:
 *   - `isMeaningfulErrorText`  — a fragment with no letters/digits is not a real error
 *   - `buildToolErrorMessage`  — pick the tool message only when meaningful, else
 *                                an interrupt label (exit 130) or a generic fallback
 * and guards `extractToolErrorCore` so meaningless fragments never reach any
 * failure surface (GitHub comment, terminal "Error details:", retry logic).
 *
 * Run with: node tests/test-issue-1941-meaningless-error-fragment.test.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1941
 */

import assert from 'node:assert/strict';
import { isMeaningfulErrorText, buildToolErrorMessage, extractToolErrorCore, formatToolExecutionFailure } from '../src/lib.mjs';

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

console.log('\n📋 isMeaningfulErrorText Tests\n');

test('rejects a lone closing brace (the reported fragment)', () => {
  assert.equal(isMeaningfulErrorText('}'), false);
});

test('rejects a lone opening brace (the issue title fragment)', () => {
  assert.equal(isMeaningfulErrorText('{'), false);
});

test('rejects pure JSON-structural punctuation', () => {
  for (const junk of ['{', '}', '[', ']', ',', '},', '{}', '[]', ' } ', '\n}\n', ':', '"', '},{']) {
    assert.equal(isMeaningfulErrorText(junk), false, `expected ${JSON.stringify(junk)} to be rejected`);
  }
});

test('rejects empty / whitespace / non-string values', () => {
  assert.equal(isMeaningfulErrorText(''), false);
  assert.equal(isMeaningfulErrorText('   \n\t '), false);
  assert.equal(isMeaningfulErrorText(null), false);
  assert.equal(isMeaningfulErrorText(undefined), false);
  assert.equal(isMeaningfulErrorText(12345), false);
});

test('accepts real error text (contains letters/digits)', () => {
  assert.equal(isMeaningfulErrorText('API Error: Output blocked'), true);
  assert.equal(isMeaningfulErrorText('exit code 1'), true);
  assert.equal(isMeaningfulErrorText('boom'), true);
});

test('accepts non-ASCII (Cyrillic) error text', () => {
  // The reproduced session was solving a Russian-language issue; errors can be non-ASCII.
  assert.equal(isMeaningfulErrorText('Ошибка сервера'), true);
});

console.log('\n📋 buildToolErrorMessage Tests\n');

test('keeps a meaningful lastMessage', () => {
  assert.equal(buildToolErrorMessage({ lastMessage: 'API Error: blocked', exitCode: 1, fallback: 'fb', toolLabel: 'Claude' }), 'API Error: blocked');
});

test('collapses whitespace in a meaningful lastMessage', () => {
  assert.equal(buildToolErrorMessage({ lastMessage: 'API Error:\n  blocked\tby   policy', exitCode: 1, fallback: 'fb', toolLabel: 'Claude' }), 'API Error: blocked by policy');
});

test('labels a CTRL+C interrupt (exit 130) when the fragment is junk', () => {
  assert.equal(buildToolErrorMessage({ lastMessage: '}', exitCode: 130, fallback: 'fb', toolLabel: 'Claude' }), 'Claude command interrupted (CTRL+C)');
});

test('uses the generic fallback for junk with a non-interrupt exit code', () => {
  assert.equal(buildToolErrorMessage({ lastMessage: '}', exitCode: 1, fallback: 'Claude command failed with exit code 1', toolLabel: 'Claude' }), 'Claude command failed with exit code 1');
});

test('uses the fallback when lastMessage is empty', () => {
  assert.equal(buildToolErrorMessage({ lastMessage: '', exitCode: 1, fallback: 'fb', toolLabel: 'Claude' }), 'fb');
});

console.log('\n📋 extractToolErrorCore guard Tests\n');

test('rejects a lone "}" fragment as the core error', () => {
  assert.equal(extractToolErrorCore({ toolResult: { errorInfo: { message: '}' } } }), null);
});

test('rejects a lone "{" fragment as the core error', () => {
  assert.equal(extractToolErrorCore({ toolResult: { errorInfo: { message: '{' } } }), null);
});

test('rejects punctuation-only fragments via toolResult.result fallback', () => {
  assert.equal(extractToolErrorCore({ toolResult: { result: '},' } }), null);
});

test('still returns genuine error text', () => {
  assert.equal(extractToolErrorCore({ toolResult: { errorInfo: { message: 'API Error: blocked' } } }), 'API Error: blocked');
});

console.log('\n📋 formatToolExecutionFailure end-to-end (the reported bug)\n');

test('the reported shape no longer produces "CLAUDE execution failed with }"', () => {
  // Shape returned by claude.lib.mjs when interrupted mid-stream before the fix.
  const toolResult = { success: false, errorInfo: { message: '}', exitCode: 130 } };
  const result = formatToolExecutionFailure({ tool: 'claude', toolResult });
  assert.equal(result, 'CLAUDE execution failed');
  assert.ok(!result.includes('}'), `Must not surface the junk fragment, got: ${result}`);
});

test('an interrupt labeled by buildToolErrorMessage reads cleanly', () => {
  // Shape produced by claude.lib.mjs AFTER the fix for an interrupt.
  const toolResult = { success: false, errorInfo: { message: 'Claude command interrupted (CTRL+C)', exitCode: 130 } };
  assert.equal(formatToolExecutionFailure({ tool: 'claude', toolResult }), 'CLAUDE execution failed with Claude command interrupted (CTRL+C)');
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed, ${testsPassed + testsFailed} total\n`);

if (testsFailed > 0) {
  process.exit(1);
}
