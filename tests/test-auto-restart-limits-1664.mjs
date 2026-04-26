#!/usr/bin/env node

/**
 * Regression tests for issue #1664.
 *
 * The failing production run posted auto-restart notifications for iterations 2-9,
 * but no per-session completion logs. The root cause was that the restart loop ran
 * `git pull` while an unfinished merge was already present, so the tool was never
 * invoked for those iterations.
 */

import assert from 'assert';
import { SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';
import { DEFAULT_AUTO_ITERATION_LIMIT, hasReachedAutoIterationLimit, normalizeAutoIterationLimit, shouldSyncBeforeRestart } from '../src/auto-iteration-limits.lib.mjs';

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test('default auto iteration limit is 5', () => {
  assert.strictEqual(DEFAULT_AUTO_ITERATION_LIMIT, 5);
  assert.strictEqual(SOLVE_OPTION_DEFINITIONS['auto-restart-max-iterations'].default, 5);
  assert.strictEqual(SOLVE_OPTION_DEFINITIONS['auto-resume-max-iterations'].default, 5);
});

test('iteration limit helper allows exactly the configured number of executions', () => {
  assert.strictEqual(hasReachedAutoIterationLimit(0, 5), false);
  assert.strictEqual(hasReachedAutoIterationLimit(4, 5), false);
  assert.strictEqual(hasReachedAutoIterationLimit(5, 5), true);
  assert.strictEqual(hasReachedAutoIterationLimit(9, 5), true);
});

test('zero disables the auto iteration limit for explicit opt-out', () => {
  assert.strictEqual(normalizeAutoIterationLimit(0), 0);
  assert.strictEqual(hasReachedAutoIterationLimit(100, 0), false);
});

test('invalid limit values fall back to the safe default', () => {
  assert.strictEqual(normalizeAutoIterationLimit(undefined), 5);
  assert.strictEqual(normalizeAutoIterationLimit(null), 5);
  assert.strictEqual(normalizeAutoIterationLimit('not-a-number'), 5);
  assert.strictEqual(normalizeAutoIterationLimit(-1), 5);
});

test('auto-restart skips branch sync when uncommitted changes are present', () => {
  assert.strictEqual(shouldSyncBeforeRestart({ hasUncommittedChanges: true }), false);
  assert.strictEqual(shouldSyncBeforeRestart({ hasUncommittedChanges: false }), true);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exit(1);
  }
}

console.log(`All ${passed} issue #1664 auto-restart limit tests passed.`);
