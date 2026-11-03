/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildDockerIsolationStartArgs, getDockerIsolationAuthMounts, prepareDockerIsolationHostPaths } from '../src/isolation-runner.lib.mjs';
import { assertSharedToolData, SHARED_TOOL_DATA_ENV } from '../src/tool-data-mounts.lib.mjs';

const containerData = '/home/box/.local/share';
const apps = { agent: 'link-assistant-agent', opencode: 'opencode' };

for (const [tool, app] of Object.entries(apps)) {
  test(`${tool} shares its data directory, including atomic auth replacements and history sidecars`, async () => {
    const mounts = await getDockerIsolationAuthMounts({ tool, env: {}, homeDir: '/synthetic/operator', existsSync: () => true });
    assert.deepEqual(
      mounts.filter(mount => mount.target.startsWith(containerData)),
      [{ source: `/synthetic/operator/.local/share/${app}`, target: `${containerData}/${app}` }]
    );
    assert.equal(
      mounts.some(mount => mount.source.endsWith('/auth.json')),
      false
    );
    assert.equal(
      mounts.some(mount => mount.source.endsWith(`/config/${app}`)),
      false
    );
  });

  test(`${tool} uses the selected host XDG data root without exporting the host path`, async () => {
    const args = await buildDockerIsolationStartArgs('solve', [], { tool, sessionId: 'synthetic', env: { XDG_DATA_HOME: '/synthetic/alternate' }, homeDir: '/synthetic/operator', existsSync: () => true });
    assert.ok(args.includes(`/synthetic/alternate/${app}:${containerData}/${app}`));
    assert.ok(args.includes(`XDG_DATA_HOME=${containerData}`));
    assert.equal(args.includes('XDG_DATA_HOME=/synthetic/alternate'), false);
  });

  test(`${tool} rejects unavailable data rather than launching with a private fallback`, async () => {
    await assert.rejects(getDockerIsolationAuthMounts({ tool, env: {}, homeDir: '/synthetic/operator', existsSync: () => false }), /shared.*data/iu);
  });

  test(`${tool} creates a fresh data authority and never fabricates credentials`, async t => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-xdg-data-'));
    t.after(() => fs.rm(home, { recursive: true, force: true }));
    const data = path.join(home, 'selected-data');
    const result = await prepareDockerIsolationHostPaths({ tool, homeDir: home, env: { XDG_DATA_HOME: data } });
    assert.deepEqual(result.created, [path.join(data, app)]);
    assert.ok((await fs.stat(path.join(data, app))).isDirectory());
    await assert.rejects(fs.access(path.join(data, app, 'auth.json')), { code: 'ENOENT' });
  });

  test(`${tool} Router selection withholds vendor data and does not prepare it`, async () => {
    const mounts = await getDockerIsolationAuthMounts({ tool, env: { XDG_DATA_HOME: '/synthetic/vendor' }, homeDir: '/synthetic/operator', existsSync: () => true, useRouter: true });
    assert.equal(
      mounts.some(mount => mount.source.startsWith('/synthetic/vendor')),
      false
    );
    assert.deepEqual(await prepareDockerIsolationHostPaths({ tool, env: { XDG_DATA_HOME: '/synthetic/vendor' }, useRouter: true }), { created: [], missingAuth: [] });
  });
}

test('agent keeps its downloaded executable cache private inside the shared data mount', async () => {
  const args = await buildDockerIsolationStartArgs('solve', [], { tool: 'agent', sessionId: 'synthetic', env: {}, homeDir: '/synthetic/operator', existsSync: () => true });
  const masks = args.filter((arg, index) => args[index - 1] === '--mount');
  assert.deepEqual(masks, [`type=tmpfs,destination=${containerData}/link-assistant-agent/bin,tmpfs-mode=1777,tmpfs-size=134217728`]);
});

test('invalid explicit XDG roots cannot silently fall back to conventional storage', async () => {
  for (const XDG_DATA_HOME of ['relative/data', '/bad\npath', '/bad,path']) {
    await assert.rejects(getDockerIsolationAuthMounts({ tool: 'agent', homeDir: '/synthetic/operator', env: { XDG_DATA_HOME }, existsSync: () => true }), /shared.*data/iu);
  }
});

test('an unsafe selected data directory fails preparation', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-xdg-link-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const data = path.join(home, 'data');
  await fs.mkdir(data);
  await fs.symlink(home, path.join(data, 'link-assistant-agent'));
  await assert.rejects(prepareDockerIsolationHostPaths({ tool: 'agent', homeDir: home, env: { XDG_DATA_HOME: data } }), /shared.*data/iu);
});

for (const [tool, app] of Object.entries(apps)) {
  test(`${tool} refuses equal-content private copies and changed directory identities`, async t => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-xdg-identity-'));
    t.after(() => fs.rm(home, { recursive: true, force: true }));
    const XDG_DATA_HOME = path.join(home, 'data');
    const prepared = await prepareDockerIsolationHostPaths({ tool, homeDir: home, env: { XDG_DATA_HOME } });
    const target = path.join(XDG_DATA_HOME, app);
    await fs.writeFile(path.join(target, 'auth.json'), '{"synthetic":"generation-0"}');
    const env = { XDG_DATA_HOME, [SHARED_TOOL_DATA_ENV]: JSON.stringify({ schema: 1, tool, target, identity: prepared.identity }) };
    await assertSharedToolData({ tool, env, homeDir: home });
    const alternate = path.join(home, 'private');
    await fs.cp(XDG_DATA_HOME, alternate, { recursive: true });
    await assert.rejects(assertSharedToolData({ tool, env: { ...env, XDG_DATA_HOME: alternate }, homeDir: home }), /shared.*data/iu);
    await fs.rename(target, `${target}-old`);
    await fs.cp(`${target}-old`, target, { recursive: true });
    await assert.rejects(assertSharedToolData({ tool, env, homeDir: home }), /shared.*data/iu);
  });

  test(`${tool} refuses configuration redirected into shared native data`, async t => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-xdg-config-'));
    t.after(() => fs.rm(home, { recursive: true, force: true }));
    const XDG_DATA_HOME = path.join(home, 'data');
    const prepared = await prepareDockerIsolationHostPaths({ tool, homeDir: home, env: { XDG_DATA_HOME } });
    const target = path.join(XDG_DATA_HOME, app);
    const env = { XDG_DATA_HOME, [SHARED_TOOL_DATA_ENV]: JSON.stringify({ schema: 1, tool, target, identity: prepared.identity }) };
    const prefix = tool === 'agent' ? 'LINK_ASSISTANT_AGENT' : 'OPENCODE';
    await assert.rejects(assertSharedToolData({ tool, env: { ...env, [`${prefix}_CONFIG_DIR`]: target }, homeDir: home }), /shared.*data/iu);
    await fs.symlink(target, path.join(home, 'redirect'));
    await assert.rejects(assertSharedToolData({ tool, env: { ...env, [`${prefix}_CONFIG_DIR`]: path.join(home, 'redirect') }, homeDir: home }), /shared.*data/iu);
    if (tool === 'opencode') {
      for (const override of [{ OPENCODE_AUTH_CONTENT: '{"synthetic":{}}' }, { OPENCODE_DB: ':memory:' }, { OPENCODE_DB: path.join(home, 'private.db') }]) {
        await assert.rejects(assertSharedToolData({ tool, env: { ...env, ...override }, homeDir: home }), /shared.*data/iu);
      }
    }
  });

  test(`${tool} refuses private cache/state roots overlapping the shared data authority`, async t => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-xdg-overlap-'));
    t.after(() => fs.rm(home, { recursive: true, force: true }));
    const XDG_DATA_HOME = path.join(home, 'data');
    const prepared = await prepareDockerIsolationHostPaths({ tool, homeDir: home, env: { XDG_DATA_HOME } });
    const target = path.join(XDG_DATA_HOME, app);
    const env = { XDG_DATA_HOME, [SHARED_TOOL_DATA_ENV]: JSON.stringify({ schema: 1, tool, target, identity: prepared.identity }) };
    for (const key of ['XDG_CACHE_HOME', 'XDG_STATE_HOME']) {
      for (const root of [XDG_DATA_HOME, path.join(target, 'private'), 'relative']) {
        await assert.rejects(assertSharedToolData({ tool, env: { ...env, [key]: root }, homeDir: home }), /shared.*data/iu);
      }
    }
  });

  test(`${tool} refuses a private configuration file symlink into canonical data`, async t => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-xdg-config-file-'));
    t.after(() => fs.rm(home, { recursive: true, force: true }));
    const XDG_DATA_HOME = path.join(home, 'data');
    const prepared = await prepareDockerIsolationHostPaths({ tool, homeDir: home, env: { XDG_DATA_HOME } });
    const target = path.join(XDG_DATA_HOME, app);
    const config = path.join(home, 'private-config.json');
    await fs.writeFile(path.join(target, 'auth.json'), '{}');
    await fs.symlink(path.join(target, 'auth.json'), config);
    const prefix = tool === 'agent' ? 'LINK_ASSISTANT_AGENT' : 'OPENCODE';
    const env = { XDG_DATA_HOME, [`${prefix}_CONFIG`]: config, [SHARED_TOOL_DATA_ENV]: JSON.stringify({ schema: 1, tool, target, identity: prepared.identity }) };
    await assert.rejects(assertSharedToolData({ tool, env, homeDir: home }), /shared.*data/iu);
    await fs.unlink(config);
    await fs.writeFile(config, '{}');
    await assertSharedToolData({ tool, env, homeDir: home });
    await fs.unlink(config);
    await fs.link(path.join(target, 'auth.json'), config);
    await assert.rejects(assertSharedToolData({ tool, env, homeDir: home }), /shared.*data/iu);
  });
}
