#!/usr/bin/env node
/**
 * Unit tests for scripts/publish-to-npm.mjs.
 *
 * Reproduces and locks down the false-positive release from issue #2028
 * (CI run 29035249489): a failed `changeset publish` was reported as a
 * successful release because command-stream's `$` never throws on a non-zero
 * exit, and `changeset publish` can print a failure while exiting 0.
 *
 * The npm/git runner is fully mocked, so this test never touches the network,
 * npm, or git.
 *
 * Run with: node tests/test-publish-to-npm-2028.mjs
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2028
 */

import assert from 'node:assert/strict';
import { analyzePublishResult, publishWithRetry, runPublishFlow, isVersionPublished, PACKAGE_NAME } from '../scripts/publish-to-npm.mjs';

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

const noSleep = async () => {};
const quietLogger = { log: () => {}, error: () => {} };
const VERSION = '2.1.10';

// Build a runner that returns scripted results keyed by command. Each key maps
// to a queue; the last entry repeats once exhausted. Records all calls.
const makeRunner = handlers => {
  const calls = [];
  const runner = async (command, args) => {
    calls.push({ command, args });
    const key = `${command} ${args.join(' ')}`;
    for (const [pattern, queue] of Object.entries(handlers)) {
      if (key.startsWith(pattern)) {
        const idx = Math.min(queue.calledSoFar ?? 0, queue.results.length - 1);
        queue.calledSoFar = (queue.calledSoFar ?? 0) + 1;
        return queue.results[idx];
      }
    }
    throw new Error(`Unexpected command in test: ${key}`);
  };
  runner.calls = calls;
  return runner;
};

const q = (...results) => ({ results });

const NOT_PUBLISHED = { code: 1, stdout: '', stderr: 'npm error 404', message: '' };
const IS_PUBLISHED = { code: 0, stdout: VERSION, stderr: '', message: '' };
const PUBLISH_OK = { code: 0, stdout: `success Published ${PACKAGE_NAME}@${VERSION}`, stderr: '', message: '' };

// The exact failure mode of run 29035249489: exit 0, but changeset prints the
// failure text (npm's non-zero exit is masked by changeset).
const PUBLISH_FALSE_POSITIVE = {
  code: 0,
  stdout: 'info Publishing...',
  stderr: "🦋  error packages failed to publish\nError: Cannot find module 'sigstore'",
  message: '',
};

await test('analyzePublishResult: exit 0 + failure text => NOT ok (the #2028 bug)', async () => {
  const analysis = analyzePublishResult(PUBLISH_FALSE_POSITIVE);
  assert.equal(analysis.ok, false, 'a masked failure must not be reported as success');
});

await test('analyzePublishResult: non-zero exit => NOT ok', async () => {
  assert.equal(analyzePublishResult({ code: 1, stdout: '', stderr: '' }).ok, false);
});

await test('analyzePublishResult: exit 0 + clean output => ok', async () => {
  assert.equal(analyzePublishResult(PUBLISH_OK).ok, true);
});

await test('publishWithRetry: verifies on npm and does NOT falsely succeed', async () => {
  // changeset "succeeds" (exit 0, clean output) but the version never lands on
  // npm — post-publish verification must catch this and report failure.
  const runner = makeRunner({
    'npm run changeset:publish': q(PUBLISH_OK, PUBLISH_OK, PUBLISH_OK),
    'npm view': q(NOT_PUBLISHED),
  });
  const result = await publishWithRetry({ runner, version: VERSION, sleeper: noSleep, logger: quietLogger });
  assert.equal(result.ok, false, 'must fail when the version is not actually on npm');
});

await test('publishWithRetry: succeeds when publish works and npm confirms', async () => {
  const runner = makeRunner({
    'npm run changeset:publish': q(PUBLISH_OK),
    'npm view': q(IS_PUBLISHED),
  });
  const result = await publishWithRetry({ runner, version: VERSION, sleeper: noSleep, logger: quietLogger });
  assert.equal(result.ok, true);
  assert.equal(result.attempt, 1);
});

await test('publishWithRetry: retries a transient (sigstore) failure', async () => {
  const runner = makeRunner({
    'npm run changeset:publish': q(PUBLISH_FALSE_POSITIVE, PUBLISH_OK),
    'npm view': q(IS_PUBLISHED),
  });
  const result = await publishWithRetry({ runner, version: VERSION, sleeper: noSleep, logger: quietLogger });
  assert.equal(result.ok, true);
  assert.equal(result.attempt, 2, 'should succeed on the second attempt');
});

await test('publishWithRetry: fast-fails a non-retryable auth error', async () => {
  const AUTH_FAIL = { code: 1, stdout: '', stderr: 'npm error 401 Unauthorized\nENEEDAUTH', message: '' };
  const runner = makeRunner({
    'npm run changeset:publish': q(AUTH_FAIL),
    'npm view': q(NOT_PUBLISHED),
  });
  const result = await publishWithRetry({ runner, version: VERSION, sleeper: noSleep, logger: quietLogger });
  assert.equal(result.ok, false);
  assert.equal(result.nonRetryable, true);
  assert.equal(result.attempt, 1, 'must not retry an auth failure');
});

await test('runPublishFlow: skips publish when version already on npm', async () => {
  const outputs = {};
  const runner = makeRunner({ 'npm view': q(IS_PUBLISHED) });
  const result = await runPublishFlow({
    runner,
    shouldPull: false,
    version: VERSION,
    output: (k, v) => {
      outputs[k] = v;
    },
    sleeper: noSleep,
    logger: quietLogger,
  });
  assert.equal(result.published, true);
  assert.equal(result.alreadyPublished, true);
  assert.equal(outputs.published, 'true');
  assert.equal(outputs.already_published, 'true');
  // Must not attempt to publish.
  assert.ok(!runner.calls.some(c => `${c.command} ${c.args.join(' ')}`.startsWith('npm run changeset:publish')));
});

await test('runPublishFlow: sets published=false on a masked failure', async () => {
  const outputs = {};
  const runner = makeRunner({
    'npm view': q(NOT_PUBLISHED, NOT_PUBLISHED, NOT_PUBLISHED, NOT_PUBLISHED),
    'npm run changeset:publish': q(PUBLISH_FALSE_POSITIVE),
  });
  const result = await runPublishFlow({
    runner,
    shouldPull: false,
    version: VERSION,
    output: (k, v) => {
      outputs[k] = v;
    },
    sleeper: noSleep,
    logger: quietLogger,
  });
  assert.equal(result.published, false);
  assert.equal(outputs.published, 'false');
  assert.notEqual(outputs.published_version, VERSION);
});

await test('isVersionPublished: maps exit code to boolean', async () => {
  assert.equal(await isVersionPublished(async () => IS_PUBLISHED, VERSION), true);
  assert.equal(await isVersionPublished(async () => NOT_PUBLISHED, VERSION), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
