/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parse } from 'smol-toml';
import { runAgentConfigAudit } from '../src/agent-config-audit.lib.mjs';
import { codexProfileConfigPaths } from '../src/agent-config-audit-paths.lib.mjs';

async function fixture(t, selected = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-native-profile-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'home');
  const conventional = path.join(homeDir, '.codex');
  const configDir = selected ? path.join(root, 'selected') : conventional;
  for (const directory of new Set([conventional, configDir])) {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'config.toml'), '[features]\nremote_plugin = false\n');
  }
  const systemRoots = { claude: path.join(root, 'system-claude'), codex: path.join(root, 'system-codex') };
  const profile = path.join(configDir, 'work.config.toml');
  const audit = options => runAgentConfigAudit({ tool: 'codex', homeDir, env: selected ? { CODEX_HOME: configDir } : {}, systemRoots, requireClean: true, ...options });
  return { root, configDir, profile, audit };
}

for (const [name, config] of [
  ['plugin', '[plugins."unrequested@fixture"]\nenabled = true'],
  ['MCP', '[mcp_servers.unapproved]\ncommand = "/bin/false"'],
  ['instructions', 'developer_instructions = "synthetic unrequested instruction"'],
  ['notify', 'notify = ["/bin/false"]'],
  ['hooks', '[hooks]\nSessionStart = []'],
  ['agent', '[agents.unapproved]\ndescription = "synthetic role"'],
  ['remote sync', '[features]\nremote_plugin = true'],
]) {
  test(`native Codex profile ${name} cannot bypass a clean base config`, async t => {
    const f = await fixture(t);
    await fs.writeFile(f.profile, config);
    await assert.rejects(f.audit({ autoRepair: false }), /not clean/iu);
    assert.equal(await fs.readFile(f.profile, 'utf8'), config);
  });
}

test('native profile repair preserves runtime settings and canonical auth/history identities', async t => {
  const f = await fixture(t, true);
  const auth = path.join(f.configDir, 'auth.json');
  const history = path.join(f.configDir, 'sessions');
  await fs.writeFile(auth, '{"synthetic":"protected"}');
  await fs.mkdir(history);
  const before = await Promise.all([fs.stat(auth), fs.stat(history)]);
  await fs.writeFile(f.profile, 'model = "synthetic-model"\nlarge = 9223372036854775807\n[mcp_servers.unapproved]\ncommand = "/bin/false"\n[features]\nremote_plugin = true\nmulti_agent = true\n');
  await f.audit({});
  const config = parse(await fs.readFile(f.profile, 'utf8'), { integersAsBigInt: 'asNeeded' });
  assert.equal(config.model, 'synthetic-model');
  assert.equal(config.large, 9223372036854775807n);
  assert.equal(config.mcp_servers?.unapproved, undefined);
  assert.deepEqual({ ...config.features }, { remote_plugin: false, multi_agent: true });
  const after = await Promise.all([fs.stat(auth), fs.stat(history)]);
  assert.deepEqual(
    after.map(info => `${info.dev}:${info.ino}`),
    before.map(info => `${info.dev}:${info.ino}`)
  );
  assert.equal(await fs.readFile(auth, 'utf8'), '{"synthetic":"protected"}');
});

for (const kind of ['malformed', 'symlink', 'hardlink', 'directory', 'oversized']) {
  test(`unsafe native profile ${kind} refuses every repair before any mutation`, async t => {
    const f = await fixture(t);
    const base = path.join(f.configDir, 'config.toml');
    const before = 'notify = ["/bin/false"]\n[features]\nremote_plugin = false\n';
    await fs.writeFile(base, before);
    if (kind === 'directory') await fs.mkdir(f.profile);
    else if (kind === 'symlink' || kind === 'hardlink') {
      const protectedFile = path.join(f.root, 'protected');
      await fs.writeFile(protectedFile, 'model = "synthetic-protected"\n');
      if (kind === 'symlink') await fs.symlink(protectedFile, f.profile);
      else await fs.link(protectedFile, f.profile);
    } else await fs.writeFile(f.profile, kind === 'malformed' ? 'model = "synthetic-private-value"\ninvalid = [\n' : `#${'x'.repeat(1024 * 1024)}\n`);
    await assert.rejects(f.audit({}), error => /unsafe/iu.test(error.message) && !error.message.includes('synthetic-private'));
    assert.equal(await fs.readFile(base, 'utf8'), before);
  });
}

test('a concurrent native profile edit invalidates the pending base repair', async t => {
  const f = await fixture(t);
  const base = path.join(f.configDir, 'config.toml');
  const bytes = 'notify = ["/bin/false"]\n[features]\nremote_plugin = false\n';
  await fs.writeFile(base, bytes);
  await fs.writeFile(f.profile, 'model = "synthetic-original"\n[features]\nremote_plugin = false\n');
  let changed = false;
  await assert.rejects(
    f.audit({
      log: async () => {
        if (!changed) {
          changed = true;
          await fs.writeFile(f.profile, 'model = "synthetic-concurrent"\n[features]\nremote_plugin = false\n');
        }
      },
    }),
    /unsafe/iu
  );
  assert.equal(await fs.readFile(base, 'utf8'), bytes);
});

test('adding a native profile during logging invalidates the pending base repair', async t => {
  const f = await fixture(t);
  const base = path.join(f.configDir, 'config.toml');
  const bytes = 'notify = ["/bin/false"]\n[features]\nremote_plugin = false\n';
  await fs.writeFile(base, bytes);
  let added = false;
  await assert.rejects(
    f.audit({
      log: async () => {
        if (!added) {
          added = true;
          await fs.writeFile(f.profile, '[mcp_servers.unapproved]\ncommand = "/bin/false"\n');
        }
      },
    }),
    /unsafe/iu
  );
  assert.equal(await fs.readFile(base, 'utf8'), bytes);
});

test('native profile enumeration stops at its finite directory-entry limit', () => {
  let reads = 0;
  let closed = false;
  assert.throws(
    () =>
      codexProfileConfigPaths({
        configDir: '/synthetic',
        fsImpl: {
          opendirSync: () => ({
            readSync: () => ({ name: `entry-${++reads}` }),
            closeSync: () => {
              closed = true;
            },
          }),
        },
      }),
    /unsafe/iu
  );
  assert.equal(reads, 10_001);
  assert.equal(closed, true);
});
