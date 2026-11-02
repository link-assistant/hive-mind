#!/usr/bin/env node
// Reproduce selected storage projection through the real Docker builders.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import process from 'node:process';
import { URL, pathToFileURL } from 'node:url';
const implementation = process.env.GEMINI_DOCKER_PROBE_MODULE ? pathToFileURL(path.resolve(process.env.GEMINI_DOCKER_PROBE_MODULE)) : new URL('../../src/isolation-runner.lib.mjs', import.meta.url);
const { buildDockerIsolationStartArgs, getDockerIsolationAuthMounts, prepareDockerIsolationHostPaths } = await import(implementation);

const targets = { auth: '/home/box/.hive-mind/canonical/gemini-auth', history: '/home/box/.hive-mind/canonical/gemini-history' };
const selectors = { auth: 'GEMINI_AUTH_HOME', history: 'GEMINI_HISTORY_HOME' };
const markers = { auth: 'HIVE_MIND_GEMINI_AUTH_IDENTITY', history: 'HIVE_MIND_GEMINI_HISTORY_IDENTITY' };
const refused = /Selected native gemini.*Docker/u;
const credentials = '{"access_token":"synthetic-projection-access","refresh_token":"synthetic-projection-refresh","token_type":"Bearer","expiry_date":4102444800000}';
async function identity(directory) {
  const info = await fs.stat(directory, { bigint: true });
  return `${info.dev}:${info.ino}`;
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-docker-projection-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'private');
  const configuration = path.join(homeDir, '.gemini');
  const auth = path.join(root, 'auth');
  const history = path.join(root, 'history');
  await fs.mkdir(configuration, { recursive: true, mode: 0o700 });
  for (const directory of [auth, history]) await fs.mkdir(directory, { mode: 0o700 });
  await fs.writeFile(path.join(auth, 'oauth_creds.json'), credentials, { mode: 0o600 });
  return { root, homeDir, configuration, auth, history, options: { tool: 'gemini', homeDir, env: { HOME: homeDir, GEMINI_CLI_HOME: homeDir, GEMINI_AUTH_HOME: auth, GEMINI_HISTORY_HOME: history } } };
}
async function replace(f, kind) {
  await fs.rename(f[kind], `${f[kind]}-retired`);
  await fs.mkdir(f[kind], { mode: 0o700 });
  if (kind === 'auth') await fs.writeFile(path.join(f.auth, 'oauth_creds.json'), credentials, { mode: 0o600 });
}

for (const kinds of [['auth', 'history'], ['auth'], ['history']]) {
  test(`Gemini projects independent ${kinds.join('/')} parents and forwards identities`, { timeout: 10000 }, async t => {
    const f = await fixture(t);
    for (const kind of ['auth', 'history']) if (!kinds.includes(kind)) delete f.options.env[selectors[kind]];
    const prepared = await prepareDockerIsolationHostPaths(f.options);
    assert.deepEqual(prepared.created, []);
    assert.deepEqual(prepared.missingAuth, []);
    const mounts = await getDockerIsolationAuthMounts({ ...f.options, nativeAuthIdentity: prepared.nativeAuthIdentity });
    const args = await buildDockerIsolationStartArgs('solve', [], { ...f.options, nativeAuthIdentity: prepared.nativeAuthIdentity, sessionId: 'synthetic-gemini-projection' });
    for (const kind of kinds) {
      assert.ok(mounts.some(mount => mount.source === f[kind] && mount.target === targets[kind]));
      assert.ok(args.includes(`${selectors[kind]}=${targets[kind]}`));
      assert.ok(args.includes(`${markers[kind]}=${await identity(f[kind])}`));
    }
    assert.equal(
      mounts.some(mount => mount.source === f.configuration || mount.source.endsWith('/oauth_creds.json')),
      false
    );
  });
}

for (const kind of ['auth', 'history']) {
  for (const when of ['before resolution', 'during resolution']) {
    test(`Gemini refuses replaced ${kind} ${when}`, { timeout: 10000 }, async t => {
      const f = await fixture(t);
      const prepared = await prepareDockerIsolationHostPaths(f.options);
      if (when === 'before resolution') await replace(f, kind);
      let resolutions = 0;
      await assert.rejects(
        buildDockerIsolationStartArgs('solve', [], {
          ...f.options,
          nativeAuthIdentity: prepared.nativeAuthIdentity,
          sessionId: 'synthetic-gemini-projection',
          resolveMountSources: async ({ mounts }) => {
            resolutions++;
            if (when === 'during resolution') await replace(f, kind);
            return mounts;
          },
        }),
        refused
      );
      assert.equal(resolutions, when === 'before resolution' ? 0 : 1);
    });
  }
  for (const change of ['selector removal', 'marker mismatch']) {
    test(`Gemini retains admitted ${kind} after ${change}`, { timeout: 10000 }, async t => {
      const f = await fixture(t);
      const prepared = await prepareDockerIsolationHostPaths(f.options);
      if (change === 'selector removal') delete f.options.env[selectors[kind]];
      else f.options.env[markers[kind]] = '0:0';
      await assert.rejects(buildDockerIsolationStartArgs('solve', [], { ...f.options, nativeAuthIdentity: prepared.nativeAuthIdentity }), refused);
    });
  }
}

for (const scenario of ['empty auth', 'empty history', 'missing credentials', 'invalid credentials', 'private credentials', 'private accounts', 'overlapping roots', 'configuration overlap', 'symlinked auth', 'public history', 'wrong auth marker', 'wrong history marker', 'marker only', 'alternate authority', 'empty configuration', 'symlinked configuration', 'Docker path separator']) {
  test(`Gemini refuses ${scenario} before legacy preparation`, { timeout: 10000 }, async t => {
    const f = await fixture(t);
    const env = f.options.env;
    if (scenario === 'empty auth') env.GEMINI_AUTH_HOME = '';
    if (scenario === 'empty history') env.GEMINI_HISTORY_HOME = '';
    if (scenario === 'missing credentials') await fs.unlink(path.join(f.auth, 'oauth_creds.json'));
    if (scenario === 'invalid credentials') await fs.writeFile(path.join(f.auth, 'oauth_creds.json'), '{}');
    if (scenario === 'private credentials') await fs.writeFile(path.join(f.configuration, 'oauth_creds.json'), credentials, { mode: 0o600 });
    if (scenario === 'private accounts') await fs.writeFile(path.join(f.configuration, 'google_accounts.json'), '{}', { mode: 0o600 });
    if (scenario === 'overlapping roots') env.GEMINI_HISTORY_HOME = f.auth;
    if (scenario === 'configuration overlap') env.GEMINI_CLI_HOME = f.root;
    if (scenario === 'configuration overlap') {
      await fs.rename(f.auth, path.join(f.root, '.gemini'));
      env.GEMINI_AUTH_HOME = path.join(f.root, '.gemini');
    }
    if (scenario === 'symlinked auth') {
      await fs.rename(f.auth, `${f.auth}-actual`);
      await fs.symlink(`${f.auth}-actual`, f.auth);
    }
    if (scenario === 'public history') await fs.chmod(f.history, 0o755);
    if (scenario === 'wrong auth marker') env.HIVE_MIND_GEMINI_AUTH_IDENTITY = '0:0';
    if (scenario === 'wrong history marker') env.HIVE_MIND_GEMINI_HISTORY_IDENTITY = '0:0';
    if (scenario === 'marker only') {
      delete env.GEMINI_AUTH_HOME;
      env.HIVE_MIND_GEMINI_AUTH_IDENTITY = await identity(f.auth);
    }
    if (scenario === 'alternate authority') env.GOOGLE_APPLICATION_CREDENTIALS = '/synthetic/competing-authority';
    if (scenario === 'empty configuration') env.GEMINI_CLI_HOME = '';
    if (scenario === 'symlinked configuration') {
      await fs.rmdir(f.configuration);
      await fs.symlink(f.history, f.configuration);
    }
    if (scenario === 'Docker path separator') {
      const source = `${f.history},ambiguous`;
      await fs.rename(f.history, source);
      env.GEMINI_HISTORY_HOME = source;
    }
    let writes = 0;
    const io = new Proxy(
      {},
      {
        get: () => async () => {
          writes++;
          throw new Error('Unexpected legacy preparation.');
        },
      }
    );
    await assert.rejects(prepareDockerIsolationHostPaths({ ...f.options, fsImpl: { promises: io } }), refused);
    assert.equal(writes, 0);
    await assert.rejects(getDockerIsolationAuthMounts(f.options), refused);
  });
}

test('Gemini Router suppression does not inspect vendor storage', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const options = { ...f.options, env: { GEMINI_AUTH_HOME: '', GEMINI_HISTORY_HOME: '', HIVE_MIND_GEMINI_AUTH_IDENTITY: '0:0' }, useRouter: true };
  assert.deepEqual(await prepareDockerIsolationHostPaths(options), { created: [], missingAuth: [] });
  const mounts = await getDockerIsolationAuthMounts(options);
  assert.equal(
    mounts.some(mount => Object.values(targets).includes(mount.target)),
    false
  );
});

test('ordinary unselected Gemini keeps independent task state', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const options = { ...f.options, env: {} };
  assert.deepEqual(await prepareDockerIsolationHostPaths(options), { created: [], missingAuth: [] });
  const mounts = await getDockerIsolationAuthMounts(options);
  assert.equal(
    mounts.some(mount => Object.values(targets).includes(mount.target)),
    false
  );
});
