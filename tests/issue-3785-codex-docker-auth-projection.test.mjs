// @hive-mind-test-suite default
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildDockerIsolationStartArgs, getDockerIsolationAuthMounts, prepareDockerIsolationHostPaths } from '../src/isolation-runner.lib.mjs';
import { readCanonicalCodexAuth, selectedCodexAuthHome } from '../src/codex-canonical-auth.lib.mjs';

const target = '/home/box/.hive-mind/canonical/codex-auth';
const marker = 'HIVE_MIND_CODEX_AUTH_IDENTITY';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-docker-auth-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'operator');
  const configurationHome = path.join(homeDir, '.codex');
  const canonical = path.join(root, 'canonical');
  await fs.mkdir(configurationHome, { recursive: true, mode: 0o700 });
  for (const name of ['sessions', 'archived_sessions', 'thread-writer-locks', 'rollout-migrations']) await fs.mkdir(path.join(configurationHome, name), { mode: 0o700 });
  await fs.mkdir(canonical, { mode: 0o700 });
  await fs.writeFile(path.join(canonical, 'auth.json'), '{"OPENAI_API_KEY":"sk-SYNTHETIC"}', { mode: 0o600 });
  const stat = await fs.stat(canonical, { bigint: true });
  const identity = `${stat.dev}:${stat.ino}`;
  return { root, canonical, configurationHome, identity, options: { tool: 'codex', homeDir, env: { CODEX_AUTH_HOME: canonical } } };
}

test('Docker projects a valid dedicated Codex authentication parent without a file snapshot', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const mounts = await getDockerIsolationAuthMounts(f.options);
  assert.ok(mounts.some(mount => mount.source === f.canonical && mount.target === target));
  assert.equal(
    mounts.some(mount => mount.target.endsWith('/.codex/auth.json')),
    false
  );
  assert.equal(
    mounts.some(mount => mount.source === f.configurationHome),
    false
  );
  assert.ok(mounts.some(mount => mount.target.endsWith('/.codex/sessions')));
  await assert.rejects(fs.lstat(path.join(f.configurationHome, 'auth.json')), { code: 'ENOENT' });
});

test('the production Docker builder propagates the mounted selector and admitted identity', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const prepared = await prepareDockerIsolationHostPaths(f.options);
  assert.equal(prepared.nativeAuthIdentity, f.identity);
  let resolved;
  const args = await buildDockerIsolationStartArgs('solve', [], {
    ...f.options,
    sessionId: 'synthetic-native-auth',
    nativeAuthIdentity: prepared.nativeAuthIdentity,
    resolveMountSources: async ({ mounts }) => {
      resolved = mounts;
      return mounts;
    },
  });
  assert.ok(args.includes(`CODEX_AUTH_HOME=${target}`));
  assert.ok(args.includes(`${marker}=${f.identity}`));
  assert.ok(resolved.some(mount => mount.source === f.canonical && mount.target === target));
  assert.equal(args.includes(`CODEX_AUTH_HOME=${f.canonical}`), false);
});

test('an equal-content replacement after preparation refuses before resolving mounts', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const prepared = await prepareDockerIsolationHostPaths(f.options);
  await fs.rename(f.canonical, `${f.canonical}-retired`);
  await fs.mkdir(f.canonical, { mode: 0o700 });
  await fs.copyFile(path.join(`${f.canonical}-retired`, 'auth.json'), path.join(f.canonical, 'auth.json'));
  let resolutions = 0;
  await assert.rejects(
    buildDockerIsolationStartArgs('solve', [], {
      ...f.options,
      sessionId: 'synthetic-native-auth',
      nativeAuthIdentity: prepared.nativeAuthIdentity,
      resolveMountSources: async () => resolutions++,
    }),
    /Selected native codex.*Docker/u
  );
  assert.equal(resolutions, 0);
});

test('canonical reads reject the wrong admitted directory even when credentials are identical', async t => {
  const f = await fixture(t);
  await assert.rejects(readCanonicalCodexAuth(f.canonical, { configurationHome: f.configurationHome, expectedIdentity: '0:0' }), /Canonical Codex authentication storage/u);
  const auth = await readCanonicalCodexAuth(f.canonical, { configurationHome: f.configurationHome, expectedIdentity: f.identity });
  assert.equal(auth.OPENAI_API_KEY, 'sk-SYNTHETIC');
});

test('a launch identity cannot survive dropping its selected authentication root', () => {
  assert.throws(() => selectedCodexAuthHome({ [marker]: '0:0' }), /Canonical Codex authentication storage/u);
});

for (const scenario of ['competing legacy credential', 'configuration overlap', 'parent configuration overlap', 'empty configuration selector', 'colon path', 'comma path']) {
  test(`Docker refuses ${scenario} before preparing host state`, { timeout: 10000 }, async t => {
    const f = await fixture(t);
    if (scenario === 'competing legacy credential') await fs.copyFile(path.join(f.canonical, 'auth.json'), path.join(f.configurationHome, 'auth.json'));
    if (scenario === 'configuration overlap') f.options.env.CODEX_HOME = f.canonical;
    if (scenario === 'parent configuration overlap') f.options.env.HIVE_MIND_PARENT_CODEX_HOME = f.canonical;
    if (scenario === 'empty configuration selector') f.options.env.CODEX_HOME = '';
    if (scenario === 'colon path' || scenario === 'comma path') {
      const renamed = `${f.canonical}${scenario === 'colon path' ? ':' : ','}unsafe`;
      await fs.rename(f.canonical, renamed);
      f.options.env.CODEX_AUTH_HOME = renamed;
    }
    let writes = 0;
    const fsImpl = {
      promises: {
        mkdir: async () => writes++,
        access: async () => {
          throw new Error('Unexpected legacy preparation');
        },
      },
    };
    await assert.rejects(prepareDockerIsolationHostPaths({ ...f.options, fsImpl }), /Selected native codex.*Docker/u);
    assert.equal(writes, 0);
    await assert.rejects(getDockerIsolationAuthMounts(f.options), /Selected native codex.*Docker/u);
  });
}

test('replacement during daemon mount resolution refuses before returning a launch command', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  await assert.rejects(
    buildDockerIsolationStartArgs('solve', [], {
      ...f.options,
      sessionId: 'synthetic-native-auth',
      resolveMountSources: async ({ mounts }) => {
        await fs.rename(f.canonical, `${f.canonical}-retired`);
        await fs.mkdir(f.canonical, { mode: 0o700 });
        await fs.copyFile(path.join(`${f.canonical}-retired`, 'auth.json'), path.join(f.canonical, 'auth.json'));
        return mounts;
      },
    }),
    /Selected native codex.*Docker/u
  );
});

test('dropping the selector after preparation cannot restore legacy mounting', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const prepared = await prepareDockerIsolationHostPaths(f.options);
  delete f.options.env.CODEX_AUTH_HOME;
  await assert.rejects(buildDockerIsolationStartArgs('solve', [], { ...f.options, nativeAuthIdentity: prepared.nativeAuthIdentity }), /Selected native codex.*Docker/u);
});
