/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getCachedClaudeLimits, getCachedClaudeSubscription, getCachedCodexLimits, getCachedCodexSubscription, resetLimitCache } from '../src/limits.lib.mjs';

async function withRouter(t, response, fn) {
  const root = await mkdtemp(join(tmpdir(), 'hive-3785-router-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ path: req.url, authorized: req.headers.authorization === 'Bearer synthetic-router-client' });
    res.writeHead(response.status || 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response.body || {}));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const names = ['HIVE_MIND_USE_ROUTER', 'HIVE_MIND_ROUTER_URL', 'HIVE_MIND_ROUTER_TOKEN'];
  const previous = names.map(name => process.env[name]);
  try {
    process.env.HIVE_MIND_USE_ROUTER = '1';
    process.env.HIVE_MIND_ROUTER_URL = `http://127.0.0.1:${server.address().port}`;
    process.env.HIVE_MIND_ROUTER_TOKEN = 'synthetic-router-client';
    resetLimitCache();
    await fn(requests, { authPath: join(root, 'missing-auth.json') });
  } finally {
    names.forEach((name, index) => (previous[index] === undefined ? delete process.env[name] : (process.env[name] = previous[index])));
  }
}

test('explicit Router limits use its provider-neutral API and shared metadata result', { timeout: 10000 }, async t => {
  await withRouter(t, { body: { schema_version: 1, subscriptions: [{ provider: 'openai', state: 'available', status: 'active', plan: 'pro', windows: [{ name: 'primary', used_percentage: 12, window_seconds: 18000, resets_at: '2030-01-01T00:00:00Z' }] }] } }, async (requests, options) => {
    const limits = await getCachedCodexLimits(false, options);
    const metadata = await getCachedCodexSubscription(false, options);
    assert.equal(limits.success, true);
    assert.equal(limits.usage.currentSession.percentage, 12);
    assert.equal(metadata.subscription.source, 'router');
    assert.equal(metadata.subscription.planType, 'pro');
    assert.deepEqual(requests, [{ path: '/api/usage/openai', authorized: true }]);
  });
});

test('an unsupported Router usage API reports selected authority failure without a local fallback', { timeout: 10000 }, async t => {
  await withRouter(t, { status: 404 }, async (requests, options) => {
    const result = await getCachedCodexLimits(false, options);
    assert.equal(result.success, false);
    assert.match(result.error, /Router.*404/);
    assert.deepEqual(requests, [{ path: '/api/usage/openai', authorized: true }]);
  });
});

test('missing Router token fails before sending any usage request', { timeout: 10000 }, async t => {
  await withRouter(t, {}, async (requests, options) => {
    delete process.env.HIVE_MIND_ROUTER_TOKEN;
    const result = await getCachedCodexLimits(false, options);
    assert.equal(result.success, false);
    assert.match(result.error, /Router.*token/i);
    assert.equal(requests.length, 0);
  });
});

test('Router Codex maps a weekly primary window and preserves additional metered limits', { timeout: 10000 }, async t => {
  const weekly = { name: 'primary', used_percentage: 28, window_seconds: 604800 };
  const additional = { name: 'spark', metered_feature: 'spark', limit_name: 'Spark', allowed: false, limit_reached: true, windows: [{ name: 'primary', used_percentage: 100, window_seconds: 18000 }] };
  await withRouter(t, { body: { schema_version: 1, subscriptions: [{ provider: 'openai', state: 'available', windows: [weekly], additional_limits: [additional] }] } }, async (requests, options) => {
    const result = await getCachedCodexLimits(false, options);
    assert.equal(result.success, true);
    assert.equal(result.usage.currentSession.percentage, null);
    assert.equal(result.usage.allModels.percentage, 28);
    assert.equal(result.additionalRateLimits[0].limitId, 'spark');
    assert.equal(result.additionalRateLimits[0].currentSession.percentage, 100);
    assert.equal(result.additionalRateLimits[0].limitReached, true);
  });
});

test('Router Claude uses the same authority for usage, entitlement and paid expiration', { timeout: 10000 }, async t => {
  const subscriptionEnd = '2030-02-01T00:00:00Z';
  const record = {
    provider: 'anthropic',
    state: 'available',
    status: 'canceled',
    plan: 'max',
    subscription_end: subscriptionEnd,
    windows: [
      { name: 'five_hour', used_percentage: 7 },
      { name: 'seven_day', used_percentage: 18 },
      { name: 'seven_day_sonnet', used_percentage: 21 },
    ],
  };
  await withRouter(t, { body: { schema_version: 1, subscriptions: [record] } }, async (requests, options) => {
    const nativeOptions = { credentialsPath: options.authPath };
    const result = await getCachedClaudeLimits(false, nativeOptions);
    const metadata = await getCachedClaudeSubscription(false, nativeOptions);
    assert.equal(result.usage.currentSession.percentage, 7);
    assert.equal(result.usage.allModels.percentage, 18);
    assert.equal(result.usage.sonnetOnly.percentage, 21);
    assert.equal(metadata.subscription.endsAt, subscriptionEnd);
    assert.deepEqual(requests, [{ path: '/api/usage/anthropic', authorized: true }]);
  });
});

for (const body of [
  { schema_version: 2, subscriptions: [] },
  { schema_version: 1, subscriptions: [{ provider: 'openai', state: 'unverified', windows: [] }] },
  { schema_version: 1, subscriptions: [{ provider: 'openai', state: 'available' }] },
]) {
  test(`Router unavailable or unsupported data fails closed: ${JSON.stringify(body)}`, { timeout: 10000 }, async t => {
    await withRouter(t, { body }, async (requests, options) => {
      const result = await getCachedCodexLimits(false, options);
      assert.equal(result.success, false);
      assert.equal(result.source, 'router');
      assert.equal(requests.length, 1);
    });
  });
}
