// @hive-mind-test-suite default
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getCachedClaudeLimits, getCachedCodexLimits, getClaudeUsageLimits, getCodexUsageLimits, getClaudeSubscriptionInfo, resetLimitCache } from '../src/limits.lib.mjs';
import { getCachedUsageLimits } from '../src/usage-limits-cache.lib.mjs';

async function fixture(t, selected = false) {
  resetLimitCache();
  t.after(resetLimitCache);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-limits-request-generation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const canonical = path.join(root, 'canonical');
  const configuration = path.join(root, 'configuration');
  await fs.mkdir(canonical, { mode: 0o700 });
  await fs.mkdir(configuration, { mode: 0o700 });
  const previous = { CODEX_AUTH_HOME: process.env.CODEX_AUTH_HOME, CODEX_HOME: process.env.CODEX_HOME };
  delete process.env.CODEX_AUTH_HOME;
  if (selected) Object.assign(process.env, { CODEX_AUTH_HOME: canonical, CODEX_HOME: configuration });
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const auth = path.join(canonical, 'auth.json');
  await fs.writeFile(auth, '{"tokens":{"access_token":"synthetic-G0"}}', { mode: 0o600 });
  return { canonical, configuration, auth };
}

function pendingRequest() {
  let entered;
  let release;
  const started = new Promise(resolve => {
    entered = resolve;
  });
  const result = new Promise(resolve => {
    release = resolve;
  });
  return {
    started,
    release,
    fetchLimits: () => {
      entered();
      return result;
    },
  };
}

const readers = {
  claude: (auth, fetchLimits) => getCachedClaudeLimits(false, { credentialsPath: auth, fetchLimits }),
  codex: (auth, fetchLimits) => getCachedCodexLimits(false, { authPath: auth, fetchLimits }),
};
const responses = {
  success: { success: true, usage: { marker: 'synthetic-previous-account' } },
  auth: { success: false, failureKind: 'auth', error: 'synthetic-previous-auth-error' },
  rate_limited: { success: false, failureKind: 'rate_limited', error: 'synthetic-previous-rate-limit', retryAfterMs: 60000 },
};

for (const [provider, read] of Object.entries(readers)) {
  for (const mutation of ['logout', 'replacement']) {
    for (const [kind, response] of Object.entries(responses)) {
      test(`${provider} discards a pending ${kind} after ${mutation}`, { timeout: 5000 }, async t => {
        const { auth } = await fixture(t);
        const pending = pendingRequest();
        const request = read(auth, pending.fetchLimits);
        try {
          await pending.started;
          if (mutation === 'logout') await fs.unlink(auth);
          else {
            await fs.writeFile(`${auth}.next`, '{"tokens":{"access_token":"synthetic-G1"}}', { mode: 0o600 });
            await fs.rename(`${auth}.next`, auth);
          }
        } finally {
          pending.release(response);
        }
        const actual = await request;
        assert.equal(actual.success, false, 'Do not return a successful response for a retired credential generation.');
        assert.equal(actual.failureKind, 'auth');
        assert.match(actual.error, /authentication changed/i);
        assert.doesNotMatch(JSON.stringify(actual), /synthetic-previous/);
      });
    }
  }

  test(`${provider} preserves the newer cache entry when an old request completes last`, { timeout: 5000 }, async t => {
    const { auth } = await fixture(t);
    const pending = pendingRequest();
    const request = read(auth, pending.fetchLimits);
    const current = { success: true, usage: { marker: 'synthetic-current-account' } };
    try {
      await pending.started;
      await fs.writeFile(`${auth}.next`, '{"tokens":{"access_token":"synthetic-G1"}}', { mode: 0o600 });
      await fs.rename(`${auth}.next`, auth);
      assert.deepEqual(await read(auth, async () => current), current);
    } finally {
      pending.release(responses.success);
    }
    await request;
    assert.deepEqual(
      await read(auth, async () => {
        assert.fail('An obsolete response replaced a newer valid cache entry.');
      }),
      current
    );
  });

  test(`${provider} does not reuse a previous generation's completed rate limit`, { timeout: 5000 }, async t => {
    const { auth } = await fixture(t);
    assert.equal((await read(auth, async () => responses.rate_limited)).failureKind, 'rate_limited');
    await fs.writeFile(auth, '{"tokens":{"access_token":"synthetic-G1"}}');
    const current = { success: true, usage: {} };
    assert.deepEqual(await read(auth, async () => current), current);
  });
}

for (const mutation of ['private-auth', 'root-permissions', 'removed-selector']) {
  test(`selected Codex revalidates ${mutation} after a pending response`, { timeout: 5000 }, async t => {
    const f = await fixture(t, true);
    const pending = pendingRequest();
    const request = getCachedCodexLimits(false, { fetchLimits: pending.fetchLimits });
    try {
      await pending.started;
      if (mutation === 'private-auth') await fs.writeFile(path.join(f.configuration, 'auth.json'), '{"tokens":{"access_token":"synthetic-private"}}', { mode: 0o600 });
      else if (mutation === 'root-permissions') await fs.chmod(f.canonical, 0o755);
      else delete process.env.CODEX_AUTH_HOME;
    } finally {
      pending.release(responses.success);
    }
    const actual = await request;
    assert.equal(actual.success, false);
    assert.equal(actual.failureKind, 'auth');
    assert.doesNotMatch(JSON.stringify(actual), /synthetic-previous/);
  });
}

test('a coalesced caller revalidates its own selected storage', { timeout: 5000 }, async t => {
  const { auth } = await fixture(t);
  const pending = pendingRequest();
  let admit = true;
  let joining = false;
  let joined;
  const ready = new Promise(resolve => {
    joined = resolve;
  });
  const cache = {
    get(key) {
      if (joining && key.endsWith('-failure')) joined();
    },
    set() {},
    delete() {},
  };
  const options = { key: 'coalesced-storage', credentialsPath: auth, ttlMs: 60000, cache, fetchLimits: pending.fetchLimits };
  const primary = getCachedUsageLimits(options);
  let selected;
  try {
    await pending.started;
    joining = true;
    selected = getCachedUsageLimits({ ...options, validateCredentials: async () => admit });
    await ready;
    admit = false;
    pending.release(responses.success);
    assert.deepEqual(await primary, responses.success);
    const actual = await selected;
    assert.equal(actual.success, false);
    assert.equal(actual.failureKind, 'auth');
  } finally {
    pending.release(responses.success);
    await Promise.allSettled([primary, selected]);
  }
});

const directReaders = {
  'Claude usage': auth => getClaudeUsageLimits(false, auth),
  'Codex usage': auth => getCodexUsageLimits(false, auth),
  'Claude profile': credentialsPath => getClaudeSubscriptionInfo({ credentialsPath }),
};
for (const [label, read] of Object.entries(directReaders)) {
  for (const phase of ['headers', 'body']) {
    for (const mutation of ['logout', 'replacement']) {
      test(`${label} discards a direct response after ${mutation} during ${phase}`, { timeout: 5000 }, async t => {
        const { auth } = await fixture(t);
        const credentials = token => JSON.stringify({ tokens: { access_token: token }, claudeAiOauth: { accessToken: token } });
        await fs.writeFile(auth, credentials('synthetic-G0'));
        const mutate = async () => {
          if (mutation === 'logout') await fs.unlink(auth);
          else {
            await fs.writeFile(`${auth}.next`, credentials('synthetic-G1'));
            await fs.rename(`${auth}.next`, auth);
          }
        };
        t.mock.method(globalThis, 'fetch', async () => {
          const response = new globalThis.Response('{}');
          if (phase === 'headers') await mutate();
          else
            t.mock.method(response, 'json', async () => {
              await mutate();
              return {};
            });
          return response;
        });
        const result = await read(auth);
        assert.equal(result.success, false);
        assert.equal(result.failureKind, 'auth');
        assert.match(result.error, /authentication changed/i);
      });
    }
  }
}
