#!/usr/bin/env node
/**
 * Tests for interruptible-sleep.lib.mjs
 *
 * Verifies that:
 * - interruptibleSleep resolves after the specified duration
 * - interruptibleSleep resolves immediately on SIGINT
 * - SIGINT listeners are cleaned up after resolution
 *
 * Run with: node tests/interruptible-sleep.test.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1574
 */

import assert from 'node:assert/strict';
import { interruptibleSleep } from '../src/interruptible-sleep.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  return fn()
    .then(() => {
      console.log(`✅ ${name}`);
      testsPassed++;
    })
    .catch(error => {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${error.message}`);
      testsFailed++;
    });
}

// Guard: prevent any SIGINT from actually killing the test process.
// We add this before any tests and remove it after SIGINT-related tests.
const preventExit = () => {};
process.on('SIGINT', preventExit);

// Override process.exit to prevent the exit handler from killing the process
const originalExit = process.exit;
process.exit = code => {
  // During tests, swallow SIGINT exits (code 130)
  if (code === 130) return;
  originalExit(code);
};

await test('resolves after specified duration with interrupted=false', async () => {
  const start = Date.now();
  const result = await interruptibleSleep(100);
  const elapsed = Date.now() - start;
  assert.equal(result.interrupted, false);
  assert.ok(elapsed >= 80, `Expected >=80ms, got ${elapsed}ms`);
  assert.ok(elapsed < 500, `Expected <500ms, got ${elapsed}ms`);
});

await test('resolves immediately on SIGINT with interrupted=true', async () => {
  const sleepPromise = interruptibleSleep(60000);
  await new Promise(r => setTimeout(r, 10));

  const start = Date.now();
  process.emit('SIGINT');

  const result = await sleepPromise;
  const elapsed = Date.now() - start;

  assert.equal(result.interrupted, true);
  assert.ok(elapsed < 200, `Expected near-instant resolution, got ${elapsed}ms`);
});

await test('cleans up SIGINT listener after normal resolution', async () => {
  const listenersBefore = process.listenerCount('SIGINT');
  await interruptibleSleep(50);
  assert.equal(process.listenerCount('SIGINT'), listenersBefore);
});

await test('cleans up SIGINT listener after interrupt', async () => {
  const listenersBefore = process.listenerCount('SIGINT');
  const sleepPromise = interruptibleSleep(60000);
  await new Promise(r => setTimeout(r, 10));
  process.emit('SIGINT');
  await sleepPromise;
  assert.equal(process.listenerCount('SIGINT'), listenersBefore);
});

await test('does not interfere with other SIGINT listeners', async () => {
  let otherListenerCalled = false;
  const otherListener = () => {
    otherListenerCalled = true;
  };
  process.on('SIGINT', otherListener);

  const sleepPromise = interruptibleSleep(60000);
  await new Promise(r => setTimeout(r, 10));
  process.emit('SIGINT');
  await sleepPromise;

  assert.equal(otherListenerCalled, true, 'Other SIGINT listener should still fire');
  process.removeListener('SIGINT', otherListener);
});

// Restore original process.exit and remove guard
process.exit = originalExit;
process.removeListener('SIGINT', preventExit);

// Summary
console.log(`\n${testsPassed + testsFailed} tests: ${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) {
  process.exit(1);
}
