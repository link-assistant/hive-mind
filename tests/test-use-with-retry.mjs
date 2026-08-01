#!/usr/bin/env node
/**
 * Unit tests for src/use-with-retry.lib.mjs (Issue #1710, #1712, #2092).
 *
 * Verifies that the retry helper for `use-m` recovers from the known
 * hosted-CI failure modes:
 *   1. SyntaxError mid-import after a truncated `npm install -g`.
 *   2. "Failed to resolve the path" after an incomplete install.
 *   3. ERR_INVALID_PACKAGE_CONFIG when the installed package.json itself
 *      is corrupt (issue #1712).
 *   4. "Failed to install <pkg> globally into <dir>" when the global
 *      `npm install -g` itself fails (issue #2092).
 *   5. ERR_MODULE_NOT_FOUND for an internal file in an incomplete alias.
 *   6. A retryable ENOTEMPTY race in use-m's corrupt-alias cleanup.
 *
 * Also covers wrapUseWithRetry/ensureUseM, which make every `use(...)` call
 * site in the codebase inherit this recovery (issue #2092).
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { useWithRetry, wrapUseWithRetry, resolveAliasDir, removeAliasWithRetry, isTransientInstallError, isCorruptInstallError, extractCorruptedFilePath } from '../src/use-with-retry.lib.mjs';

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

const makeInstallError = (pkg, dir) => new Error(`Failed to install ${pkg} globally into '${dir}'.`);

const makeResolveError = (pkg, dir) => new Error(`Failed to resolve the path to '${pkg}' from '${dir}'.`);

const makeInvalidPackageConfigError = pkgJsonPath => {
  const err = new Error(`Invalid package config ${pkgJsonPath}.`);
  err.code = 'ERR_INVALID_PACKAGE_CONFIG';
  return err;
};

const makeMissingTransitiveModuleError = (entryPath, missingPath) => {
  const cause = new Error(`Cannot find module '${missingPath}' imported from ${entryPath}`);
  cause.code = 'ERR_MODULE_NOT_FOUND';
  return new Error(`Failed to import module from '${entryPath}'.`, { cause });
};

const makeAliasCleanupError = (aliasPath, code = 'ENOTEMPTY') => {
  const cause = new Error(`${code}: directory not empty, rmdir '${aliasPath}/examples'`);
  cause.code = code;
  return new Error(`Failed to remove corrupt npm alias '${aliasPath}'.`, { cause });
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

await test('detects a missing transitive module inside an installed package (issue #2113)', () => {
  const entry = '/opt/node_modules/command-stream-v-latest/src/$.mjs';
  const missing = '/opt/node_modules/command-stream-v-latest/src/terminal-capture.mjs';
  assert.equal(isCorruptInstallError(makeMissingTransitiveModuleError(entry, missing)), true);
});

await test('detects use-m alias cleanup races after self-healing (issue #2113)', () => {
  const alias = '/opt/node_modules/command-stream-v-latest';
  assert.equal(isCorruptInstallError(makeAliasCleanupError(alias)), true);
});

await test('detects "Invalid package config" by message (no code)', () => {
  // Defensive: if the error bubbles through use-m without preserving `code`,
  // the message-prefix match still flags it as corrupt.
  const err = new Error('Invalid package config /tmp/getenv-v-latest/package.json.');
  assert.equal(isCorruptInstallError(err), true);
});

await test('does not flag unrelated errors', () => {
  assert.equal(isCorruptInstallError(new Error('Network down')), false);
  const unrelatedMissingModule = new Error("Cannot find package 'missing' imported from /app/index.mjs");
  unrelatedMissingModule.code = 'ERR_MODULE_NOT_FOUND';
  assert.equal(isCorruptInstallError(unrelatedMissingModule), false);
  assert.equal(isCorruptInstallError(makeAliasCleanupError('/tmp/pkg-v-latest', 'EACCES')), false);
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

await test('extracts alias path from use-m cleanup failure (issue #2113)', () => {
  const alias = '/opt/node_modules/command-stream-v-latest';
  assert.equal(extractCorruptedFilePath(makeAliasCleanupError(alias)), alias);
});

await test('returns null when no path is present', () => {
  assert.equal(extractCorruptedFilePath(new Error('Network failed')), null);
});

console.log('\n📋 isTransientInstallError (issue #2092)\n');

await test('detects a failed global npm install', () => {
  assert.equal(isTransientInstallError(makeInstallError('command-stream@latest', '/home/box/.nvm/versions/node/v20.20.2/lib/node_modules')), true);
});

await test('does not flag unrelated errors as transient installs', () => {
  assert.equal(isTransientInstallError(new Error('Network down')), false);
  assert.equal(isTransientInstallError(makeImportError('/tmp/getenv-v-latest/index.js')), false);
});

await test('retries a failed global install with backoff and no cleanup', async () => {
  let calls = 0;
  const waits = [];
  let cleanupCalls = 0;
  const fakeUse = async () => {
    calls++;
    if (calls < 3) {
      throw makeInstallError('command-stream@latest', '/home/box/.nvm/versions/node/v20.20.2/lib/node_modules');
    }
    return { $: 'dollar' };
  };
  const result = await useWithRetry(fakeUse, 'command-stream', {
    sleep: async ms => waits.push(ms),
    backoffMs: 10,
    cleanup: async () => {
      cleanupCalls++;
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [10, 20]);
  assert.equal(cleanupCalls, 0);
  assert.deepEqual(result, { $: 'dollar' });
});

await test('rethrows the install failure after exhausting attempts', async () => {
  const fakeUse = async () => {
    throw makeInstallError('command-stream@latest', '/lib/node_modules');
  };
  await assert.rejects(() => useWithRetry(fakeUse, 'command-stream', { attempts: 2, sleep: async () => {} }), /Failed to install command-stream@latest globally/);
});

console.log('\n📋 resolveAliasDir (issue #2092)\n');

await test('walks up nested paths to the alias install dir', () => {
  assert.equal(resolveAliasDir('/lib/node_modules/command-stream-v-latest/src/$.mjs'), '/lib/node_modules/command-stream-v-latest');
});

await test('keeps versioned alias dirs intact', () => {
  assert.equal(resolveAliasDir('/lib/node_modules/getenv-v-1.0.0/index.js'), '/lib/node_modules/getenv-v-1.0.0');
  assert.equal(resolveAliasDir('/lib/node_modules/getenv-v-latest'), '/lib/node_modules/getenv-v-latest');
});

await test('falls back to the parent directory without an alias segment', () => {
  assert.equal(resolveAliasDir('/tmp/pkg/index.js'), '/tmp/pkg');
});

console.log('\n📋 removeAliasWithRetry (issue #2113)\n');

await test('gives recursive rm an explicit retry budget for transient filesystem races', async () => {
  const calls = [];
  await removeAliasWithRetry('/tmp/command-stream-v-latest', {
    rm: async (...args) => calls.push(args),
  });
  assert.deepEqual(calls, [['/tmp/command-stream-v-latest', { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }]]);
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

await test('retries after a transitive module is missing and cleans up the whole alias dir (issue #2113)', async () => {
  const entry = '/tmp/command-stream-v-latest/src/$.mjs';
  const missing = '/tmp/command-stream-v-latest/src/terminal-capture.mjs';
  const cleanedPaths = [];
  let calls = 0;
  const fakeUse = async () => {
    calls++;
    if (calls === 1) throw makeMissingTransitiveModuleError(entry, missing);
    return { $: 'recovered' };
  };
  const result = await useWithRetry(fakeUse, 'command-stream', {
    cleanup: async path => cleanedPaths.push(path),
  });
  assert.equal(calls, 2);
  assert.deepEqual(cleanedPaths, ['/tmp/command-stream-v-latest']);
  assert.deepEqual(result, { $: 'recovered' });
});

await test('recovers when use-m self-healing loses an ENOTEMPTY cleanup race (issue #2113)', async () => {
  const alias = '/tmp/command-stream-v-latest';
  const cleanedPaths = [];
  let calls = 0;
  const fakeUse = async () => {
    calls++;
    if (calls === 1) throw makeAliasCleanupError(alias);
    return { $: 'recovered' };
  };
  const result = await useWithRetry(fakeUse, 'command-stream', {
    cleanup: async path => cleanedPaths.push(path),
  });
  assert.equal(calls, 2);
  assert.deepEqual(cleanedPaths, [alias]);
  assert.deepEqual(result, { $: 'recovered' });
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

console.log("\n📋 useWithRetry — Node's poisoned ESM cache (issue #2092)\n");

await test('falls back to a cache-busted import when the same path fails again', async () => {
  // Reproduces the behaviour observed against real use-m@8.14.2: after the alias
  // dir is deleted and reinstalled, use-m re-imports the same URL and Node
  // replays the cached SyntaxError.
  const entry = '/lib/node_modules/command-stream-v-latest/src/$.mjs';
  const cleaned = [];
  const imported = [];
  let calls = 0;
  const fakeUse = async () => {
    calls++;
    throw makeImportError(entry);
  };
  const result = await useWithRetry(fakeUse, 'command-stream', {
    cleanup: async path => cleaned.push(path),
    importModule: async (path, attempt) => {
      imported.push([path, attempt]);
      return { $: 'dollar' };
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(cleaned, ['/lib/node_modules/command-stream-v-latest']);
  assert.deepEqual(imported, [[entry, 2]]);
  assert.deepEqual(result, { $: 'dollar' });
});

await test('keeps retrying normally when the cache-busted import also fails', async () => {
  const entry = '/lib/node_modules/command-stream-v-latest/src/$.mjs';
  let calls = 0;
  const fakeUse = async () => {
    calls++;
    if (calls < 3) throw makeImportError(entry);
    return { $: 'dollar' };
  };
  const result = await useWithRetry(fakeUse, 'command-stream', {
    cleanup: async () => {},
    importModule: async () => {
      throw new Error('still corrupt');
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(result, { $: 'dollar' });
});

await test('does not cache-bust for resolve-path failures', async () => {
  let calls = 0;
  let importCalls = 0;
  const fakeUse = async () => {
    calls++;
    if (calls === 1) throw makeResolveError('links-notation', '/lib/node_modules/links-notation-v-latest');
    return { ok: true };
  };
  const result = await useWithRetry(fakeUse, 'links-notation', {
    cleanup: async () => {},
    importModule: async () => {
      importCalls++;
      return {};
    },
  });
  assert.equal(importCalls, 0);
  assert.deepEqual(result, { ok: true });
});

console.log('\n📋 wrapUseWithRetry (issue #2092)\n');

await test('wrapped use recovers from a corrupt command-stream install', async () => {
  let calls = 0;
  const cleaned = [];
  const rawUse = async () => {
    calls++;
    if (calls === 1) {
      throw makeImportError('/home/box/.nvm/versions/node/v20.20.2/lib/node_modules/command-stream-v-latest/src/$.mjs');
    }
    return { $: 'dollar' };
  };
  const wrapped = wrapUseWithRetry(rawUse, { cleanup: async path => cleaned.push(path) });
  const result = await wrapped('command-stream');
  assert.equal(calls, 2);
  assert.deepEqual(result, { $: 'dollar' });
  assert.deepEqual(cleaned, ['/home/box/.nvm/versions/node/v20.20.2/lib/node_modules/command-stream-v-latest']);
});

await test('wrapped use forwards extra arguments', async () => {
  const seen = [];
  const wrapped = wrapUseWithRetry(async (...args) => {
    seen.push(args);
    return 'ok';
  });
  assert.equal(await wrapped('getenv', { alias: 'x' }), 'ok');
  assert.deepEqual(seen, [['getenv', { alias: 'x' }]]);
});

await test('wrapping is idempotent', () => {
  const wrapped = wrapUseWithRetry(async () => 'ok');
  assert.equal(wrapUseWithRetry(wrapped), wrapped);
});

await test('non-corrupt errors propagate through the wrapper', async () => {
  const wrapped = wrapUseWithRetry(async () => {
    throw new Error('Network unreachable');
  });
  await assert.rejects(() => wrapped('getenv'), /Network unreachable/);
});

await test('ensureUseM returns a retry-wrapped use', async () => {
  delete globalThis.use;
  const { ensureUseM } = await import('../src/use-m-bootstrap.lib.mjs');
  const fetchUseMCode = async () => `({ use: async () => { globalThis.__useCalls = (globalThis.__useCalls || 0) + 1; if (globalThis.__useCalls === 1) { const e = new Error("Failed to import module from '/tmp/command-stream-v-latest/src/$.mjs'."); e.cause = new SyntaxError('Unexpected end of input'); throw e; } return { $: 'dollar' }; } })`;
  globalThis.__useCalls = 0;
  const use = await ensureUseM({ fetchUseMCode });
  const result = await use('command-stream');
  const calls = globalThis.__useCalls;
  delete globalThis.__useCalls;
  delete globalThis.use;
  assert.equal(calls, 2);
  assert.deepEqual(result, { $: 'dollar' });
});

console.log(`\n📊 ${passed + failed} test(s): ✅ ${passed} passed, ❌ ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
