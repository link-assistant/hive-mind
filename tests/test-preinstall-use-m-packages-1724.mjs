#!/usr/bin/env node
/**
 * Unit tests for scripts/preinstall-use-m-packages.mjs.
 *
 * Verifies:
 *   - alias matches the use-m naming scheme so the pre-install step actually
 *     primes the directory use-m looks up
 *   - retry helper retries only on flaky npm errors (ENOTEMPTY/EBUSY/etc.)
 *   - retry helper succeeds when later attempts work
 *   - retry helper aborts immediately on non-retryable errors
 *   - retry helper treats "package already present" as success after a flake
 *
 * Run with: node tests/test-preinstall-use-m-packages-1724.mjs
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/1724
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aliasForPackage, computeBackoffMs, isRetryableNpmError, installWithRetry } from '../scripts/preinstall-use-m-packages.mjs';

let passed = 0;
let failed = 0;
const test = (name, fn) => {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(
        () => {
          console.log(`✅ ${name}`);
          passed++;
        },
        err => {
          console.error(`❌ ${name}\n   ${err?.stack || err}`);
          failed++;
        }
      );
    }
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ ${name}\n   ${err?.stack || err}`);
    failed++;
  }
};

await test('aliasForPackage strips @ and replaces / for scoped names', () => {
  assert.equal(aliasForPackage('command-stream'), 'command-stream-v-latest');
  assert.equal(aliasForPackage('@dotenvx/dotenvx'), 'dotenvx-dotenvx-v-latest');
  assert.equal(aliasForPackage('links-notation'), 'links-notation-v-latest');
});

await test('isRetryableNpmError detects ENOTEMPTY and friends', () => {
  assert.equal(isRetryableNpmError({ stderr: 'npm error code ENOTEMPTY' }), true);
  assert.equal(isRetryableNpmError({ stderr: 'EBUSY: resource busy or locked' }), true);
  assert.equal(isRetryableNpmError({ message: 'ECONNRESET while talking to registry' }), true);
  assert.equal(isRetryableNpmError({ stderr: 'npm error code E404' }), false);
  assert.equal(isRetryableNpmError(null), false);
});

await test('computeBackoffMs grows exponentially', () => {
  assert.equal(computeBackoffMs(1, 100), 100);
  assert.equal(computeBackoffMs(2, 100), 200);
  assert.equal(computeBackoffMs(3, 100), 400);
});

await test('installWithRetry returns ok on first success', async () => {
  let calls = 0;
  const result = await installWithRetry({
    packageName: 'command-stream',
    alias: 'command-stream-v-latest',
    globalRoot: '/tmp/nonexistent-root',
    runner: async () => {
      calls++;
      return { stdout: '', stderr: '' };
    },
    sleeper: async () => {},
  });
  assert.deepEqual({ ok: result.ok, attempt: result.attempt, calls }, { ok: true, attempt: 1, calls: 1 });
});

await test('installWithRetry retries on ENOTEMPTY then succeeds', async () => {
  let calls = 0;
  const result = await installWithRetry({
    packageName: 'command-stream',
    alias: 'command-stream-v-latest',
    globalRoot: '/tmp/nonexistent-root',
    runner: async () => {
      calls++;
      if (calls < 3) {
        const error = new Error('Command failed: npm install');
        error.stderr = 'npm error code ENOTEMPTY\n';
        throw error;
      }
      return { stdout: '', stderr: '' };
    },
    attempts: 4,
    baseDelayMs: 1,
    sleeper: async () => {},
  });
  assert.deepEqual({ ok: result.ok, attempt: result.attempt, calls }, { ok: true, attempt: 3, calls: 3 });
});

await test('installWithRetry aborts immediately on non-retryable error', async () => {
  let calls = 0;
  const result = await installWithRetry({
    packageName: 'command-stream',
    alias: 'command-stream-v-latest',
    globalRoot: '/tmp/nonexistent-root',
    runner: async () => {
      calls++;
      const error = new Error('Command failed: npm install');
      error.stderr = 'npm error code E404 - Not Found\n';
      throw error;
    },
    attempts: 4,
    baseDelayMs: 1,
    sleeper: async () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(calls, 1);
});

await test('installWithRetry treats package-present-on-disk as recovered success', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'preinstall-1724-'));
  try {
    const alias = 'command-stream-v-latest';
    mkdirSync(join(tmp, alias));
    writeFileSync(join(tmp, alias, 'package.json'), JSON.stringify({ name: 'command-stream', version: '1.0.0' }));
    let calls = 0;
    const result = await installWithRetry({
      packageName: 'command-stream',
      alias,
      globalRoot: tmp,
      runner: async () => {
        calls++;
        const error = new Error('Command failed: npm install');
        error.stderr = 'npm error code ENOTEMPTY\n';
        throw error;
      },
      attempts: 3,
      baseDelayMs: 1,
      sleeper: async () => {},
    });
    assert.deepEqual({ ok: result.ok, recovered: result.recovered, calls }, { ok: true, recovered: true, calls: 1 });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

console.log(`\nPassed: ${passed} / ${passed + failed}`);
process.exit(failed === 0 ? 0 : 1);
