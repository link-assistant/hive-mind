#!/usr/bin/env node

/**
 * Unit tests for malformed flag detection
 * Issue #1092: `-- model` does not produce error
 *
 * Tests the detectMalformedFlags function that catches malformed flag patterns
 * like "-- model" (with space after --) instead of "--model".
 */

import { strict as assert } from 'assert';

// Import the actual detection function
const { detectMalformedFlags } = await import('../src/option-suggestions.lib.mjs');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`FAILED: ${error.message}`);
    testsFailed++;
  }
}

// ============================================================================
// Issue #1092: Main scenario - "-- model" split by tokenizer into ['--', 'model']
// ============================================================================

runTest('Issue #1092: detects "--" followed by "model"', () => {
  const result = detectMalformedFlags(['https://github.com/test/test/issues/1', '--', 'model', 'opus']);
  assert.strictEqual(result.malformed.length, 1, 'Should detect one malformed pattern');
  assert.ok(result.errors[0].includes('-- model'), 'Error should mention "-- model"');
  assert.ok(result.errors[0].includes('--model'), 'Error should suggest "--model"');
});

runTest('Issue #1092: detects "--" followed by "verbose"', () => {
  const result = detectMalformedFlags(['https://github.com/test/test/issues/1', '--', 'verbose']);
  assert.strictEqual(result.malformed.length, 1, 'Should detect one malformed pattern');
  assert.ok(result.errors[0].includes('-- verbose'), 'Error should mention "-- verbose"');
});

runTest('Issue #1092: detects "--" followed by "tool"', () => {
  const result = detectMalformedFlags(['https://github.com/test/test/issues/1', '--', 'tool', 'claude']);
  assert.strictEqual(result.malformed.length, 1, 'Should detect one malformed pattern');
  assert.ok(result.errors[0].includes('-- tool'), 'Error should mention "-- tool"');
});

runTest('Issue #1092: detects "--" followed by "fork"', () => {
  const result = detectMalformedFlags(['https://github.com/test/test/issues/1', '--', 'fork']);
  assert.strictEqual(result.malformed.length, 1, 'Should detect one malformed pattern');
  assert.ok(result.errors[0].includes('-- fork'), 'Error should mention "-- fork"');
});

runTest('Issue #1092: detects "--" followed by "dry-run"', () => {
  const result = detectMalformedFlags(['https://github.com/test/test/issues/1', '--', 'dry-run']);
  assert.strictEqual(result.malformed.length, 1, 'Should detect one malformed pattern');
  assert.ok(result.errors[0].includes('-- dry-run'), 'Error should mention "-- dry-run"');
});

// ============================================================================
// Single argument with space after -- (e.g., shell passes "-- model" as one arg)
// ============================================================================

runTest('detects "-- model" as single argument', () => {
  const result = detectMalformedFlags(['https://github.com/test/test/issues/1', '-- model', 'opus']);
  assert.strictEqual(result.malformed.length, 1, 'Should detect one malformed pattern');
  assert.ok(result.errors[0].includes('-- model'), 'Error should mention "-- model"');
});

runTest('detects "-- verbose" as single argument', () => {
  const result = detectMalformedFlags(['-- verbose']);
  assert.strictEqual(result.malformed.length, 1, 'Should detect one malformed pattern');
});

// ============================================================================
// Other malformed patterns
// ============================================================================

runTest('detects "-model" (single dash for long option)', () => {
  const result = detectMalformedFlags(['-model', 'opus']);
  assert.strictEqual(result.malformed.length, 1, 'Should detect one malformed pattern');
  assert.ok(result.errors[0].includes('Single dash'), 'Error should mention single dash');
  assert.ok(result.errors[0].includes('--model'), 'Error should suggest "--model"');
});

runTest('detects "-verbose" (single dash for long option)', () => {
  const result = detectMalformedFlags(['-verbose']);
  assert.strictEqual(result.malformed.length, 1, 'Should detect one malformed pattern');
});

runTest('detects "---model" (triple dash)', () => {
  const result = detectMalformedFlags(['---model', 'opus']);
  assert.strictEqual(result.malformed.length, 1, 'Should detect one malformed pattern');
  assert.ok(result.errors[0].includes('Too many dashes'), 'Error should mention too many dashes');
});

runTest('detects "- -model" (space between dashes)', () => {
  const result = detectMalformedFlags(['- -model', 'opus']);
  assert.strictEqual(result.malformed.length, 1, 'Should detect one malformed pattern');
  assert.ok(result.errors[0].includes('Space between dashes'), 'Error should mention space between dashes');
});

// ============================================================================
// Valid cases (should NOT produce errors)
// ============================================================================

runTest('accepts valid "--model opus"', () => {
  const result = detectMalformedFlags(['--model', 'opus']);
  assert.strictEqual(result.malformed.length, 0, 'Should not detect any malformed patterns');
});

runTest('accepts valid "-m opus" (short form)', () => {
  const result = detectMalformedFlags(['-m', 'opus']);
  assert.strictEqual(result.malformed.length, 0, 'Should not detect any malformed patterns');
});

runTest('accepts valid "--verbose"', () => {
  const result = detectMalformedFlags(['--verbose']);
  assert.strictEqual(result.malformed.length, 0, 'Should not detect any malformed patterns');
});

runTest('accepts valid URL with options', () => {
  const result = detectMalformedFlags(['https://github.com/test/test/issues/1', '--model', 'opus', '--verbose']);
  assert.strictEqual(result.malformed.length, 0, 'Should not detect any malformed patterns');
});

runTest('accepts standalone "--" at end (valid POSIX marker)', () => {
  const result = detectMalformedFlags(['https://github.com/test/test/issues/1', '--']);
  assert.strictEqual(result.malformed.length, 0, 'Should not detect any malformed patterns');
});

runTest('accepts "--" followed by non-option word', () => {
  const result = detectMalformedFlags(['https://github.com/test/test/issues/1', '--', 'someRandomText']);
  assert.strictEqual(result.malformed.length, 0, 'Should not detect any malformed patterns');
});

runTest('accepts "--" followed by URL-like text', () => {
  const result = detectMalformedFlags(['--', 'https://example.com']);
  assert.strictEqual(result.malformed.length, 0, 'Should not detect any malformed patterns');
});

runTest('accepts "--" followed by path-like text', () => {
  const result = detectMalformedFlags(['--', '/some/path/file.txt']);
  assert.strictEqual(result.malformed.length, 0, 'Should not detect any malformed patterns');
});

// ============================================================================
// Edge cases
// ============================================================================

runTest('handles empty args array', () => {
  const result = detectMalformedFlags([]);
  assert.strictEqual(result.malformed.length, 0, 'Should not detect any malformed patterns');
});

runTest('handles args with only URL', () => {
  const result = detectMalformedFlags(['https://github.com/test/test/issues/1']);
  assert.strictEqual(result.malformed.length, 0, 'Should not detect any malformed patterns');
});

runTest('detects multiple malformed patterns', () => {
  const result = detectMalformedFlags(['-model', 'opus', '---verbose']);
  assert.strictEqual(result.malformed.length, 2, 'Should detect two malformed patterns');
});

// ============================================================================
// Case sensitivity
// ============================================================================

runTest('Issue #1092: detects "--" followed by "Model" (capital M)', () => {
  // The KNOWN_OPTION_NAMES list should handle case-insensitive matching
  const result = detectMalformedFlags(['https://github.com/test/test/issues/1', '--', 'Model', 'opus']);
  assert.strictEqual(result.malformed.length, 1, 'Should detect one malformed pattern (case-insensitive)');
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(50));
console.log(`Test Results for malformed flag detection:`);
console.log(`  Passed: ${testsPassed}`);
console.log(`  Failed: ${testsFailed}`);
console.log('='.repeat(50));

// Exit with appropriate code
process.exit(testsFailed > 0 ? 1 : 0);
