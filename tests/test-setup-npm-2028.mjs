#!/usr/bin/env node
/**
 * Unit tests for scripts/setup-npm.mjs.
 *
 * Locks down the npm version pinning from issue #2028: the release runner must
 * install the npm 11 line (which supports OIDC trusted publishing) and must
 * reject npm 12.x, whose sigstore regression (npm/cli#9722) breaks every
 * provenance publish.
 *
 * Run with: node tests/test-setup-npm-2028.mjs
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2028
 */

import assert from 'node:assert/strict';
import { parseVersion, compareVersions, isVersionAtLeast, isSupportedNpmVersion, setupNpm, NPM_TARGET_MAJOR, NPM_MIN_VERSION } from '../scripts/setup-npm.mjs';

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

const quietLogger = { log: () => {}, error: () => {} };

await test('parseVersion parses major/minor/patch and strips prefixes', async () => {
  assert.deepEqual(parseVersion('11.5.1'), { major: 11, minor: 5, patch: 1 });
  assert.deepEqual(parseVersion('v12.0.0'), { major: 12, minor: 0, patch: 0 });
  assert.deepEqual(parseVersion('11.18.0-next.0'), { major: 11, minor: 18, patch: 0 });
});

await test('compareVersions orders correctly', async () => {
  assert.equal(compareVersions('11.5.1', '11.5.0'), 1);
  assert.equal(compareVersions('11.5.0', '11.5.1'), -1);
  assert.equal(compareVersions('12.0.0', '11.18.0'), 1);
  assert.equal(compareVersions('11.5.1', '11.5.1'), 0);
});

await test('isVersionAtLeast honours the minimum', async () => {
  assert.equal(isVersionAtLeast('11.5.1', NPM_MIN_VERSION), true);
  assert.equal(isVersionAtLeast('11.18.0', NPM_MIN_VERSION), true);
  assert.equal(isVersionAtLeast('11.5.0', NPM_MIN_VERSION), false);
  assert.equal(isVersionAtLeast('10.9.0', NPM_MIN_VERSION), false);
});

await test('isSupportedNpmVersion accepts npm 11 >= 11.5.1', async () => {
  assert.equal(isSupportedNpmVersion('11.5.1'), true);
  assert.equal(isSupportedNpmVersion('11.18.0'), true);
});

await test('isSupportedNpmVersion REJECTS npm 12.x (sigstore regression)', async () => {
  assert.equal(isSupportedNpmVersion('12.0.0'), false, 'npm 12.0.0 has the sigstore crash');
  assert.equal(isSupportedNpmVersion('12.1.0'), false);
});

await test('isSupportedNpmVersion rejects too-old npm', async () => {
  assert.equal(isSupportedNpmVersion('10.9.2'), false);
  assert.equal(isSupportedNpmVersion('11.5.0'), false);
});

// Build a mock runner keyed by command. `npm --version` returns a queue of
// versions (so an upgrade can change the reported version); everything else
// returns success.
const makeRunner = ({ versions, installCode = 0 }) => {
  const calls = [];
  let versionIdx = 0;
  const runner = async (command, args) => {
    calls.push({ command, args });
    const key = `${command} ${args.join(' ')}`;
    if (key === 'npm --version') {
      const v = versions[Math.min(versionIdx, versions.length - 1)];
      versionIdx++;
      return { code: 0, stdout: `${v}\n`, stderr: '', message: '' };
    }
    if (key.startsWith('npm install -g npm@')) {
      return { code: installCode, stdout: '', stderr: '', message: '' };
    }
    throw new Error(`Unexpected command: ${key}`);
  };
  runner.calls = calls;
  return runner;
};

await test('setupNpm upgrades npm 10 -> npm 11 and validates', async () => {
  const runner = makeRunner({ versions: ['10.9.2', '11.18.0'] });
  const result = await setupNpm({ runner, logger: quietLogger });
  assert.equal(result.ok, true);
  assert.equal(result.version, '11.18.0');
  // Verify it pinned to the npm 11 major, NOT npm@latest.
  const installCall = runner.calls.find(c => c.command === 'npm' && c.args[0] === 'install');
  assert.deepEqual(installCall.args, ['install', '-g', `npm@${NPM_TARGET_MAJOR}`]);
});

await test('setupNpm skips upgrade when npm already supported', async () => {
  const runner = makeRunner({ versions: ['11.5.1'] });
  const result = await setupNpm({ runner, logger: quietLogger });
  assert.equal(result.ok, true);
  assert.equal(result.version, '11.5.1');
  assert.ok(!runner.calls.some(c => c.args[0] === 'install'), 'should not reinstall npm');
});

await test('setupNpm fails loudly if the install yields an unsupported version', async () => {
  // Simulate a bad install that somehow leaves npm 12 in place.
  const runner = makeRunner({ versions: ['10.9.2', '12.0.0'] });
  const result = await setupNpm({ runner, logger: quietLogger });
  assert.equal(result.ok, false, 'must reject a resulting npm 12.x');
});

await test('setupNpm fails when the install command errors', async () => {
  const runner = makeRunner({ versions: ['10.9.2', '10.9.2'], installCode: 1 });
  const result = await setupNpm({ runner, logger: quietLogger });
  assert.equal(result.ok, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
