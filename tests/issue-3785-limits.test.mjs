/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, rename, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { formatUsageMessage, formatCodexLimitsSection, getClaudeSubscriptionInfo, getClaudeUsageLimits, getCodexSubscriptionInfo, getCodexUsageLimits, getCachedCodexLimits, getCachedCodexSubscription, resolveLimitsCredentialPaths, resetLimitCache } from '../src/limits.lib.mjs';

test('Claude authentication error has its own section without subscription metadata', () => {
  const codex = formatCodexLimitsSection(null, 'Codex authentication expired.', { subscription: { planType: 'pro' } });
  const message = formatUsageMessage(null, null, null, null, null, 'Claude authentication expired.', [codex, 'Queues\nclaude (pending: 0, processing: 0)']);
  const systemBlock = message.match(/^```\n([\s\S]*?)```/)[1];
  assert.doesNotMatch(systemBlock, /Claude/);
  assert.match(message, /```\n\nClaude limits\n\n```\nClaude authentication expired\./);
  assert.equal((message.match(/Claude authentication expired\./g) || []).length, 1);
});

test('both providers have separate sections when neither has authentication', () => {
  const message = formatUsageMessage(null, null, null, null, null, 'Claude unavailable.', [formatCodexLimitsSection(null, 'Codex unavailable.')]);
  assert.match(message, /Claude limits\n\n```\nClaude unavailable\./);
  assert.match(message, /Codex limits\n\n```\nCodex unavailable\./);
});

async function withCredentials(t, credentials, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'hive-limits-3785-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'credentials.json');
  await writeFile(file, JSON.stringify(credentials));
  return fn(file);
}

test('authenticated Claude entitlement overrides a stale locally stored Max plan', async t => {
  t.mock.method(globalThis, 'fetch', async () => new globalThis.Response(JSON.stringify({ account: { has_claude_max: false, has_claude_pro: false }, organization: { subscription_status: 'inactive' } })));
  await withCredentials(t, { claudeAiOauth: { accessToken: 'synthetic', subscriptionType: 'max' } }, async credentialsPath => {
    const result = await getClaudeSubscriptionInfo({ credentialsPath });
    assert.equal(result.success, true);
    assert.equal(result.subscription.planType, 'free');
    assert.equal(result.subscription.source, 'authenticated-profile');
    assert.equal(result.subscription.endsAt, null);
  });
});

test('Claude live Max entitlement and paid expiry are retained when supplied', async t => {
  t.mock.method(globalThis, 'fetch', async () => new globalThis.Response(JSON.stringify({ account: { has_claude_max: true, has_claude_pro: true }, organization: { subscription_status: 'canceled', subscription_ends_at: '2026-11-05T07:22:00Z' } })));
  await withCredentials(t, { claudeAiOauth: { accessToken: 'synthetic', subscriptionType: 'pro' } }, async credentialsPath => {
    const result = await getClaudeSubscriptionInfo({ credentialsPath });
    assert.equal(result.subscription.planType, 'max');
    assert.equal(result.subscription.status, 'canceled');
    assert.equal(result.subscription.endsAt, '2026-11-05T07:22:00Z');
  });
});

test('missing Claude authentication does not invent a cancelled subscription', async t => {
  const fetcher = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('must not request without auth');
  });
  await withCredentials(t, {}, async credentialsPath => {
    const result = await getClaudeSubscriptionInfo({ credentialsPath });
    assert.equal(result.success, false);
    assert.equal(result.subscription, undefined);
    assert.equal(fetcher.mock.callCount(), 0);
  });
});

test('stored Codex claims are identified as metadata even when their expiry is in the future', async t => {
  const payload = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_plan_type: 'pro', chatgpt_subscription_active_until: '2099-11-05T07:22:00Z' } })).toString('base64url');
  await withCredentials(t, { tokens: { id_token: `synthetic.${payload}.synthetic` } }, async authPath => {
    const result = await getCodexSubscriptionInfo({ authPath });
    assert.equal(result.subscription.source, 'stored-token');
    const section = formatCodexLimitsSection(null, 'Codex authentication expired.', result);
    assert.match(section, /stored metadata/);
    assert.match(section, /Codex authentication expired\./);
  });
});

test('a successful usage cache is invalidated when credentials rotate', async t => {
  resetLimitCache();
  await withCredentials(t, { generation: 0 }, async authPath => {
    let requests = 0;
    const fetchLimits = async () => ({ success: true, generation: ++requests });
    await getCachedCodexLimits(false, { authPath, fetchLimits });
    await writeFile(authPath, JSON.stringify({ generation: 1 }));
    const result = await getCachedCodexLimits(false, { authPath, fetchLimits });
    assert.equal(result.generation, 2);
  });
});

test('equal-mtime atomic credential replacement invalidates an authentication error', async t => {
  resetLimitCache();
  await withCredentials(t, { generation: 0 }, async authPath => {
    const time = new Date('2026-10-25T10:00:00Z');
    await utimes(authPath, time, time);
    const before = await stat(authPath);
    let requests = 0;
    const fetchLimits = async () => (++requests === 1 ? { success: false, failureKind: 'auth' } : { success: true });
    await getCachedCodexLimits(false, { authPath, fetchLimits });
    await writeFile(`${authPath}.next`, JSON.stringify({ generation: 1 }));
    await utimes(`${authPath}.next`, time, time);
    await rename(`${authPath}.next`, authPath);
    assert.equal((await stat(authPath)).mtimeMs, before.mtimeMs);
    assert.equal((await getCachedCodexLimits(false, { authPath, fetchLimits })).success, true);
    assert.equal(requests, 2);
  });
});

test('different credential authorities never share a usage cache entry', async t => {
  resetLimitCache();
  await withCredentials(t, {}, async authPath => {
    const otherPath = `${authPath}.other`;
    await writeFile(otherPath, '{}');
    await getCachedCodexLimits(false, { authPath, fetchLimits: async () => ({ success: true, authority: 'first' }) });
    const result = await getCachedCodexLimits(false, { authPath: otherPath, fetchLimits: async () => ({ success: true, authority: 'second' }) });
    assert.equal(result.authority, 'second');
  });
});

test('limits paths follow effective tool homes and never fall back to another home', () => {
  assert.deepEqual(resolveLimitsCredentialPaths({ CLAUDE_CONFIG_DIR: '/selected/claude', CODEX_HOME: '/selected/codex' }, '/host'), {
    claude: '/selected/claude/.credentials.json',
    codex: '/selected/codex/auth.json',
    codexConfig: '/selected/codex/config.toml',
  });
  assert.equal(resolveLimitsCredentialPaths({}, '/host').codex, '/host/.codex/auth.json');
});

test('logout immediately invalidates cached Codex subscription claims', async t => {
  resetLimitCache();
  const payload = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_plan_type: 'pro' } })).toString('base64url');
  await withCredentials(t, { tokens: { id_token: `synthetic.${payload}.synthetic` } }, async authPath => {
    assert.equal((await getCachedCodexSubscription(false, { authPath })).subscription.planType, 'pro');
    await rm(authPath);
    assert.equal((await getCachedCodexSubscription(false, { authPath })).success, false);
  });
});

test('verbose limits diagnostics omit credential suffixes, account ids and response bodies', async t => {
  const messages = [];
  t.mock.method(console, 'log', (...args) => messages.push(args.join(' ')));
  t.mock.method(console, 'error', (...args) => messages.push(args.join(' ')));
  t.mock.method(globalThis, 'fetch', async () => new globalThis.Response('private-response-sentinel', { status: 401, headers: { 'set-cookie': 'private-cookie-sentinel' } }));
  await withCredentials(t, { auth_mode: 'chatgpt', tokens: { access_token: 'synthetic-private-token-sentinel', account_id: 'private-account-sentinel' } }, async authPath => {
    await getCodexUsageLimits(true, authPath, 'http://127.0.0.1');
  });
  const output = messages.join('\n');
  assert.doesNotMatch(output, /sentinel|e-sentinel|l-sentinel/);
  assert.match(output, /HTTP status: 401/);
});

test('successful profile diagnostics omit values from credentials and provider metadata', async t => {
  const messages = [];
  t.mock.method(console, 'log', (...args) => messages.push(args.join(' ')));
  t.mock.method(console, 'error', (...args) => messages.push(args.join(' ')));
  t.mock.method(globalThis, 'fetch', async () => new globalThis.Response(JSON.stringify({ organization: { subscription_status: 'private-provider-sentinel' } })));
  await withCredentials(t, { claudeAiOauth: { accessToken: 'synthetic-token', subscriptionType: 'private-credential-sentinel' } }, async credentialsPath => {
    const result = await getClaudeSubscriptionInfo({ verbose: true, credentialsPath });
    assert.equal(result.success, true);
    assert.equal(result.subscription.planType, 'private-credential-sentinel');
    assert.equal(result.subscription.status, 'private-provider-sentinel');
  });
  assert.doesNotMatch(messages.join('\n'), /private-.*sentinel/);
});

test('malformed provider JSON and credential JSON cannot escape through errors or diagnostics', async t => {
  const messages = [];
  t.mock.method(console, 'log', (...args) => messages.push(args.join(' ')));
  t.mock.method(console, 'error', (...args) => messages.push(args.join(' ')));
  t.mock.method(globalThis, 'fetch', async () => new globalThis.Response('private-body-sentinel'));
  await withCredentials(t, { claudeAiOauth: { accessToken: 'synthetic' }, tokens: { access_token: 'synthetic' } }, async authPath => {
    const results = [await getClaudeSubscriptionInfo({ verbose: true, credentialsPath: authPath }), await getClaudeUsageLimits(true, authPath), await getCodexUsageLimits(true, authPath, 'http://127.0.0.1')];
    assert.ok(results.every(result => result.success === false));
    assert.doesNotMatch(JSON.stringify(results), /private-/);
    await writeFile(authPath, 'private-credential-sentinel');
    await getClaudeUsageLimits(true, authPath);
    await getCodexUsageLimits(true, authPath, 'http://127.0.0.1');
  });
  assert.doesNotMatch(messages.join('\n'), /private-/);
});
