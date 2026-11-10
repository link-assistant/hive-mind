// @hive-mind-test-suite default
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { codexLimitsAuthAdmission, getCachedCodexLimits, getCodexUsageLimits, resetLimitCache } from '../src/limits.lib.mjs';
import { getCachedUsageLimits } from '../src/usage-limits-cache.lib.mjs';

async function fixture(t) {
  resetLimitCache();
  t.after(resetLimitCache);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-limits-storage-revalidation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const canonical = path.join(root, 'canonical');
  const configuration = path.join(root, 'configuration');
  await fs.mkdir(canonical, { mode: 0o700 });
  await fs.mkdir(configuration, { mode: 0o700 });
  const previous = { CODEX_AUTH_HOME: process.env.CODEX_AUTH_HOME, CODEX_HOME: process.env.CODEX_HOME };
  Object.assign(process.env, { CODEX_AUTH_HOME: canonical, CODEX_HOME: configuration });
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const auth = path.join(canonical, 'auth.json');
  await fs.writeFile(auth, '{"tokens":{"access_token":"synthetic-canonical"}}', { mode: 0o600 });
  return { canonical, configuration, auth };
}

// Pause at the real credential-version open, after selected-storage admission.
// Canonical admission itself opens auth.json relative to its held root instead.
function mutateDuringVersionRead(t, auth, mutation) {
  const originalOpen = fs.open;
  let armed = false;
  let changed = false;
  const mocked = t.mock.method(fs, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    if (armed && !changed && args[0] === auth) {
      changed = true;
      await mutation();
    }
    return handle;
  });
  syncBuiltinESMExports();
  t.after(() => {
    mocked.mock.restore();
    syncBuiltinESMExports();
  });
  return {
    arm() {
      armed = true;
    },
    changed: () => changed,
  };
}

const mutations = {
  'root permissions': f => fs.chmod(f.canonical, 0o755),
  'private credential injection': f => fs.writeFile(path.join(f.configuration, 'auth.json'), '{"tokens":{"access_token":"synthetic-private"}}', { mode: 0o600 }),
};
const responses = {
  success: { success: true, usage: { marker: 'synthetic-cached-response' } },
  auth: { success: false, failureKind: 'auth', error: 'synthetic-cached-auth' },
  rate_limited: { success: false, failureKind: 'rate_limited', error: 'synthetic-cached-rate-limit', retryAfterMs: 60000 },
};

function assertRefusal(result) {
  assert.equal(result.success, false);
  assert.equal(result.failureKind, 'auth');
  assert.doesNotMatch(JSON.stringify(result), /synthetic-cached/);
}

for (const [label, mutate] of Object.entries(mutations)) {
  for (const [kind, response] of Object.entries(responses)) {
    test(`cached ${kind} refuses ${label} changed during credential hashing`, { timeout: 5000 }, async t => {
      const f = await fixture(t);
      assert.deepEqual(await getCachedCodexLimits(false, { fetchLimits: async () => response }), response);
      const boundary = mutateDuringVersionRead(t, f.auth, () => mutate(f));
      boundary.arm();
      let fetched = false;
      const result = await getCachedCodexLimits(false, {
        fetchLimits: async () => {
          fetched = true;
          return responses.success;
        },
      });
      assert.equal(boundary.changed(), true);
      assert.equal(fetched, false);
      assertRefusal(result);
    });
  }

  test(`a cache miss refuses ${label} changed during credential hashing before fetching`, { timeout: 5000 }, async t => {
    const f = await fixture(t);
    const boundary = mutateDuringVersionRead(t, f.auth, () => mutate(f));
    boundary.arm();
    let fetched = false;
    const result = await getCachedCodexLimits(false, {
      fetchLimits: async () => {
        fetched = true;
        return responses.success;
      },
    });
    assert.equal(boundary.changed(), true);
    assert.equal(fetched, false, 'Do not dispatch a request after storage admission has expired.');
    assertRefusal(result);
  });

  for (const direct of [false, true]) {
    test(`${direct ? 'direct' : 'cached'} response refuses ${label} changed during final credential hashing`, { timeout: 5000 }, async t => {
      const f = await fixture(t);
      const boundary = mutateDuringVersionRead(t, f.auth, () => mutate(f));
      let result;
      if (direct) {
        t.mock.method(globalThis, 'fetch', async () => {
          boundary.arm();
          return new globalThis.Response('{}');
        });
        result = await getCodexUsageLimits();
      } else {
        result = await getCachedCodexLimits(false, {
          fetchLimits: async () => {
            boundary.arm();
            return responses.success;
          },
        });
      }
      assert.equal(boundary.changed(), true);
      assertRefusal(result);
    });
  }
}

test('a coalesced caller refuses a credential replacement during its own storage admission', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  let entered;
  let release;
  let joining;
  const started = new Promise(resolve => {
    entered = resolve;
  });
  const response = new Promise(resolve => {
    release = resolve;
  });
  const joined = new Promise(resolve => {
    joining = resolve;
  });
  let secondary = false;
  let atJoin = false;
  let replaced = false;
  const cache = {
    get(key) {
      if (secondary && key.endsWith('-failure')) {
        atJoin = true;
        joining();
      }
    },
    set() {},
    delete() {},
  };
  const options = {
    key: 'coalesced-generation',
    credentialsPath: f.auth,
    ttlMs: 60000,
    cache,
    fetchLimits: () => {
      entered();
      return response;
    },
  };
  const primary = getCachedUsageLimits(options);
  let selected;
  try {
    await started;
    const admit = codexLimitsAuthAdmission(f.auth, false);
    secondary = true;
    selected = getCachedUsageLimits({
      ...options,
      validateCredentials: async () => {
        if (atJoin && !replaced) {
          replaced = true;
          await fs.writeFile(`${f.auth}.next`, '{"tokens":{"access_token":"synthetic-next-generation"}}', { mode: 0o600 });
          await fs.rename(`${f.auth}.next`, f.auth);
        }
        return admit();
      },
    });
    await joined;
    release(responses.success);
    assert.deepEqual(await primary, responses.success);
    assertRefusal(await selected);
    assert.equal(replaced, true);
  } finally {
    release(responses.success);
    await Promise.allSettled([primary, selected]);
  }
});
