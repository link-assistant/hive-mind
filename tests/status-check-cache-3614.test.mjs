#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Issue #3614: shared rate limit, cache and request de-duplication for the
 * Docker / start-command status checks the Telegram bot runs.
 *
 * Pins the acceptance criteria:
 * - the default allows at most one check per resource every 5 s (12/minute);
 * - the interval is configurable by HIVE_MIND_DOCKER_STATUS_MIN_INTERVAL_MS and
 *   by the bot's --docker-status-min-interval-ms option;
 * - concurrent callers share one check;
 * - a state change the bot makes itself invalidates the cached result.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3614
 */

import assert from 'assert/strict';
import { getLinoYargsFactory, hideBin } from '../src/cli-arguments.lib.mjs';
import { createYargsConfig } from '../src/telegram.config.lib.mjs';
import { DEFAULT_DOCKER_STATUS_MIN_INTERVAL_MS, DOCKER_STATUS_MIN_INTERVAL_ENV, configureDockerStatusMinIntervalMs, createStatusCheckCache, getDockerStatusMinIntervalMs, invalidateSessionStatus, normalizeMinIntervalMs, resetStatusCheckCacheForTests, resolveDockerStatusMinIntervalMs, statusCheckCache } from '../src/status-check-cache.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.stack || error.message}`);
    failed++;
  }
}

function withEnv(env, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeClock(start = 1_000_000) {
  let time = start;
  return {
    now: () => time,
    advance: ms => {
      time += ms;
    },
  };
}

const yargs = getLinoYargsFactory();
function parseBotArgs(args = [], env = {}) {
  return withEnv(env, () =>
    createYargsConfig(yargs(hideBin(['node', 'telegram-bot.mjs', ...args])))
      .exitProcess(false)
      .fail((message, error) => {
        throw error || new Error(message);
      })
      .parse()
  );
}

// --- Configuration -------------------------------------------------------

await test('default interval is 5000 ms (at most 12 checks per minute) with no configuration', () => {
  assert.equal(DEFAULT_DOCKER_STATUS_MIN_INTERVAL_MS, 5000);
  assert.equal(DOCKER_STATUS_MIN_INTERVAL_ENV, 'HIVE_MIND_DOCKER_STATUS_MIN_INTERVAL_MS');
  withEnv({ HIVE_MIND_DOCKER_STATUS_MIN_INTERVAL_MS: undefined }, () => {
    configureDockerStatusMinIntervalMs(null);
    assert.equal(resolveDockerStatusMinIntervalMs(), 5000);
    assert.equal(getDockerStatusMinIntervalMs(), 5000);
    assert.equal(statusCheckCache.getMinIntervalMs(), 5000);
    assert.equal(Math.floor(60_000 / getDockerStatusMinIntervalMs()), 12);
  });
});

await test('HIVE_MIND_DOCKER_STATUS_MIN_INTERVAL_MS overrides the default', () => {
  withEnv({ HIVE_MIND_DOCKER_STATUS_MIN_INTERVAL_MS: '15000' }, () => {
    configureDockerStatusMinIntervalMs(null);
    assert.equal(resolveDockerStatusMinIntervalMs(), 15000);
    assert.equal(statusCheckCache.getMinIntervalMs(), 15000);
  });
  withEnv({ HIVE_MIND_DOCKER_STATUS_MIN_INTERVAL_MS: '-5' }, () => {
    assert.equal(resolveDockerStatusMinIntervalMs(), 0, 'negative values are raised to 0');
  });
  withEnv({ HIVE_MIND_DOCKER_STATUS_MIN_INTERVAL_MS: 'soon' }, () => {
    assert.equal(resolveDockerStatusMinIntervalMs(), 5000, 'an invalid value falls back to the default');
  });
});

await test('bot option --docker-status-min-interval-ms defaults to the env value and can override it', () => {
  assert.equal(parseBotArgs([], { HIVE_MIND_DOCKER_STATUS_MIN_INTERVAL_MS: undefined }).dockerStatusMinIntervalMs, 5000);
  assert.equal(parseBotArgs([], { HIVE_MIND_DOCKER_STATUS_MIN_INTERVAL_MS: '20000' }).dockerStatusMinIntervalMs, 20000);
  assert.equal(parseBotArgs(['--docker-status-min-interval-ms', '10000'], { HIVE_MIND_DOCKER_STATUS_MIN_INTERVAL_MS: '20000' }).dockerStatusMinIntervalMs, 10000);
});

await test('configureDockerStatusMinIntervalMs() sets the interval of the shared cache', () => {
  withEnv({ HIVE_MIND_DOCKER_STATUS_MIN_INTERVAL_MS: undefined }, () => {
    try {
      assert.equal(configureDockerStatusMinIntervalMs(30000), 30000);
      assert.equal(statusCheckCache.getMinIntervalMs(), 30000);
      assert.equal(configureDockerStatusMinIntervalMs('2500'), 2500);
      assert.equal(configureDockerStatusMinIntervalMs(-1), 0);
      assert.equal(configureDockerStatusMinIntervalMs(Number.NaN), 5000, 'NaN falls back to the env/default');
    } finally {
      configureDockerStatusMinIntervalMs(null);
    }
    assert.equal(statusCheckCache.getMinIntervalMs(), 5000);
  });
});

await test('normalizeMinIntervalMs() accepts numbers and numeric strings only', () => {
  assert.equal(normalizeMinIntervalMs(1234.9), 1234);
  assert.equal(normalizeMinIntervalMs('42'), 42);
  assert.equal(normalizeMinIntervalMs(''), 5000);
  assert.equal(normalizeMinIntervalMs(undefined, 7), 7);
  assert.equal(normalizeMinIntervalMs(Infinity, 7), 7);
});

// --- Cache behaviour -----------------------------------------------------

await test('concurrent callers share one in-flight check', async () => {
  const cache = createStatusCheckCache({ minIntervalMs: 5000 });
  const gate = deferred();
  let loads = 0;
  const loader = () => {
    loads += 1;
    return gate.promise;
  };
  const callers = Array.from({ length: 10 }, () => cache.get('status:abc', loader));
  await Promise.resolve();
  assert.equal(loads, 1, 'only the first caller starts a check');
  gate.resolve({ status: 'executing' });
  const results = await Promise.all(callers);
  assert.equal(loads, 1);
  for (const result of results) assert.deepEqual(result, { status: 'executing' });
  const stats = cache.getStats();
  assert.equal(stats.misses, 1);
  assert.equal(stats.inflightJoins, 9);
});

await test('a result is reused until the interval has passed since the check finished', async () => {
  const clock = fakeClock();
  const cache = createStatusCheckCache({ minIntervalMs: 5000, now: clock.now });
  let loads = 0;
  const loader = async () => ++loads;
  assert.equal(await cache.get('k', loader), 1);
  clock.advance(4999);
  assert.equal(await cache.get('k', loader), 1, 'still fresh just before the interval');
  clock.advance(1);
  assert.equal(await cache.get('k', loader), 2, 'refreshed once the interval has passed');
  assert.equal(cache.getStats().hits, 1);
});

await test('the interval is counted from when a slow check finished, not when it started', async () => {
  const clock = fakeClock();
  const cache = createStatusCheckCache({ minIntervalMs: 5000, now: clock.now });
  let loads = 0;
  const loader = async () => {
    loads += 1;
    clock.advance(8000); // the check itself takes longer than the interval
    return loads;
  };
  await cache.get('k', loader);
  clock.advance(1000);
  await cache.get('k', loader);
  assert.equal(loads, 1);
});

await test('95 lookups a minute (the reported rate) start at most 12 checks per resource', async () => {
  const clock = fakeClock();
  const cache = createStatusCheckCache({ minIntervalMs: DEFAULT_DOCKER_STATUS_MIN_INTERVAL_MS, now: clock.now });
  const loads = new Map();
  const loaderFor = key => async () => loads.set(key, (loads.get(key) || 0) + 1);
  const step = 60_000 / 95;
  for (let i = 0; i < 95; i++) {
    // Every caller of the issue asks about the same two tasks.
    await Promise.all([cache.get('status:task-a', loaderFor('a')), cache.get('status:task-a', loaderFor('a')), cache.get('status:task-b', loaderFor('b'))]);
    clock.advance(step);
  }
  assert.ok(loads.get('a') <= 12, `task a: ${loads.get('a')} checks`);
  assert.ok(loads.get('b') <= 12, `task b: ${loads.get('b')} checks`);
  assert.ok(loads.get('a') >= 11, 'the cache still refreshes about every 5 s');
});

await test('an overridden interval changes the rate (15 s → at most 4 checks a minute)', async () => {
  const clock = fakeClock();
  let interval = 15000;
  const cache = createStatusCheckCache({ minIntervalMs: () => interval, now: clock.now });
  let loads = 0;
  for (let i = 0; i < 60; i++) {
    await cache.get('k', async () => ++loads);
    clock.advance(1000);
  }
  assert.equal(loads, 4);
  interval = 0;
  await cache.get('k', async () => ++loads);
  await cache.get('k', async () => ++loads);
  assert.equal(loads, 6, 'interval 0 turns the time-based reuse off');
});

await test('interval 0 still de-duplicates concurrent callers', async () => {
  const cache = createStatusCheckCache({ minIntervalMs: 0 });
  let loads = 0;
  const gate = deferred();
  const callers = [cache.get('k', () => (loads++, gate.promise)), cache.get('k', () => (loads++, gate.promise))];
  gate.resolve('ok');
  assert.deepEqual(await Promise.all(callers), ['ok', 'ok']);
  assert.equal(loads, 1);
});

await test('a failed check is not cached and reaches every joined caller', async () => {
  const cache = createStatusCheckCache({ minIntervalMs: 5000 });
  const gate = deferred();
  let loads = 0;
  const first = cache.get('k', () => (loads++, gate.promise));
  const second = cache.get('k', () => (loads++, gate.promise));
  gate.reject(new Error('daemon down'));
  await assert.rejects(first, /daemon down/);
  await assert.rejects(second, /daemon down/);
  assert.equal(await cache.get('k', async () => (loads++, 'up')), 'up', 'the next lookup tries again');
  assert.equal(loads, 2);
});

await test('invalidate() makes the next lookup run a fresh check', async () => {
  const cache = createStatusCheckCache({ minIntervalMs: 60_000 });
  let loads = 0;
  await cache.get('k', async () => ++loads);
  cache.invalidate('k');
  assert.equal(await cache.get('k', async () => ++loads), 2);
});

await test('a check that started before invalidate() answers its callers but is not cached', async () => {
  const cache = createStatusCheckCache({ minIntervalMs: 60_000 });
  const stale = deferred();
  const early = cache.get('k', () => stale.promise);
  cache.invalidate('k'); // e.g. the bot launched the task while the check ran
  const fresh = cache.get('k', async () => 'after');
  stale.resolve('before');
  assert.equal(await early, 'before');
  assert.equal(await fresh, 'after', 'a lookup after the invalidation does not join the stale check');
  assert.equal(await cache.get('k', async () => 'unexpected'), 'after', 'the stale result did not overwrite the fresh one');
});

await test('clear() forgets every entry, including checks still running', async () => {
  const cache = createStatusCheckCache({ minIntervalMs: 60_000 });
  const running = deferred();
  const early = cache.get('a', () => running.promise);
  await cache.get('b', async () => 1);
  cache.clear();
  running.resolve('old');
  await early;
  assert.equal(await cache.get('a', async () => 'new'), 'new');
  assert.equal(await cache.get('b', async () => 2), 2);
});

await test('expired entries of finished sessions are swept, fresh ones and detached checks are kept', async () => {
  const clock = fakeClock();
  const cache = createStatusCheckCache({ minIntervalMs: 5000, now: clock.now });
  const stale = deferred();
  const detached = cache.get('status:running', () => stale.promise);
  cache.invalidate('status:running'); // its check keeps running without an in-flight record
  for (let i = 0; i < 600; i++) await cache.get(`status:old-${i}`, async () => i);
  clock.advance(6000);
  await cache.get('status:fresh', async () => 'fresh'); // a miss over the threshold sweeps
  assert.ok(cache.getStats().entries <= 2, `entries left: ${cache.getStats().entries}`);
  assert.equal(await cache.get('status:fresh', async () => 'unexpected'), 'fresh');
  stale.resolve('before');
  assert.equal(await detached, 'before');
  assert.equal(await cache.get('status:running', async () => 'after'), 'after', 'the sweep kept the invalidation of the detached check');
});

await test('invalidatePrefix() forgets only matching keys', async () => {
  const cache = createStatusCheckCache({ minIntervalMs: 60_000 });
  await cache.get('pgrep', async () => 'all');
  await cache.get('pgrep:node', async () => 'node');
  await cache.get('status:x', async () => 'x');
  cache.invalidatePrefix('pgrep');
  assert.equal(await cache.get('pgrep', async () => 'all2'), 'all2');
  assert.equal(await cache.get('pgrep:node', async () => 'node2'), 'node2');
  assert.equal(await cache.get('status:x', async () => 'x2'), 'x');
});

await test('the clone option keeps callers from changing the shared value', async () => {
  const cache = createStatusCheckCache({ minIntervalMs: 60_000, clone: value => structuredClone(value) });
  const first = await cache.get('k', async () => ({ processIds: { pid: 1 } }));
  first.processIds.pid = 99;
  assert.deepEqual(await cache.get('k', async () => null), { processIds: { pid: 1 } });
});

await test('invalidateSessionStatus() drops the session status and the shared listings', async () => {
  resetStatusCheckCacheForTests();
  const keys = ['status:s1', 'status:s2', 'tmux:s1', 'list', 'docker-ps', 'screen-ls', 'pgrep'];
  for (const key of keys) await statusCheckCache.get(key, async () => 'old');
  invalidateSessionStatus('s1');
  const after = {};
  for (const key of keys) after[key] = await statusCheckCache.get(key, async () => 'new');
  assert.deepEqual(after, { 'status:s1': 'new', 'status:s2': 'old', 'tmux:s1': 'new', list: 'new', 'docker-ps': 'new', 'screen-ls': 'new', pgrep: 'new' });
  resetStatusCheckCacheForTests();
});

console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
