/** @hive-mind-test-suite default */
// Issue #4055 (F9): 2.40.2 published its main package while npm was still
// processing the 120 MB linux-arm64 native Codex variant (uploaded 22:09:06,
// resolvable 22:24:48). Docker Publish (linux/arm64) installed 2.40.2 at
// 22:24:07, Bun skipped the unresolvable optional dependency without an error,
// and install-native-codex.mjs refused, so no 2.40.2 image was published.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { awaitInstallableVariants, VARIANT_INSTALLABLE_ATTEMPTS, VARIANT_INSTALLABLE_DELAY_MS, VARIANT_INSTALLABLE_MAX_DELAY_MS } from '../scripts/native-codex-packages.mjs';
import { checkInstallable, pinnedVariantSpecs, waitUntilInstallable } from '../scripts/npm-installable.lib.mjs';
import { describeNonRetryableFailure, isNonRetryableFailure } from '../scripts/publish-failure-classifier.mjs';
import { DEFAULT_VERIFY_ATTEMPTS, DEFAULT_VERIFY_DELAY_MS, DEFAULT_VERIFY_MAX_DELAY_MS, publishWithRetry } from '../scripts/publish-to-npm.mjs';

const NAME = '@link-assistant/hive-mind';
const VERSION = '2.40.2';
const X64 = `${NAME}@${VERSION}-native-codex-linux-x64`;
const ARM64 = `${NAME}@${VERSION}-native-codex-linux-arm64`;
const quiet = { log() {}, error() {} };
const variant = arch => ({ name: NAME, version: `${VERSION}-native-codex-linux-${arch}` });

/** A registry clock: each spec becomes resolvable `visibleAfterMs` after the start. */
function registry(visibleAfterMs) {
  let now = 0;
  const views = [];
  const runner = async (command, args, options) => {
    views.push({ args, options });
    const spec = args[1];
    if (!(spec in visibleAfterMs) || now < visibleAfterMs[spec]) return { code: 1, stdout: '', stderr: 'npm error code E404' };
    return { code: 0, stdout: `https://registry.npmjs.org/${spec}.tgz\n` };
  };
  const fetcher = async () => ({ ok: true, status: 200 });
  const sleeper = async ms => {
    now += ms;
  };
  return { runner, fetcher, sleeper, views, elapsed: () => now };
}

// From the 2.40.2 Release job and `npm view @link-assistant/hive-mind time`:
// the wait starts at the arm64 upload (22:09:06); x64 is live at 22:16:15 and
// arm64 at 22:24:48.
const RELEASE_2_40_2 = { [X64]: (7 * 60 + 9) * 1000, [ARM64]: (15 * 60 + 42) * 1000 };

test('the release waits for the late linux-arm64 variant of 2.40.2 before publishing the main package', async () => {
  const npm = registry(RELEASE_2_40_2);
  await awaitInstallableVariants([variant('x64'), variant('arm64')], { ...npm, env: {}, logger: quiet });
  assert.ok(npm.elapsed() >= RELEASE_2_40_2[ARM64], 'no return before arm64 is resolvable');
  assert.ok(npm.elapsed() < RELEASE_2_40_2[ARM64] + VARIANT_INSTALLABLE_MAX_DELAY_MS, 'it returns at the first check after arm64 lands');
  assert.ok(
    npm.views.every(view => view.options.quiet === true),
    'probes are quiet by default'
  );
});

test('before the fix the main package was published while arm64 was still unresolvable', async () => {
  // The old order: publish the variants, then the main package right away.
  const npm = registry(RELEASE_2_40_2);
  assert.equal((await checkInstallable(ARM64, npm)).installable, false);
});

test('a variant that never lands fails the publication with an actionable, non-retryable error', async () => {
  const npm = registry({ [X64]: 0 });
  const logger = {
    lines: [],
    log() {},
    error(line) {
      this.lines.push(line);
    },
  };
  await assert.rejects(awaitInstallableVariants([variant('x64'), variant('arm64')], { ...npm, env: {}, logger }), error => {
    assert.match(error.message, /not installable after publication/);
    assert.equal(isNonRetryableFailure(error.message), true, 'publishWithRetry must not repeat a 30-minute wait');
    assert.equal(describeNonRetryableFailure(error.message, NAME).title, 'native Codex variant not installable');
    return true;
  });
  assert.ok(logger.lines.join('\n').includes(`::error title=native Codex variant not installable::${ARM64} did not`), logger.lines.join('\n'));
  assert.ok(!logger.lines.join('\n').includes(X64), 'only the missing variant is named');
});

test('publishWithRetry stops after the first variant timeout', async () => {
  let publishes = 0;
  const runner = async (command, args) => {
    if (args[0] === 'run') {
      publishes++;
      return { code: 1, stdout: '', stderr: `Error: npm error native Codex variants ${ARM64} are not installable after publication` };
    }
    return { code: 1, stdout: '' };
  };
  const result = await publishWithRetry({ runner, version: VERSION, sleeper: async () => {}, logger: quiet });
  assert.equal(result.ok, false);
  assert.equal(result.nonRetryable, true);
  assert.equal(publishes, 1);
});

test('the publish command waits for the variants after publishing them and before wiring', () => {
  const source = readFileSync(new URL('../scripts/native-codex-packages.mjs', import.meta.url), 'utf8');
  const publish = source.slice(source.indexOf("command === 'publish'"));
  const order = ['await publishVariants(variants)', 'await awaitInstallableVariants(variants)', 'await wirePackage(repository)'].map(call => publish.indexOf(call));
  assert.ok(
    order.every(index => index > 0),
    `all three calls exist: ${order}`
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order
  );
});

const budget = (attempts, delay, max) => {
  let total = 0;
  for (let attempt = 1; attempt < attempts; attempt++, delay = Math.min(delay * 2, max)) total += delay;
  return total;
};

test('the variant budget is about twice the slowest variant seen, and both publishing jobs hold it', () => {
  const variantMs = budget(VARIANT_INSTALLABLE_ATTEMPTS, VARIANT_INSTALLABLE_DELAY_MS, VARIANT_INSTALLABLE_MAX_DELAY_MS);
  assert.ok(variantMs >= 2 * RELEASE_2_40_2[ARM64], `${variantMs / 60000} minutes`);
  const verifyMs = budget(DEFAULT_VERIFY_ATTEMPTS, DEFAULT_VERIFY_DELAY_MS, DEFAULT_VERIFY_MAX_DELAY_MS);
  const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  for (const job of ['release', 'instant-release']) {
    const body = workflow.split(new RegExp(`\\n  ${job}:\\n`))[1]?.split(/\n {2}[a-z][\w-]*:\n/)[0];
    const minutes = Number(body?.match(/timeout-minutes:\s*(\d+)/)?.[1]);
    // ~1 minute of setup and ~5 minutes of build, packing and uploads (run 43493862530).
    assert.ok(minutes * 60000 >= variantMs + verifyMs + 10 * 60000, `${job}: ${minutes}m < ${(variantMs + verifyMs) / 60000}m + 10m`);
  }
});

test('waitUntilInstallable backs off exponentially and reports what is still missing', async () => {
  const npm = registry({});
  const delays = [];
  const missing = await waitUntilInstallable([ARM64], { ...npm, sleeper: async ms => delays.push(ms), attempts: 5, delayMs: 1000, maxDelayMs: 4000, logger: quiet });
  assert.deepEqual(missing, [ARM64]);
  assert.deepEqual(delays, [1000, 2000, 4000, 4000]);
});

test('a visible version whose tarball is not served yet is not installable (issue #2404)', async () => {
  const runner = async () => ({ code: 0, stdout: 'https://registry.npmjs.org/x.tgz' });
  assert.deepEqual(await checkInstallable(ARM64, { runner, fetcher: async () => ({ ok: false, status: 404 }) }), { installable: false, detail: 'tarball https://registry.npmjs.org/x.tgz → HTTP 404' });
  assert.equal((await checkInstallable(ARM64, { runner, fetcher: async () => Promise.reject(new Error('ECONNRESET')) })).installable, false);
});

test('Docker jobs wait for exactly the variants a release pins', () => {
  // `npm view @link-assistant/hive-mind@2.40.2 optionalDependencies --json`
  const pinned = {
    '@link-assistant/hive-mind-native-codex-linux-arm64': `npm:${ARM64}`,
    '@link-assistant/hive-mind-native-codex-linux-x64': `npm:${X64}`,
  };
  assert.deepEqual(pinnedVariantSpecs(NAME, pinned), [ARM64, X64]);
  assert.deepEqual(pinnedVariantSpecs(NAME, null), []);
  assert.deepEqual(pinnedVariantSpecs(NAME, { other: 'npm:other@1.0.0', ranged: `npm:${NAME}@^2.0.0`, injected: `npm:${NAME}@1.0.0 --registry=x` }), []);
});

test('wait-for-npm checks the pinned variants and the image build explains a refusal', () => {
  const script = readFileSync(new URL('../scripts/wait-for-npm.mjs', import.meta.url), 'utf8');
  assert.match(script, /pinnedVariantSpecs\(PACKAGE_NAME, optionalDependencies\)/);
  assert.match(script, /waitUntilInstallable\(variants, options\)/);
  for (const file of ['Dockerfile', 'Dockerfile.dind']) {
    const dockerfile = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(dockerfile, /RUN --network=none HIVE_MIND_NATIVE_CODEX_DEBUG=1 node .*install-native-codex\.mjs/, file);
  }
});
