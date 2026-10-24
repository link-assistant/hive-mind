/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getCachedGitHubLimits, getCachedMemoryInfo, getCachedCpuInfo, getCachedDiskInfo, getCachedClaudeSubscription, getCachedCodexSubscription, getLimitCache, resetLimitCache } from '../src/limits.lib.mjs';

const probes = { github: getCachedGitHubLimits, memory: getCachedMemoryInfo, cpu: getCachedCpuInfo, disk: getCachedDiskInfo, 'claude-subscription': getCachedClaudeSubscription, 'codex-subscription': getCachedCodexSubscription };

for (const [key, probe] of Object.entries(probes)) {
  test(`${key}: concurrent cold-cache callers share one probe and retain the existing TTL`, { timeout: 5000 }, async () => {
    resetLimitCache();
    let calls = 0;
    let release;
    const gate = new Promise(resolve => {
      release = resolve;
    });
    const load = async () => {
      calls++;
      await gate;
      return { success: true, source: key };
    };
    const pending = Array.from({ length: 8 }, () => probe(false, { load }));
    await Promise.resolve();
    release();
    const results = await Promise.all(pending);
    assert.equal(calls, 1);
    for (const result of results) assert.deepEqual(result, { success: true, source: key });
    await probe(false, { load });
    assert.equal(calls, 1);
    getLimitCache().cache.get(key).timestamp = 0;
    await probe(false, { load });
    assert.equal(calls, 2, 'expiry refreshes the probe');
  });
}

test('failed and rejected probes are shared but can be retried', { timeout: 5000 }, async () => {
  for (const reject of [false, true]) {
    resetLimitCache();
    let calls = 0;
    const load = async () => {
      calls++;
      if (reject) throw new Error('probe failed');
      return { success: false };
    };
    const results = await Promise.allSettled([getCachedCpuInfo(false, { load }), getCachedCpuInfo(false, { load })]);
    assert.equal(calls, 1);
    assert.equal(results[0].status, reject ? 'rejected' : 'fulfilled');
    await getCachedCpuInfo(false, { load }).catch(() => {});
    assert.equal(calls, 2);
  }
});

test('deleting a probe while it runs prevents its stale result from being cached', { timeout: 5000 }, async () => {
  resetLimitCache();
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const old = getCachedCpuInfo(false, {
    load: async () => {
      await gate;
      return { success: true, value: 'old' };
    },
  });
  getLimitCache().delete('cpu');
  const fresh = await getCachedCpuInfo(false, { load: async () => ({ success: true, value: 'fresh' }) });
  release();
  assert.equal((await old).value, 'old');
  assert.deepEqual(await getCachedCpuInfo(false, { load: async () => assert.fail('fresh value must remain cached') }), fresh);
});

test('clearing the cache detaches pending probes', { timeout: 5000 }, async () => {
  resetLimitCache();
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const pending = getCachedCpuInfo(false, {
    load: async () => {
      await gate;
      return { success: true };
    },
  });
  const cache = getLimitCache();
  cache.clear();
  release();
  await pending;
  assert.equal(cache.get('cpu'), null);
});
