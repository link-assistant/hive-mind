#!/usr/bin/env node
/**
 * Regression coverage for issue #2923: npm took longer to expose a published
 * version than post-publish verification waited, so a successful release was
 * reported as failed (a false negative).
 *
 * Observed in CI run 37983302098 (Checks and release, main, fdff413):
 *   21:03:22  Successfully published: @link-assistant/hive-mind@2.35.1
 *   21:03:23  not visible yet (check 1 of 15) ... (check 14 of 15)
 *   21:08:57  ERROR: post-publish verification failed ... never appeared on npm
 *   ~21:17:53 npm's publish attestation for 2.35.1 is recorded (874s after the
 *             SLSA provenance signed at 21:03:19)
 *
 * The same happened to 2.34.1 in run 37723257263 (377s lag). Docker images,
 * the Helm chart and the GitHub release were skipped for both versions.
 * Measure the lag with experiments/npm-publish-lag-2923.mjs.
 *
 * The npm runner and the clock are fully mocked; this test never touches the
 * network or actually sleeps.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2923
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { isVersionConflict } from '../scripts/publish-failure-classifier.mjs';
import { DEFAULT_VERIFY_ATTEMPTS, DEFAULT_VERIFY_DELAY_MS, DEFAULT_VERIFY_MAX_DELAY_MS, isVersionPublished, publishWithRetry, runPublishFlow, waitForVersionOnRegistry } from '../scripts/publish-to-npm.mjs';

const VERSION = '2.35.1';
const OBSERVED_LAG_MS = 874_000;
const STAGED = `npm error code E409\nnpm error 409 Conflict - PUT https://registry.npmjs.org/@link-assistant%2fhive-mind - Cannot publish over previously staged version "${VERSION}"`;

/** A registry that exposes the version `lagMs` after the publish, on a simulated clock. */
function laggingRegistry({ lagMs = OBSERVED_LAG_MS, publishResult = { code: 0, stdout: 'Successfully published' } } = {}) {
  const state = { now: 0, publishes: 0, views: [], logs: [] };
  state.sleeper = async ms => {
    state.now += ms;
  };
  state.logger = { log: line => state.logs.push(line), error: line => state.logs.push(line) };
  state.runner = async (command, args, opts) => {
    if (args[0] === 'view') {
      state.views.push(opts);
      return { code: state.now >= lagMs ? 0 : 1, stdout: '', stderr: 'npm error code E404' };
    }
    if (args[1] === 'changeset:publish') {
      state.publishes++;
      return publishResult;
    }
    return { code: 0 };
  };
  return state;
}

function windowMs(attempts = DEFAULT_VERIFY_ATTEMPTS) {
  let total = 0;
  for (let attempt = 1, delay = DEFAULT_VERIFY_DELAY_MS; attempt < attempts; attempt++, delay = Math.min(delay * 2, DEFAULT_VERIFY_MAX_DELAY_MS)) total += delay;
  return total;
}

test('the previous 15-check window (330s) misses the 874s lag of 2.35.1', async () => {
  const registry = laggingRegistry();
  assert.equal(windowMs(15), 330_000);
  assert.equal(await waitForVersionOnRegistry({ runner: registry.runner, version: VERSION, attempts: 15, sleeper: registry.sleeper, logger: registry.logger }), false);
});

test('the default window covers the slowest observed lag with margin', () => {
  assert.ok(windowMs() >= 1.5 * OBSERVED_LAG_MS, `window ${windowMs()}ms must be at least 1.5x the 874s lag`);
});

test('a release that npm exposes after 874s is verified, published once, and reported as published', async () => {
  const registry = laggingRegistry();
  const outputs = {};
  const result = await runPublishFlow({ runner: registry.runner, shouldPull: false, version: VERSION, output: (key, value) => (outputs[key] = value), sleeper: registry.sleeper, logger: registry.logger });
  assert.deepEqual(result, { published: true });
  assert.equal(registry.publishes, 1, 'a publish that reported success is never repeated');
  assert.deepEqual(outputs, { published: 'true', published_version: VERSION });
  assert.ok(
    registry.logs.some(line => /Verified .*2\.35\.1 is live on npm \(check \d+ of 54, after ~\d+s\)/.test(line)),
    'the log records how long npm took'
  );
});

test('E409 "previously staged version" for our version is an already-landed release, not a failure', async () => {
  assert.equal(isVersionConflict(STAGED, VERSION), true);
  assert.equal(isVersionConflict('error an error occurred while publishing command-stream: E409 409 Conflict - PUT https://registry.npmjs.org/command-stream - Cannot publish over previously staged version "0.20.0".', '0.20.0'), true);
  assert.equal(isVersionConflict(STAGED, '2.35.2'), false, 'a conflict on another version never matches');

  // A re-run during npm's propagation window: the version is staged but still invisible.
  const registry = laggingRegistry({ publishResult: { code: 1, stdout: '', stderr: STAGED } });
  const result = await publishWithRetry({ runner: registry.runner, version: VERSION, sleeper: registry.sleeper, logger: registry.logger });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyPublished, true);
  assert.equal(registry.publishes, 1, 'a permanent conflict is verified, not retried');
});

test('registry probes are quiet by default and verbose with HIVE_MIND_PUBLISH_VERBOSE=true', async () => {
  const registry = laggingRegistry({ lagMs: 0 });
  await isVersionPublished(registry.runner, VERSION, { env: {} });
  await isVersionPublished(registry.runner, VERSION, { env: { HIVE_MIND_PUBLISH_VERBOSE: 'true' } });
  assert.deepEqual(registry.views, [{ quiet: true }, { quiet: false }]);
});

test('both publishing jobs allow the full verification window before timing out', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  for (const job of ['release', 'instant-release']) {
    const body = workflow.split(new RegExp(`\\n  ${job}:\\n`))[1]?.split(/\n {2}[a-z][\w-]*:\n/)[0];
    assert.ok(body, `job ${job} exists`);
    const minutes = Number(body.match(/timeout-minutes:\s*(\d+)/)?.[1]);
    // Setup, install and versioning took ~1 minute before publishing in run 37983302098.
    assert.ok(minutes * 60_000 >= windowMs() + 10 * 60_000, `${job} timeout ${minutes}m must exceed the ${windowMs() / 60_000}m verification window by 10m`);
  }
});
