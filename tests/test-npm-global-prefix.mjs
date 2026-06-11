#!/usr/bin/env node
/**
 * Unit tests for src/npm-global-prefix.lib.mjs (Issue #1897).
 *
 * Verifies that the preflight redirects npm's global prefix to a user-writable
 * directory only when the real global node_modules is not writable, and stays
 * a no-op otherwise. Reproduces the EACCES scenario from the issue log where a
 * root-owned `/opt/node-.../lib/node_modules` made use-m's `npm install -g`
 * crash.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { constants as fsConstants } from 'node:fs';
import { ensureWritableNpmGlobalPrefix, deriveGlobalNodeModules, isPathWritable } from '../src/npm-global-prefix.lib.mjs';

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

// Build an fs.access stub that grants W_OK only for the listed writable paths.
const makeAccess = writablePaths => async (path, mode) => {
  if (mode === fsConstants.W_OK && !writablePaths.includes(path)) {
    const error = new Error(`EACCES: permission denied, access '${path}'`);
    error.code = 'EACCES';
    throw error;
  }
};

const noopLog = () => {};

console.log('\n📋 deriveGlobalNodeModules\n');

await test('derives <prefix>/lib/node_modules from <prefix>/bin/node', () => {
  assert.equal(deriveGlobalNodeModules('/opt/node-v24.16.0-linux-x64/bin/node'), '/opt/node-v24.16.0-linux-x64/lib/node_modules');
});

console.log('\n📋 isPathWritable\n');

await test('true when the directory itself is writable', async () => {
  assert.equal(await isPathWritable('/home/user/.npm-global/lib/node_modules', makeAccess(['/home/user/.npm-global/lib/node_modules'])), true);
});

await test('walks up to nearest existing writable ancestor on ENOENT', async () => {
  const accessFn = async (path, mode) => {
    if (path === '/home/user/.npm-global/lib/node_modules') {
      const e = new Error('ENOENT');
      e.code = 'ENOENT';
      throw e;
    }
    if (mode === fsConstants.W_OK && path !== '/home/user/.npm-global/lib') throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
  };
  assert.equal(await isPathWritable('/home/user/.npm-global/lib/node_modules', accessFn), true);
});

await test('false when a root-owned directory denies write', async () => {
  assert.equal(await isPathWritable('/opt/node/lib/node_modules', makeAccess([])), false);
});

console.log('\n📋 ensureWritableNpmGlobalPrefix\n');

await test('no-op when the derived global dir is writable (fast path, no npm spawn)', async () => {
  const env = {};
  let runnerCalls = 0;
  const result = await ensureWritableNpmGlobalPrefix({
    env,
    platform: 'linux',
    home: '/home/user',
    execPath: '/home/user/.nvm/versions/node/v20/bin/node',
    accessFn: makeAccess(['/home/user/.nvm/versions/node/v20/lib/node_modules']),
    runner: async () => {
      runnerCalls++;
      return { stdout: '' };
    },
    log: noopLog,
  });
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'writable');
  assert.equal(env.npm_config_prefix, undefined);
  assert.equal(runnerCalls, 0, 'must not spawn npm on the writable fast path');
});

await test('redirects to ~/.npm-global when the global dir is root-owned (issue #1897)', async () => {
  const env = { PATH: '/usr/bin' };
  const mkdirCalls = [];
  const logs = [];
  const result = await ensureWritableNpmGlobalPrefix({
    env,
    platform: 'linux',
    home: '/home/ezocomp',
    execPath: '/opt/node-v24.16.0-linux-x64/bin/node',
    // Neither the derived path nor the authoritative npm root is writable.
    accessFn: makeAccess([]),
    runner: async () => ({ stdout: '/opt/node-v24.16.0-linux-x64/lib/node_modules\n' }),
    mkdirFn: async path => {
      mkdirCalls.push(path);
    },
    log: message => logs.push(message),
  });
  assert.equal(result.changed, true);
  assert.equal(result.reason, 'redirected');
  assert.equal(result.prefix, '/home/ezocomp/.npm-global');
  assert.equal(env.npm_config_prefix, '/home/ezocomp/.npm-global');
  assert.deepEqual(mkdirCalls, ['/home/ezocomp/.npm-global/lib/node_modules']);
  assert.ok(env.PATH.startsWith('/home/ezocomp/.npm-global/bin:'), 'prepends the new bin dir to PATH');
  assert.ok(
    logs.some(m => m.includes('issue #1897')),
    'logs an informative message'
  );
});

await test('confirms with npm root -g before redirecting (custom writable prefix is honoured)', async () => {
  // Derived path looks non-writable, but the real npm root (custom prefix) is writable.
  const env = {};
  const result = await ensureWritableNpmGlobalPrefix({
    env,
    platform: 'linux',
    home: '/home/user',
    execPath: '/opt/node/bin/node',
    accessFn: makeAccess(['/home/user/.npm-global/lib/node_modules']),
    runner: async () => ({ stdout: '/home/user/.npm-global/lib/node_modules\n' }),
    log: noopLog,
  });
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'writable');
  assert.equal(env.npm_config_prefix, undefined);
});

await test('respects an already-set npm_config_prefix', async () => {
  const env = { npm_config_prefix: '/custom/prefix' };
  const result = await ensureWritableNpmGlobalPrefix({
    env,
    platform: 'linux',
    home: '/home/user',
    execPath: '/opt/node/bin/node',
    accessFn: makeAccess([]),
    runner: async () => ({ stdout: '' }),
    log: noopLog,
  });
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'preset');
  assert.equal(env.npm_config_prefix, '/custom/prefix');
});

await test('skips on win32 to avoid relocating a different global layout', async () => {
  const env = {};
  const result = await ensureWritableNpmGlobalPrefix({
    env,
    platform: 'win32',
    home: 'C:\\Users\\user',
    execPath: 'C:\\Program Files\\nodejs\\node.exe',
    accessFn: makeAccess([]),
    runner: async () => ({ stdout: '' }),
    log: noopLog,
  });
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'win32');
});

await test('does nothing (no crash) when HOME is unavailable', async () => {
  const env = {};
  const result = await ensureWritableNpmGlobalPrefix({
    env,
    platform: 'linux',
    home: '',
    execPath: '/opt/node/bin/node',
    accessFn: makeAccess([]),
    runner: async () => ({ stdout: '/opt/node/lib/node_modules\n' }),
    log: noopLog,
  });
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'no-home');
  assert.equal(env.npm_config_prefix, undefined);
});

await test('falls back gracefully when mkdir fails', async () => {
  const env = {};
  const result = await ensureWritableNpmGlobalPrefix({
    env,
    platform: 'linux',
    home: '/home/user',
    execPath: '/opt/node/bin/node',
    accessFn: makeAccess([]),
    runner: async () => ({ stdout: '/opt/node/lib/node_modules\n' }),
    mkdirFn: async () => {
      throw Object.assign(new Error('EROFS: read-only file system'), { code: 'EROFS' });
    },
    log: noopLog,
  });
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'mkdir-failed');
  assert.equal(env.npm_config_prefix, undefined);
});

await test('uses derived path when npm root -g fails', async () => {
  const env = { PATH: '' };
  const result = await ensureWritableNpmGlobalPrefix({
    env,
    platform: 'linux',
    home: '/home/user',
    execPath: '/opt/node/bin/node',
    accessFn: makeAccess([]),
    runner: async () => {
      throw new Error('npm not found');
    },
    mkdirFn: async () => {},
    log: noopLog,
  });
  assert.equal(result.changed, true);
  assert.equal(result.previousRoot, '/opt/node/lib/node_modules');
  assert.equal(env.npm_config_prefix, '/home/user/.npm-global');
  assert.equal(env.PATH, '/home/user/.npm-global/bin');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
