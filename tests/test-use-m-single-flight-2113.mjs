#!/usr/bin/env node
/**
 * Unit tests for src/use-m-single-flight.lib.mjs (Issue #2113).
 *
 * Root cause under test: use-m runs one `npm install -g <alias>@npm:<pkg>@<v>`
 * per `use()` call with no in-flight deduplication, and 38 modules under `src/`
 * start with a top-level `await use('command-stream')`. Node evaluates sibling
 * top-level-await subgraphs concurrently, so a cold run fires dozens of
 * simultaneous global installs of the same directory and they corrupt each
 * other (reproduced in experiments/issue-2113/).
 *
 * These tests use a fake `use` that *fails when it is entered concurrently*,
 * which is the deterministic stand-in for npm's behaviour, so no network or npm
 * is required.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aliasForSpecifier, parseSpecifier, installsFromNpm, acquireAliasLock, withAliasLock, wrapUseWithSingleFlight, resetSingleFlightState } from '../src/use-m-single-flight.lib.mjs';
import { wrapUseWithRetry } from '../src/use-with-retry.lib.mjs';

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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const withLockRoot = async fn => {
  const root = await mkdtemp(join(tmpdir(), 'hive-mind-2113-lock-'));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
};

/**
 * A `use` stand-in that reproduces npm's global-install race: two overlapping
 * installs of the same alias corrupt the tree.
 */
const makeRacyUse = () => {
  const state = { active: new Set(), calls: [], installs: 0 };
  const use = async specifier => {
    const alias = aliasForSpecifier(specifier);
    state.calls.push(specifier);
    if (state.active.has(alias)) throw new Error(`ENOTEMPTY: concurrent install of ${alias}`);
    state.active.add(alias);
    state.installs++;
    try {
      await sleep(20);
      return { specifier };
    } finally {
      state.active.delete(alias);
    }
  };
  return { use, state };
};

await test('aliasForSpecifier matches use-m alias naming', () => {
  assert.equal(aliasForSpecifier('command-stream'), 'command-stream-v-latest');
  assert.equal(aliasForSpecifier('yargs@17.7.2'), 'yargs-v-17.7.2');
  assert.equal(aliasForSpecifier('yargs@17.7.2/helpers'), 'yargs-v-17.7.2');
  assert.equal(aliasForSpecifier('@dotenvx/dotenvx'), 'dotenvx-dotenvx-v-latest');
});

await test('non-npm specifiers have no alias', () => {
  assert.equal(aliasForSpecifier('./local.mjs'), null);
  assert.equal(aliasForSpecifier('../local.mjs'), null);
  assert.equal(aliasForSpecifier('/abs/local.mjs'), null);
  assert.equal(aliasForSpecifier('node:fs'), null);
  assert.equal(aliasForSpecifier(''), null);
  assert.equal(aliasForSpecifier(undefined), null);
});

await test('parseSpecifier defaults the version to latest', () => {
  assert.deepEqual(parseSpecifier('command-stream'), { packageName: 'command-stream', version: 'latest', modulePath: '' });
  assert.deepEqual(parseSpecifier('yargs@17.7.2/helpers'), { packageName: 'yargs', version: '17.7.2', modulePath: '/helpers' });
});

await test('built-ins are recognised as install-free', () => {
  // 57 of Hive Mind's use() call sites are use('fs'|'path'|'os') — they must
  // not queue behind an install lock.
  assert.equal(installsFromNpm('fs'), false);
  assert.equal(installsFromNpm('path'), false);
  assert.equal(installsFromNpm('fs/promises'), false);
  assert.equal(installsFromNpm('command-stream'), true);
  assert.equal(installsFromNpm('@dotenvx/dotenvx'), true);
});

await test('concurrent identical loads collapse into one install', async () => {
  resetSingleFlightState();
  await withLockRoot(async lockRoot => {
    const { use, state } = makeRacyUse();
    const wrapped = wrapUseWithSingleFlight(use, { lockRoot });
    const results = await Promise.all(Array.from({ length: 36 }, () => wrapped('command-stream')));
    assert.equal(state.installs, 1, 'expected exactly one underlying install');
    assert.equal(state.calls.length, 1);
    for (const result of results) assert.deepEqual(result, { specifier: 'command-stream' });
  });
});

await test('the unguarded loader fails the same race (control)', async () => {
  const { use } = makeRacyUse();
  const results = await Promise.allSettled(Array.from({ length: 36 }, () => use('command-stream')));
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(rejected.length, 35, 'the fake install must reproduce the race without the fix');
});

await test('different specifiers of one alias are serialised', async () => {
  resetSingleFlightState();
  await withLockRoot(async lockRoot => {
    const { use, state } = makeRacyUse();
    const wrapped = wrapUseWithSingleFlight(use, { lockRoot });
    await Promise.all([wrapped('yargs@17.7.2'), wrapped('yargs@17.7.2/helpers'), wrapped('yargs@17.7.2')]);
    assert.equal(state.installs, 2, 'two distinct specifiers, one alias, no overlap');
  });
});

await test('different aliases still install in parallel', async () => {
  resetSingleFlightState();
  await withLockRoot(async lockRoot => {
    let concurrent = 0;
    let peak = 0;
    const use = async specifier => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      await sleep(20);
      concurrent--;
      return specifier;
    };
    const wrapped = wrapUseWithSingleFlight(use, { lockRoot });
    await Promise.all(['command-stream', 'getenv', 'telegraf', 'zx'].map(name => wrapped(name)));
    assert.equal(peak, 4, 'unrelated packages must not be serialised behind each other');
  });
});

await test('failed loads are not memoised', async () => {
  resetSingleFlightState();
  await withLockRoot(async lockRoot => {
    let attempt = 0;
    const use = async () => {
      attempt++;
      if (attempt === 1) throw new Error('boom');
      return 'ok';
    };
    const wrapped = wrapUseWithSingleFlight(use, { lockRoot });
    await assert.rejects(() => wrapped('command-stream'), /boom/);
    assert.equal(await wrapped('command-stream'), 'ok');
  });
});

await test('built-ins skip the lock but still dedupe', async () => {
  resetSingleFlightState();
  await withLockRoot(async lockRoot => {
    let calls = 0;
    const use = async () => {
      calls++;
      await sleep(5);
      return 'fs-module';
    };
    const wrapped = wrapUseWithSingleFlight(use, { lockRoot });
    await Promise.all(Array.from({ length: 26 }, () => wrapped('fs')));
    assert.equal(calls, 1);
    await assert.rejects(() => stat(join(lockRoot, 'fs-v-latest.lock')), /ENOENT/);
  });
});

await test('relative specifiers are passed straight through', async () => {
  resetSingleFlightState();
  const seen = [];
  const wrapped = wrapUseWithSingleFlight(async (specifier, ...args) => {
    seen.push([specifier, ...args]);
    return 'local';
  });
  assert.equal(await wrapped('./a.mjs'), 'local');
  assert.equal(await wrapped('./a.mjs'), 'local');
  assert.deepEqual(seen, [['./a.mjs'], ['./a.mjs']]);
});

await test('extra arguments bypass the memo but keep the lock', async () => {
  resetSingleFlightState();
  await withLockRoot(async lockRoot => {
    const { use, state } = makeRacyUse();
    const wrapped = wrapUseWithSingleFlight(use, { lockRoot });
    await Promise.all([wrapped('command-stream', { alias: 'a' }), wrapped('command-stream', { alias: 'b' })]);
    assert.equal(state.installs, 2, 'both calls run, serialised, without corrupting each other');
  });
});

await test('wrapping is idempotent and composes with the retry wrapper', () => {
  const wrapped = wrapUseWithSingleFlight(wrapUseWithRetry(async () => 'ok'));
  assert.equal(wrapUseWithSingleFlight(wrapped), wrapped, 'double single-flight wrapping');
  assert.equal(wrapUseWithRetry(wrapped), wrapped, 'retry must not re-wrap outside single-flight');
});

await test('retry recovery runs inside the alias lock', async () => {
  resetSingleFlightState();
  await withLockRoot(async lockRoot => {
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls === 1) {
        const error = new Error("Failed to import module from '/tmp/command-stream-v-latest/index.js'.");
        error.cause = new SyntaxError('Unexpected end of input');
        throw error;
      }
      return 'recovered';
    };
    const wrapped = wrapUseWithSingleFlight(wrapUseWithRetry(flaky, { cleanup: async () => {} }), { lockRoot });
    assert.equal(await wrapped('command-stream'), 'recovered');
    assert.equal(calls, 2);
  });
});

await test('a second holder waits for the lock and then acquires it', async () => {
  await withLockRoot(async lockRoot => {
    const first = await acquireAliasLock('command-stream-v-latest', { lockRoot });
    assert.equal(first.acquired, true);
    let secondAcquired = false;
    const second = acquireAliasLock('command-stream-v-latest', { lockRoot, pollMs: 10 }).then(lock => {
      secondAcquired = true;
      return lock;
    });
    await sleep(50);
    assert.equal(secondAcquired, false, 'the lock must actually block');
    await first.release();
    const lock = await second;
    assert.equal(lock.acquired, true);
    await lock.release();
  });
});

await test('a stale lock is stolen instead of blocking forever', async () => {
  await withLockRoot(async lockRoot => {
    // Simulate an owner that was SIGKILLed mid-install: the directory is left
    // behind and its mtime stops advancing.
    const abandoned = join(lockRoot, 'command-stream-v-latest.lock');
    await mkdir(abandoned, { recursive: true });
    await writeFile(join(abandoned, 'owner.json'), '{"pid":1}\n');
    const lock = await acquireAliasLock('command-stream-v-latest', { lockRoot, staleMs: 20, pollMs: 5 });
    assert.equal(lock.acquired, true);
    await lock.release();
  });
});

await test('waiting for a lock gives up instead of hanging', async () => {
  await withLockRoot(async lockRoot => {
    const holder = await acquireAliasLock('command-stream-v-latest', { lockRoot, heartbeatMs: 5 });
    const started = Date.now();
    const lock = await acquireAliasLock('command-stream-v-latest', { lockRoot, timeoutMs: 60, pollMs: 10, staleMs: 60000 });
    assert.equal(lock.acquired, false, 'timed-out waiters proceed unlocked rather than blocking the run');
    assert.ok(Date.now() - started >= 60);
    await lock.release();
    await holder.release();
  });
});

await test('an unusable lock root degrades instead of failing the load', async () => {
  const lock = await acquireAliasLock('command-stream-v-latest', {
    lockRoot: '/nonexistent-root-2113/locks',
    fs: {
      mkdir: async () => {
        const error = new Error('EACCES: permission denied');
        error.code = 'EACCES';
        throw error;
      },
    },
  });
  assert.equal(lock.acquired, false);
  await lock.release();
});

await test('withAliasLock releases the lock when the body throws', async () => {
  await withLockRoot(async lockRoot => {
    await assert.rejects(
      () =>
        withAliasLock(
          'command-stream-v-latest',
          async () => {
            throw new Error('install failed');
          },
          { lockRoot }
        ),
      /install failed/
    );
    await assert.rejects(() => stat(join(lockRoot, 'command-stream-v-latest.lock')), /ENOENT/);
  });
});

await test('ensureUseM installs the single-flight guard', async () => {
  resetSingleFlightState();
  delete globalThis.use;
  const { ensureUseM } = await import('../src/use-m-bootstrap.lib.mjs');
  const fetchUseMCode = async () => '({ use: async () => { globalThis.__2113Calls = (globalThis.__2113Calls || 0) + 1; return { $: "dollar" }; } })';
  globalThis.__2113Calls = 0;
  const use = await ensureUseM({ fetchUseMCode });
  const results = await Promise.all(Array.from({ length: 12 }, () => use('command-stream')));
  const calls = globalThis.__2113Calls;
  delete globalThis.__2113Calls;
  delete globalThis.use;
  resetSingleFlightState();
  assert.equal(calls, 1, 'twelve concurrent loads must trigger a single install');
  for (const result of results) assert.deepEqual(result, { $: 'dollar' });
});

console.log(`\n📊 ${passed + failed} test(s): ✅ ${passed} passed, ❌ ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
