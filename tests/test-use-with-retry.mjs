#!/usr/bin/env node
/**
 * Unit tests for src/use-with-retry.lib.mjs (Issue #1710, #1712).
 *
 * Verifies that the retry helper for `use-m` recovers from the three
 * known hosted-CI flake modes:
 *   1. SyntaxError mid-import after a truncated `npm install -g`.
 *   2. "Failed to resolve the path" after an incomplete install.
 *   3. ERR_INVALID_PACKAGE_CONFIG when the installed package.json itself
 *      is corrupt (issue #1712).
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { useWithRetry, isCorruptInstallError, extractCorruptedFilePath } from '../src/use-with-retry.lib.mjs';

let passed = 0;
let failed = 0;

const test = async (name, fn) => {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   ${error.stack || error.message}`);
    failed++;
  }
};

const makeImportError = filePath => {
  const cause = new SyntaxError('Unexpected end of input');
  return new Error(`Failed to import module from '${filePath}'.`, { cause });
};

const makeResolveError = (pkg, dir) => new Error(`Failed to resolve the path to '${pkg}' from '${dir}'.`);

const makeInvalidPackageConfigError = pkgJsonPath => {
  const err = new Error(`Invalid package config ${pkgJsonPath}.`);
  err.code = 'ERR_INVALID_PACKAGE_CONFIG';
  return err;
};

console.log('\n📋 isCorruptInstallError\n');

await test('detects SyntaxError cause as corrupt install', () => {
  assert.equal(isCorruptInstallError(makeImportError('/tmp/getenv-v-latest/index.js')), true);
});

await test('detects "Unexpected end of input" cause message', () => {
  const err = new Error('Failed to import module from x', { cause: { message: 'Unexpected end of input' } });
  assert.equal(isCorruptInstallError(err), true);
});

await test('detects "Failed to resolve the path" message', () => {
  assert.equal(isCorruptInstallError(makeResolveError('links-notation', '/tmp/links-notation-v-latest')), true);
});

await test('detects ERR_INVALID_PACKAGE_CONFIG by code (issue #1712)', () => {
  assert.equal(isCorruptInstallError(makeInvalidPackageConfigError('/tmp/getenv-v-latest/package.json')), true);
});

await test('detects ERR_INVALID_PACKAGE_CONFIG on cause', () => {
  const cause = makeInvalidPackageConfigError('/tmp/getenv-v-latest/package.json');
  const err = new Error('npm install wrapper failure', { cause });
  assert.equal(isCorruptInstallError(err), true);
});

await test('detects "Invalid package config" by message (no code)', () => {
  // Defensive: if the error bubbles through use-m without preserving `code`,
  // the message-prefix match still flags it as corrupt.
  const err = new Error('Invalid package config /tmp/getenv-v-latest/package.json.');
  assert.equal(isCorruptInstallError(err), true);
});

await test('does not flag unrelated errors', () => {
  assert.equal(isCorruptInstallError(new Error('Network down')), false);
  assert.equal(isCorruptInstallError(null), false);
  assert.equal(isCorruptInstallError(undefined), false);
});

console.log('\n📋 extractCorruptedFilePath\n');

await test('extracts file path from import-failed message', () => {
  assert.equal(extractCorruptedFilePath(makeImportError('/opt/node_modules/getenv-v-latest/index.js')), '/opt/node_modules/getenv-v-latest/index.js');
});

await test('extracts directory path from resolve-failed message', () => {
  assert.equal(extractCorruptedFilePath(makeResolveError('links-notation', '/opt/node_modules/links-notation-v-latest')), '/opt/node_modules/links-notation-v-latest');
});

await test('extracts package.json path from invalid-package-config message (issue #1712)', () => {
  assert.equal(extractCorruptedFilePath(makeInvalidPackageConfigError('/opt/hostedtoolcache/node/24.14.1/x64/lib/node_modules/getenv-v-latest/package.json')), '/opt/hostedtoolcache/node/24.14.1/x64/lib/node_modules/getenv-v-latest/package.json');
});

await test('returns null when no path is present', () => {
  assert.equal(extractCorruptedFilePath(new Error('Network failed')), null);
});

console.log('\n📋 useWithRetry — happy path\n');

await test('returns module on first try when use() succeeds', async () => {
  let calls = 0;
  const fakeUse = async () => {
    calls++;
    return { default: 'ok' };
  };
  const result = await useWithRetry(fakeUse, 'pkg');
  assert.deepEqual(result, { default: 'ok' });
  assert.equal(calls, 1);
});

console.log('\n📋 useWithRetry — recovery\n');

await test('retries after SyntaxError cause and cleans up alias dir', async () => {
  let calls = 0;
  const cleanedPaths = [];
  const fakeUse = async () => {
    calls++;
    if (calls === 1) {
      throw makeImportError('/tmp/getenv-v-latest/index.js');
    }
    return { default: 'recovered' };
  };
  const cleanup = async path => {
    cleanedPaths.push(path);
  };
  const result = await useWithRetry(fakeUse, 'getenv', { cleanup });
  assert.equal(calls, 2);
  assert.deepEqual(cleanedPaths, ['/tmp/getenv-v-latest']);
  assert.deepEqual(result, { default: 'recovered' });
});

await test('retries after resolve-path failure and cleans up alias dir', async () => {
  let calls = 0;
  const cleanedPaths = [];
  const fakeUse = async () => {
    calls++;
    if (calls === 1) {
      throw makeResolveError('links-notation', '/tmp/links-notation-v-latest');
    }
    return { Parser: function () {} };
  };
  const cleanup = async path => {
    cleanedPaths.push(path);
  };
  const result = await useWithRetry(fakeUse, 'links-notation', { cleanup });
  assert.equal(calls, 2);
  assert.deepEqual(cleanedPaths, ['/tmp/links-notation-v-latest']);
  assert.equal(typeof result.Parser, 'function');
});

await test('retries after ERR_INVALID_PACKAGE_CONFIG and cleans up alias dir (issue #1712)', async () => {
  let calls = 0;
  const cleanedPaths = [];
  const fakeUse = async () => {
    calls++;
    if (calls === 1) {
      throw makeInvalidPackageConfigError('/tmp/getenv-v-latest/package.json');
    }
    return { default: 'recovered' };
  };
  const cleanup = async path => {
    cleanedPaths.push(path);
  };
  const result = await useWithRetry(fakeUse, 'getenv', { cleanup });
  assert.equal(calls, 2);
  // package.json path → cleanup() walks up to the alias dir before rm -rf.
  assert.deepEqual(cleanedPaths, ['/tmp/getenv-v-latest']);
  assert.deepEqual(result, { default: 'recovered' });
});

await test('does not retry on unrelated errors', async () => {
  let calls = 0;
  const fakeUse = async () => {
    calls++;
    throw new Error('Network unreachable');
  };
  await assert.rejects(() => useWithRetry(fakeUse, 'pkg', { cleanup: async () => {} }), /Network unreachable/);
  assert.equal(calls, 1);
});

await test('rethrows after exhausting attempts on corrupt install', async () => {
  let calls = 0;
  const fakeUse = async () => {
    calls++;
    throw makeImportError('/tmp/getenv-v-latest/index.js');
  };
  await assert.rejects(() => useWithRetry(fakeUse, 'getenv', { attempts: 2, cleanup: async () => {} }), /Failed to import module/);
  assert.equal(calls, 2);
});

await test('continues retrying when cleanup itself fails', async () => {
  let calls = 0;
  const fakeUse = async () => {
    calls++;
    if (calls < 2) {
      throw makeImportError('/tmp/getenv-v-latest/index.js');
    }
    return { default: 'ok' };
  };
  const cleanup = async () => {
    throw new Error('EACCES');
  };
  const result = await useWithRetry(fakeUse, 'getenv', { cleanup });
  assert.equal(calls, 2);
  assert.deepEqual(result, { default: 'ok' });
});

console.log(`\n📊 ${passed + failed} test(s): ✅ ${passed} passed, ❌ ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
