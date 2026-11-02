// @hive-mind-test-suite default
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildDockerIsolationStartArgs, getDockerIsolationAuthMounts, prepareDockerIsolationHostPaths } from '../src/isolation-runner.lib.mjs';
import { getCachedClaudeLimits, getClaudeSubscriptionInfo, getClaudeUsageLimits, readCredentials, resetLimitCache, resolveLimitsCredentialPaths } from '../src/limits.lib.mjs';

const target = '/home/box/.hive-mind/canonical/claude-auth';
const marker = 'HIVE_MIND_CLAUDE_AUTH_IDENTITY';
const refusal = /Selected native claude.*Docker/u;

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-docker-auth-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'operator');
  const configurationHome = path.join(homeDir, '.claude');
  const canonical = path.join(root, 'canonical');
  await fs.mkdir(configurationHome, { recursive: true, mode: 0o700 });
  for (const name of ['projects', 'sessions']) await fs.mkdir(path.join(configurationHome, name), { mode: 0o700 });
  await fs.mkdir(canonical, { mode: 0o700 });
  const credentials = '{"claudeAiOauth":{"accessToken":"SYNTHETIC-SELECTED","subscriptionType":"max"}}';
  await fs.writeFile(path.join(canonical, '.credentials.json'), credentials, { mode: 0o600 });
  const info = await fs.stat(canonical, { bigint: true });
  return { root, configurationHome, canonical, credentials, identity: `${info.dev}:${info.ino}`, options: { tool: 'claude', homeDir, env: { CLAUDE_SECURESTORAGE_CONFIG_DIR: canonical } } };
}

async function replace(f) {
  await fs.rename(f.canonical, `${f.canonical}-retired`);
  await fs.mkdir(f.canonical, { mode: 0o700 });
  await fs.writeFile(path.join(f.canonical, '.credentials.json'), f.credentials, { mode: 0o600 });
}

function selectEnvironment(t, values) {
  for (const [name, value] of Object.entries(values)) {
    const before = process.env[name];
    t.after(() => {
      if (before === undefined) delete process.env[name];
      else process.env[name] = before;
    });
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test('Claude Docker mounting preserves a dedicated native credential parent', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const mounts = await getDockerIsolationAuthMounts(f.options);
  assert.ok(mounts.some(mount => mount.source === f.canonical && mount.target === target));
  assert.equal(
    mounts.some(mount => mount.target.endsWith('/.claude/.credentials.json')),
    false
  );
  assert.equal(
    mounts.some(mount => mount.source === f.configurationHome),
    false
  );
  assert.ok(mounts.some(mount => mount.target.endsWith('/.claude/projects')));
});

test('Claude preparation and launch retain the exact admitted authority', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const prepared = await prepareDockerIsolationHostPaths(f.options);
  assert.equal(prepared.nativeAuthIdentity, f.identity);
  const args = await buildDockerIsolationStartArgs('solve', [], { ...f.options, nativeAuthIdentity: prepared.nativeAuthIdentity, sessionId: 'synthetic-claude-auth' });
  assert.ok(args.includes(`CLAUDE_SECURESTORAGE_CONFIG_DIR=${target}`));
  assert.ok(args.includes(`${marker}=${f.identity}`));
});

for (const when of ['before resolution', 'during resolution']) {
  test(`Claude launch refuses an equal-content replaced parent ${when}`, { timeout: 10000 }, async t => {
    const f = await fixture(t);
    const prepared = await prepareDockerIsolationHostPaths(f.options);
    if (when === 'before resolution') await replace(f);
    let resolutions = 0;
    await assert.rejects(
      buildDockerIsolationStartArgs('solve', [], {
        ...f.options,
        nativeAuthIdentity: prepared.nativeAuthIdentity,
        sessionId: 'synthetic-claude-auth',
        resolveMountSources: async ({ mounts }) => {
          resolutions++;
          if (when === 'during resolution') await replace(f);
          return mounts;
        },
      }),
      refusal
    );
    assert.equal(resolutions, when === 'before resolution' ? 0 : 1);
  });
}

for (const scenario of ['empty selector', 'configuration overlap', 'competing credentials', 'public authority', 'linked authority', 'missing credentials']) {
  test(`Claude refuses ${scenario} before preparing legacy state`, { timeout: 10000 }, async t => {
    const f = await fixture(t);
    if (scenario === 'empty selector') f.options.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = '';
    if (scenario === 'configuration overlap') f.options.env.CLAUDE_CONFIG_DIR = f.canonical;
    if (scenario === 'competing credentials') await fs.writeFile(path.join(f.configurationHome, '.credentials.json'), f.credentials, { mode: 0o600 });
    if (scenario === 'public authority') await fs.chmod(f.canonical, 0o755);
    if (scenario === 'linked authority') {
      await fs.rename(f.canonical, `${f.canonical}-actual`);
      await fs.symlink(`${f.canonical}-actual`, f.canonical);
    }
    if (scenario === 'missing credentials') await fs.unlink(path.join(f.canonical, '.credentials.json'));
    let operations = 0;
    const io = new Proxy(
      {},
      {
        get: () => async () => {
          operations++;
          throw new Error('Unexpected legacy preparation.');
        },
      }
    );
    await assert.rejects(prepareDockerIsolationHostPaths({ ...f.options, fsImpl: { promises: io } }), refusal);
    assert.equal(operations, 0);
    await assert.rejects(getDockerIsolationAuthMounts(f.options), refusal);
  });
}

test('Claude limits refuses a different admitted directory before reading equal credentials', async t => {
  const f = await fixture(t);
  selectEnvironment(t, { CLAUDE_CONFIG_DIR: f.configurationHome, CLAUDE_SECURESTORAGE_CONFIG_DIR: f.canonical, [marker]: '0:0' });
  assert.equal(await readCredentials(path.join(f.canonical, '.credentials.json')), null);
});

test('dropping an admitted Claude credential selector cannot choose conventional credentials', async t => {
  const f = await fixture(t);
  selectEnvironment(t, { CLAUDE_SECURESTORAGE_CONFIG_DIR: undefined, [marker]: f.identity });
  assert.throws(() => resolveLimitsCredentialPaths(process.env, f.options.homeDir), /Canonical Claude authentication storage/u);
});

test('a cached Claude response refuses a changed launch identity without fetching', async t => {
  const f = await fixture(t);
  resetLimitCache();
  t.after(resetLimitCache);
  selectEnvironment(t, { CLAUDE_CONFIG_DIR: f.configurationHome, CLAUDE_SECURESTORAGE_CONFIG_DIR: f.canonical, [marker]: f.identity });
  const response = { success: true, usage: { marker: 'SYNTHETIC-CACHED' } };
  let requests = 0;
  const options = {
    fetchLimits: async () => {
      requests++;
      return response;
    },
  };
  assert.deepEqual(await getCachedClaudeLimits(false, options), response);
  process.env[marker] = '0:0';
  const result = await getCachedClaudeLimits(false, options);
  assert.equal(result.success, false);
  assert.equal(requests, 1);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC-CACHED/u);
});

for (const read of [getClaudeUsageLimits, getClaudeSubscriptionInfo]) {
  test(`${read.name} refuses a launch identity changed while its response is pending`, async t => {
    const f = await fixture(t);
    selectEnvironment(t, { CLAUDE_CONFIG_DIR: f.configurationHome, CLAUDE_SECURESTORAGE_CONFIG_DIR: f.canonical, [marker]: f.identity });
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      requests++;
      process.env[marker] = '0:0';
      return new globalThis.Response('{}');
    });
    const result = await read();
    assert.equal(requests, 1);
    assert.equal(result.success, false);
    assert.equal(result.failureKind, 'auth');
  });
}

test('dropping the selected Claude root after preparation refuses legacy mounting', async t => {
  const f = await fixture(t);
  const prepared = await prepareDockerIsolationHostPaths(f.options);
  delete f.options.env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
  await assert.rejects(buildDockerIsolationStartArgs('solve', [], { ...f.options, nativeAuthIdentity: prepared.nativeAuthIdentity }), refusal);
});

test('Router selection withholds all selected and conventional Claude state', async t => {
  const f = await fixture(t);
  const options = { ...f.options, useRouter: true };
  assert.deepEqual(await prepareDockerIsolationHostPaths(options), { created: [], missingAuth: [] });
  const mounts = await getDockerIsolationAuthMounts(options);
  assert.equal(
    mounts.some(mount => mount.source === f.canonical || mount.target.startsWith('/home/box/.claude')),
    false
  );
});
