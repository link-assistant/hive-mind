/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildDockerIsolationStartArgs, getDockerIsolationAuthMounts, prepareDockerIsolationHostPaths } from '../src/isolation-runner.lib.mjs';

const selectors = {
  codex: ['CODEX_AUTH_HOME', 'CODEX_SQLITE_HOME', 'CODEX_ROLLOUT_HOME', 'CODEX_SESSION_INDEX_HOME', 'CODEX_MESSAGE_HISTORY_HOME', 'CODEX_ROLLOUT_MAINTENANCE_HOME'],
  gemini: ['GEMINI_AUTH_HOME', 'GEMINI_HISTORY_HOME'],
  qwen: ['QWEN_AUTH_HOME'],
};
const homeDir = '/synthetic/operator';
const refusal = /selected native .* storage.*Docker/iu;

for (const [tool, names] of Object.entries(selectors)) {
  for (const name of names) {
    for (const value of ['/synthetic/canonical-authority', '']) {
      test(`${tool} Docker launch refuses a dropped ${name}${value ? '' : ' (empty)'} selector`, { timeout: 5000 }, async () => {
        const options = { tool, homeDir, env: { [name]: value }, existsSync: () => true };
        await assert.rejects(getDockerIsolationAuthMounts(options), refusal);
        await assert.rejects(buildDockerIsolationStartArgs('solve', [], { ...options, sessionId: 'synthetic-selected-storage' }), refusal);
        let operations = 0;
        const io = new Proxy(
          {},
          {
            get: () => async () => {
              operations++;
              throw new Error('Unexpected host preparation before selector admission.');
            },
          }
        );
        await assert.rejects(prepareDockerIsolationHostPaths({ ...options, fsImpl: { promises: io } }), refusal);
        assert.equal(operations, 0, 'Do not prepare a competing legacy authority.');
      });
    }
  }
}

test('an actual selected Codex authority cannot launch with an older conventional credential file', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-docker-selected-storage-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const home = path.join(directory, 'operator');
  const canonical = path.join(directory, 'canonical-auth');
  await fs.mkdir(path.join(home, '.codex'), { recursive: true, mode: 0o700 });
  await fs.mkdir(canonical, { mode: 0o700 });
  await fs.writeFile(path.join(home, '.codex/auth.json'), '{"generation":"synthetic-predecessor"}', { mode: 0o600 });
  await fs.writeFile(path.join(canonical, 'auth.json'), '{"generation":"synthetic-current"}', { mode: 0o600 });
  await prepareDockerIsolationHostPaths({ tool: 'codex', homeDir: home, env: {} });
  const options = { tool: 'codex', homeDir: home, env: { CODEX_AUTH_HOME: canonical } };
  await assert.rejects(getDockerIsolationAuthMounts(options), refusal);
  assert.equal(JSON.parse(await fs.readFile(path.join(canonical, 'auth.json'))).generation, 'synthetic-current');
  assert.equal(JSON.parse(await fs.readFile(path.join(home, '.codex/auth.json'))).generation, 'synthetic-predecessor');
});

test('Router explicitly selects its own authority without touching selected vendor stores', async () => {
  for (const [tool, names] of Object.entries(selectors)) {
    const options = { tool, homeDir, env: Object.fromEntries(names.map(name => [name, '/synthetic/vendor'])), useRouter: true, existsSync: () => true };
    assert.deepEqual(await prepareDockerIsolationHostPaths(options), { created: [], missingAuth: [] });
    const mounts = await getDockerIsolationAuthMounts(options);
    assert.equal(
      mounts.some(mount => mount.source.startsWith('/synthetic/vendor') || mount.target.startsWith(`/home/box/.${tool}`)),
      false
    );
  }
});

test('an unrelated tool selector does not change another tool or Router selection', async () => {
  const mounts = await getDockerIsolationAuthMounts({ tool: 'claude', homeDir, env: { CODEX_AUTH_HOME: '/synthetic/codex-authority' }, existsSync: () => true });
  assert.ok(mounts.some(mount => mount.source === `${homeDir}/.claude/.credentials.json`));
  assert.equal(
    mounts.some(mount => mount.source.includes('codex')),
    false
  );
});

test('ordinary unselected Codex mounting retains the existing credential and history paths', async () => {
  const mounts = await getDockerIsolationAuthMounts({ tool: 'codex', homeDir, env: {}, existsSync: () => true });
  assert.ok(mounts.some(mount => mount.source === `${homeDir}/.codex/auth.json`));
  assert.ok(mounts.some(mount => mount.source === `${homeDir}/.codex/sessions`));
});
