#!/usr/bin/env node
/**
 * Regression coverage for issue #2082, finding F5: the npm publish/verify race.
 *
 * Observed in CI run 29647956700 (a GREEN run):
 *   14:38:40  Publish attempt 1 of 3...
 *   14:38:46  success packages published successfully: @link-assistant/hive-mind@2.8.3
 *   14:38:46  Creating git tag... New tag: v2.8.3
 *   14:38:46  npm error code E404          <- verification, 0.3s after publish
 *   14:38:56  Publish attempt 2 of 3...    <- re-runs the WHOLE publish
 *   14:38:59  error npm error You cannot publish over the previously published versions: 2.8.3.
 *   14:39:09  Publish attempt 3 of 3...
 *   14:39:10  Verified @link-assistant/hive-mind@2.8.3 is live on npm
 *
 * The publish SUCCEEDED on attempt 1. The npm registry simply had not
 * propagated it yet (see npm/cli#3424, #9043, #593). The retry granularity was
 * wrong: a failed *verification* re-ran the entire *publish*, which then failed
 * legitimately. The run went green only because a third attempt fit in the
 * budget — and only because by then there were no changesets left to publish.
 *
 * These tests pin the corrected behaviour:
 *   1. verification is polled with backoff rather than checked once;
 *   2. a publish that reported success is NEVER re-run;
 *   3. "cannot publish over the previously published versions" for the version
 *      we are releasing means it is already there — verify, don't fail.
 *
 * The npm/git runner is fully mocked; this test never touches the network.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2082
 */

import assert from 'node:assert/strict';

import { isVersionConflict } from '../scripts/publish-failure-classifier.mjs';
import { publishWithRetry, PACKAGE_NAME } from '../scripts/publish-to-npm.mjs';

const VERSION = '2.8.3';
const noSleep = async () => {};
const quietLogger = { log: () => {}, error: () => {} };

const PUBLISH_SUCCESS = {
  code: 0,
  stdout: `🦋  success packages published successfully:\n🦋  ${PACKAGE_NAME}@${VERSION}\n🦋  Creating git tag...\n`,
  stderr: '',
};

const PUBLISH_CONFLICT = {
  code: 1,
  stdout: '',
  stderr: `🦋  error an error occurred while publishing ${PACKAGE_NAME}: undefined You cannot publish over the previously published versions: ${VERSION}.\n🦋  error npm error code EPUBLISHCONFLICT\n`,
};

/**
 * Build a runner where `npm view` fails the first `viewFailures` times, mimicking
 * registry propagation lag, and `npm run changeset:publish` returns scripted results.
 */
function createRunner({ viewFailures = 0, publishResults = [PUBLISH_SUCCESS] } = {}) {
  const calls = [];
  let views = 0;
  let publishes = 0;
  const runner = async (command, args) => {
    const key = [command, ...args].join(' ');
    calls.push(key);
    if (command === 'npm' && args[0] === 'view') {
      views += 1;
      return views <= viewFailures ? { code: 1, stdout: '', stderr: 'npm error code E404\n' } : { code: 0, stdout: `${VERSION}\n`, stderr: '' };
    }
    if (command === 'npm' && args[0] === 'run') {
      const result = publishResults[Math.min(publishes, publishResults.length - 1)];
      publishes += 1;
      return result;
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return {
    runner,
    calls,
    get publishCount() {
      return publishes;
    },
    get viewCount() {
      return views;
    },
  };
}

const run = harness =>
  publishWithRetry({
    runner: harness.runner,
    version: VERSION,
    sleeper: noSleep,
    logger: quietLogger,
  });

// --- 1. Propagation lag is absorbed by polling, not by republishing -------

{
  // Exactly the production scenario: publish works, the registry lags briefly.
  const harness = createRunner({ viewFailures: 3 });
  const result = await run(harness);

  assert.equal(result.ok, true, 'a successful publish followed by a lagging registry must be reported as success');
  assert.equal(harness.publishCount, 1, 'the publish must run exactly once — re-running it caused the EPUBLISHCONFLICT in production');
  assert.ok(harness.viewCount > 1, 'verification must be polled with backoff rather than checked once');
}

// --- 2. A publish that reported success is never re-run --------------------

{
  // The registry never catches up. This must fail — the #2028 protection stays —
  // but it must NOT try to publish again.
  const harness = createRunner({ viewFailures: Number.MAX_SAFE_INTEGER });
  const result = await run(harness);

  assert.equal(result.ok, false, 'a version that never appears on the registry must still fail the release');
  assert.match(result.reason, /verification/i, 'the failure is attributed to verification, not to publishing');
  assert.equal(harness.publishCount, 1, 'a publish that reported success must never be repeated');
}

// --- 3. A genuine publish failure is still retried -------------------------

{
  const transientFailure = { code: 1, stdout: '', stderr: 'npm error code ECONNRESET\n' };
  const harness = createRunner({ publishResults: [transientFailure, PUBLISH_SUCCESS] });
  const result = await run(harness);

  assert.equal(result.ok, true, 'a transient publish failure is retried and can still succeed');
  assert.equal(harness.publishCount, 2, 'the publish is retried when it genuinely failed');
}

// --- 4. EPUBLISHCONFLICT for our version means it is already published -----

{
  assert.equal(isVersionConflict(PUBLISH_CONFLICT.stderr, VERSION), true, 'the conflict message for our version is recognised');
  assert.equal(isVersionConflict(PUBLISH_CONFLICT.stderr, '9.9.9'), false, 'a conflict naming a different version is not ours');
  assert.equal(isVersionConflict('npm error code E404', VERSION), false, 'an unrelated error is not a conflict');
}

{
  // A re-run of the release job after a partial failure: the version is already
  // on the registry, so changeset publish conflicts. That is success, not failure.
  const harness = createRunner({ publishResults: [PUBLISH_CONFLICT] });
  const result = await run(harness);

  assert.equal(result.ok, true, 'publishing over an existing version means the release already landed — verify, do not fail');
  assert.equal(harness.publishCount, 1, 'a conflict is resolved by verification, not by another publish attempt');
}

{
  // A conflict must NOT be trusted blindly: if the version is genuinely absent
  // from the registry, the release still fails.
  const harness = createRunner({ publishResults: [PUBLISH_CONFLICT], viewFailures: Number.MAX_SAFE_INTEGER });
  const result = await run(harness);
  assert.equal(result.ok, false, 'a conflict is only success when verification confirms the version is live');
}

console.log('publish-verification-race-2082.test.mjs: all assertions passed');
