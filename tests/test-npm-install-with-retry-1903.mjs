#!/usr/bin/env node
/**
 * Unit tests for scripts/npm-install-with-retry.mjs.
 *
 * Verifies:
 *   - a clean exit (code 0) returns ok on the first attempt with no retry
 *   - a transient network failure (ECONNRESET / "network aborted") is retried
 *     and succeeds once npm recovers
 *   - a non-retryable failure (e.g. E404) aborts immediately without retrying
 *   - the wrapper gives up after the configured number of attempts
 *
 * The npm runner is fully mocked, so this test never touches the network or npm.
 *
 * Run with: node tests/test-npm-install-with-retry-1903.mjs
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/1903
 */

import assert from 'node:assert/strict';
import { installWithRetry } from '../scripts/npm-install-with-retry.mjs';

let passed = 0;
let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ ${name}\n   ${err?.stack || err}`);
    failed++;
  }
};

// A runner factory that returns queued results in order and records calls.
const makeRunner = results => {
  const calls = [];
  const runner = async args => {
    calls.push(args);
    return results[Math.min(calls.length - 1, results.length - 1)];
  };
  runner.calls = calls;
  return runner;
};

const noSleep = async () => {};

const ECONNRESET = { code: 1, stdout: '', stderr: 'npm error code ECONNRESET\nnpm error network aborted', message: '' };
const SUCCESS = { code: 0, stdout: 'added 200 packages', stderr: '', message: '' };
const E404 = { code: 1, stdout: '', stderr: 'npm error code E404\nnpm error 404 Not Found', message: '' };

await test('succeeds on first attempt without retrying', async () => {
  const runner = makeRunner([SUCCESS]);
  const result = await installWithRetry({ args: ['install'], runner, sleeper: noSleep });
  assert.equal(result.ok, true);
  assert.equal(result.attempt, 1);
  assert.equal(runner.calls.length, 1);
});

await test('retries ECONNRESET then succeeds', async () => {
  const runner = makeRunner([ECONNRESET, ECONNRESET, SUCCESS]);
  const result = await installWithRetry({ args: ['ci'], runner, sleeper: noSleep, baseDelayMs: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.attempt, 3);
  assert.equal(runner.calls.length, 3);
  assert.deepEqual(runner.calls[0], ['ci']);
});

await test('does not retry a non-retryable error (E404)', async () => {
  const runner = makeRunner([E404, SUCCESS]);
  const result = await installWithRetry({ args: ['install'], runner, sleeper: noSleep });
  assert.equal(result.ok, false);
  assert.equal(result.attempt, 1);
  assert.equal(runner.calls.length, 1, 'should abort immediately, not retry');
});

await test('gives up after the configured number of attempts', async () => {
  const runner = makeRunner([ECONNRESET]);
  const result = await installWithRetry({ args: ['install'], attempts: 4, runner, sleeper: noSleep, baseDelayMs: 1 });
  assert.equal(result.ok, false);
  assert.equal(runner.calls.length, 4);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
