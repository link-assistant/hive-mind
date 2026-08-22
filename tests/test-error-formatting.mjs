#!/usr/bin/env node
/**
 * Unit tests for src/error-formatting.lib.mjs (issue #2092).
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { formatFatalError } from '../src/error-formatting.lib.mjs';

let passed = 0;
let failed = 0;

const test = (name, fn) => {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   ${error.stack || error.message}`);
    failed++;
  }
};

const useMFailure = () => {
  const cause = new SyntaxError('Unexpected end of input');
  return new Error("Failed to import module from '/lib/node_modules/command-stream-v-latest/src/$.mjs'.", { cause });
};

test('keeps the one-line summary', () => {
  const output = formatFatalError(new Error('boom'), { verbose: false });
  assert.equal(output, '❌ Error: boom');
});

test('surfaces the cause that was previously dropped', () => {
  const output = formatFatalError(useMFailure(), { verbose: false });
  assert.match(output, /❌ Error: Failed to import module from '.*command-stream-v-latest\/src\/\$\.mjs'\./);
  assert.match(output, /Caused by: SyntaxError: Unexpected end of input/);
});

test('includes the error code when present', () => {
  const error = new Error('Invalid package config /tmp/getenv-v-latest/package.json.');
  error.code = 'ERR_INVALID_PACKAGE_CONFIG';
  assert.match(formatFatalError(error, { verbose: false }), /\(code: ERR_INVALID_PACKAGE_CONFIG\)/);
});

test('walks a nested cause chain', () => {
  const root = new Error('npm exited with code 1');
  const middle = new Error('install failed', { cause: root });
  const top = new Error("Failed to install command-stream@latest globally into '/lib/node_modules'.", { cause: middle });
  const output = formatFatalError(top, { verbose: false });
  assert.match(output, /Caused by: Error: install failed/);
  assert.match(output, /Caused by: Error: npm exited with code 1/);
});

test('adds stacks only in verbose mode', () => {
  const error = useMFailure();
  assert.equal(formatFatalError(error, { verbose: false }).includes('at '), false);
  assert.equal(formatFatalError(error, { verbose: true }).includes('at '), true);
});

test('handles non-Error throws without crashing', () => {
  assert.equal(formatFatalError('plain string', { verbose: false }), '❌ plain string');
  assert.equal(formatFatalError(null, { verbose: false }), '❌ null');
});

test('does not loop forever on a self-referential cause', () => {
  const error = new Error('loop');
  error.cause = error;
  const output = formatFatalError(error, { verbose: false });
  assert.equal(output.split('\n').length, 6); // summary + MAX_CAUSE_DEPTH
});

console.log(`\n📊 ${passed + failed} test(s): ✅ ${passed} passed, ❌ ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
