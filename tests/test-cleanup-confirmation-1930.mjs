#!/usr/bin/env node
/**
 * Regression tests for cleanup confirmation parsing (issue #1930).
 *
 * Run with: node tests/test-cleanup-confirmation-1930.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1930
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isConfirmationYes, normalizeConfirmationInput } from '../src/confirmation.lib.mjs';

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

console.log('\n📋 cleanup confirmation (#1930) Tests\n');

test('plain yes confirms deletion', () => {
  assert.equal(isConfirmationYes('yes'), true);
  assert.equal(isConfirmationYes('YES'), true);
  assert.equal(isConfirmationYes(' yes \n'), true);
});

test('hidden Ctrl+Tab terminal escape before yes still confirms', () => {
  assert.equal(isConfirmationYes('\u001b[27;5;9~yes'), true);
});

test('hidden Ctrl+Tab terminal escape after yes still confirms', () => {
  assert.equal(isConfirmationYes('yes\u001b[27;5;9~'), true);
});

test('typed text removed with backspace before yes still confirms', () => {
  assert.equal(normalizeConfirmationInput('no\u007f\u007fyes'), 'yes');
  assert.equal(isConfirmationYes('no\u007f\u007fyes'), true);
});

test('partial or extra visible text does not confirm', () => {
  assert.equal(isConfirmationYes('y'), false);
  assert.equal(isConfirmationYes('yesterday'), false);
  assert.equal(isConfirmationYes('no yes'), false);
});

test('package exposes hive-cleanup as the cleanup executable', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.bin['hive-cleanup'], './src/cleanup.mjs');
  assert.equal(Object.hasOwn(pkg.bin, 'cleanup'), false);
});

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed, ${testsPassed + testsFailed} total\n`);

if (testsFailed > 0) {
  process.exit(1);
}
