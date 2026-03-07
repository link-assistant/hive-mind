#!/usr/bin/env node

/**
 * Tests for sanitizeSurrogates() utility function
 *
 * Verifies that lone/orphaned Unicode surrogates are properly replaced
 * with U+FFFD (Unicode replacement character) while valid surrogate pairs
 * (used for emoji and other supplementary characters) are preserved.
 *
 * Related: https://github.com/link-assistant/hive-mind/issues/1204
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import from both lib.mjs and interactive-mode.lib.mjs
const { sanitizeSurrogates } = await import(join(__dirname, '..', 'src', 'lib.mjs'));
const interactiveModeLib = await import(join(__dirname, '..', 'src', 'interactive-mode.lib.mjs'));
const { utils } = interactiveModeLib;

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('\u2705 PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`\u274C FAILED: ${error.message}`);
    testsFailed++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ============================================
// sanitizeSurrogates from lib.mjs
// ============================================

console.log('\n=== Testing sanitizeSurrogates (lib.mjs) ===\n');

runTest('removes lone high surrogate', () => {
  assertEqual(sanitizeSurrogates('Hello \uD800 World'), 'Hello \uFFFD World');
});

runTest('removes lone low surrogate', () => {
  assertEqual(sanitizeSurrogates('Hello \uDC00 World'), 'Hello \uFFFD World');
});

runTest('preserves valid surrogate pair (emoji)', () => {
  const input = 'Hello \uD83D\uDE00 World'; // 😀
  assertEqual(sanitizeSurrogates(input), input);
});

runTest('handles multiple lone surrogates', () => {
  assertEqual(sanitizeSurrogates('\uD800\uD801\uD802'), '\uFFFD\uFFFD\uFFFD');
});

runTest('handles mixed valid and invalid surrogates', () => {
  assertEqual(sanitizeSurrogates('\uD83D\uDE00\uD800\uD83D\uDE00'), '\uD83D\uDE00\uFFFD\uD83D\uDE00');
});

runTest('leaves normal ASCII text unchanged', () => {
  assertEqual(sanitizeSurrogates('Normal ASCII text'), 'Normal ASCII text');
});

runTest('handles empty string', () => {
  assertEqual(sanitizeSurrogates(''), '');
});

runTest('handles high surrogate followed by non-low value', () => {
  assertEqual(sanitizeSurrogates('\uD800A'), '\uFFFDA');
});

runTest('handles lone low surrogate at start', () => {
  assertEqual(sanitizeSurrogates('\uDC00Hello'), '\uFFFDHello');
});

runTest('handles lone high surrogate at end', () => {
  assertEqual(sanitizeSurrogates('Hello\uDBFF'), 'Hello\uFFFD');
});

runTest('returns non-string values unchanged', () => {
  assertEqual(sanitizeSurrogates(null), null);
  assertEqual(sanitizeSurrogates(undefined), undefined);
  assertEqual(sanitizeSurrogates(42), 42);
});

runTest('preserves multiple valid emoji', () => {
  const input = '\uD83D\uDE00\uD83D\uDE01\uD83D\uDE02'; // 😀😁😂
  assertEqual(sanitizeSurrogates(input), input);
});

runTest('handles all high surrogate values at boundaries', () => {
  // First high surrogate U+D800
  assertEqual(sanitizeSurrogates('\uD800'), '\uFFFD');
  // Last high surrogate U+DBFF
  assertEqual(sanitizeSurrogates('\uDBFF'), '\uFFFD');
});

runTest('handles all low surrogate values at boundaries', () => {
  // First low surrogate U+DC00
  assertEqual(sanitizeSurrogates('\uDC00'), '\uFFFD');
  // Last low surrogate U+DFFF
  assertEqual(sanitizeSurrogates('\uDFFF'), '\uFFFD');
});

runTest('preserves boundary surrogate pair', () => {
  // High + Low = valid pair
  const input = '\uDBFF\uDFFF';
  assertEqual(sanitizeSurrogates(input), input);
});

// ============================================
// sanitizeSurrogates from interactive-mode.lib.mjs
// ============================================

console.log('\n=== Testing sanitizeSurrogates (interactive-mode.lib.mjs) ===\n');

runTest('interactive-mode sanitizeSurrogates exists', () => {
  if (typeof utils.sanitizeSurrogates !== 'function') {
    throw new Error('sanitizeSurrogates not exported from interactive-mode.lib.mjs utils');
  }
});

runTest('interactive-mode sanitizeSurrogates removes lone surrogates', () => {
  assertEqual(utils.sanitizeSurrogates('Hello \uD800 World'), 'Hello \uFFFD World');
});

// ============================================
// safeJsonStringify with surrogate handling
// ============================================

console.log('\n=== Testing safeJsonStringify with surrogate sanitization ===\n');

runTest('safeJsonStringify sanitizes lone surrogates in values', () => {
  const obj = { content: 'Hello \uD800 World' };
  const result = utils.safeJsonStringify(obj);
  // The result should contain the replacement character, not the lone surrogate
  if (result.includes('\uD800')) {
    throw new Error('safeJsonStringify output still contains lone surrogate');
  }
  // Parse it back and verify the replacement
  const parsed = JSON.parse(result);
  assertEqual(parsed.content, 'Hello \uFFFD World');
});

runTest('safeJsonStringify preserves valid emoji in values', () => {
  const obj = { emoji: '\uD83D\uDE00' }; // 😀
  const result = utils.safeJsonStringify(obj);
  const parsed = JSON.parse(result);
  assertEqual(parsed.emoji, '\uD83D\uDE00');
});

runTest('safeJsonStringify handles nested objects with surrogates', () => {
  const obj = {
    level1: {
      level2: {
        content: 'Nested \uD800 value',
      },
    },
  };
  const result = utils.safeJsonStringify(obj);
  if (result.includes('\uD800')) {
    throw new Error('Nested lone surrogate not sanitized');
  }
});

runTest('safeJsonStringify handles arrays with surrogates', () => {
  const obj = { items: ['normal', 'has \uDC00 surrogate', 'also normal'] };
  const result = utils.safeJsonStringify(obj);
  if (result.includes('\uDC00')) {
    throw new Error('Array lone surrogate not sanitized');
  }
});

// ============================================
// JSON validity after sanitization
// ============================================

console.log('\n=== Testing JSON validity after sanitization ===\n');

runTest('sanitized string produces valid JSON', () => {
  const problematic = 'Content with \uD800 lone \uDC00 surrogates \uD83D\uDE00 and emoji';
  const sanitized = sanitizeSurrogates(problematic);
  const json = JSON.stringify({ text: sanitized });
  // Verify no lone surrogates in JSON output
  const surrogatePattern = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
  if (surrogatePattern.test(json)) {
    throw new Error('JSON output still contains lone surrogates');
  }
  // Verify roundtrip
  const parsed = JSON.parse(json);
  assertEqual(parsed.text, sanitized);
});

// ============================================
// Summary
// ============================================

console.log(`\n=== Results: ${testsPassed} passed, ${testsFailed} failed ===\n`);
process.exit(testsFailed > 0 ? 1 : 0);
