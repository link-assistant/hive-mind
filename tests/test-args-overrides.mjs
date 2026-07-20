#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Unit tests for the shared `mergeArgsWithOverrides` helper (issue #2085).
 *
 * The helper was extracted from telegram-bot.mjs into src/args-overrides.lib.mjs
 * so `/solve`, `/hive` and `/fix` share the exact same merge semantics. These
 * tests exercise the real exported implementation (not a copied replica).
 */

import assert from 'assert/strict';
import { mergeArgsWithOverrides } from '../src/args-overrides.lib.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.message}`);
    failed++;
  }
}

test('no overrides returns the user args unchanged', () => {
  const userArgs = ['url', '--model', 'opus'];
  assert.deepEqual(mergeArgsWithOverrides(userArgs, []), userArgs);
  assert.deepEqual(mergeArgsWithOverrides(userArgs, null), userArgs);
  assert.deepEqual(mergeArgsWithOverrides(userArgs, undefined), userArgs);
});

test('boolean override is appended', () => {
  assert.deepEqual(mergeArgsWithOverrides(['url'], ['--attach-logs']), ['url', '--attach-logs']);
});

test('override with a value is appended', () => {
  assert.deepEqual(mergeArgsWithOverrides(['url'], ['--model', 'opus']), ['url', '--model', 'opus']);
});

test('override replaces a conflicting user value flag', () => {
  assert.deepEqual(mergeArgsWithOverrides(['url', '--model', 'sonnet'], ['--model', 'opus']), ['url', '--model', 'opus']);
});

test('override replaces a conflicting user boolean flag', () => {
  assert.deepEqual(mergeArgsWithOverrides(['url', '--verbose'], ['--verbose', '--attach-logs']), ['url', '--verbose', '--attach-logs']);
});

test('positionals and non-conflicting user flags are preserved in order', () => {
  assert.deepEqual(mergeArgsWithOverrides(['url', '--think', 'max', '--model', 'sonnet'], ['--model', 'opus', '--attach-logs']), ['url', '--think', 'max', '--model', 'opus', '--attach-logs']);
});

test('non-array userArgs is treated as empty', () => {
  assert.deepEqual(mergeArgsWithOverrides(undefined, ['--attach-logs']), ['--attach-logs']);
  assert.deepEqual(mergeArgsWithOverrides(null, ['--attach-logs']), ['--attach-logs']);
});

test('non-array userArgs with no overrides returns empty array', () => {
  assert.deepEqual(mergeArgsWithOverrides(undefined, []), []);
  assert.deepEqual(mergeArgsWithOverrides(null, undefined), []);
});

console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
