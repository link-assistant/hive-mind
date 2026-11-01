/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runAgentConfigAudit } from '../src/agent-config-audit.lib.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-global-dotenv-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'home');
  const conventional = path.join(homeDir, '.codex');
  const selected = path.join(root, 'selected');
  for (const directory of [conventional, selected]) {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'config.toml'), '[features]\nremote_plugin = false\nplugins = false\napps = false\n');
  }
  const audit = options => runAgentConfigAudit({ tool: 'codex', homeDir, env: { CODEX_HOME: selected }, systemRoots: { codex: path.join(root, 'managed'), claude: path.join(root, 'unused') }, requireClean: true, ...options });
  return { root, conventional, selected, audit };
}

for (const scope of ['conventional', 'selected']) {
  for (const autoRepair of [false, true]) {
    for (const content of ['', 'HOME=/synthetic/unaudited-home\nSYNTHETIC_AUTH=private-value-must-not-be-logged\n']) {
      test(`Codex ${scope} dotenv refuses admission with autoRepair=${autoRepair}, empty=${!content}`, async t => {
        const f = await fixture(t);
        const dotenv = path.join(f[scope], '.env');
        await fs.writeFile(dotenv, content, { mode: 0o600 });
        const protectedPaths = [dotenv, path.join(f.selected, 'auth.json'), path.join(f.selected, 'history.jsonl'), path.join(f.selected, 'config.toml')];
        await fs.writeFile(protectedPaths[1], 'synthetic auth\n');
        await fs.writeFile(protectedPaths[2], 'synthetic history\n');
        const before = await Promise.all(protectedPaths.map(async file => ({ bytes: await fs.readFile(file), info: await fs.stat(file) })));
        const logs = [];
        await assert.rejects(f.audit({ autoRepair, log: async message => logs.push(message) }), /not clean/iu);
        assert.ok(!logs.join('\n').includes('private-value-must-not-be-logged'));
        for (const [index, file] of protectedPaths.entries()) {
          const info = await fs.stat(file);
          assert.deepEqual(await fs.readFile(file), before[index].bytes);
          assert.equal(`${info.dev}:${info.ino}`, `${before[index].info.dev}:${before[index].info.ino}`);
        }
        const report = await f.audit({ autoRepair: false, requireClean: false });
        assert.ok(report.findings.some(finding => finding.name === '.env' && finding.repair === null));
      });
    }
  }
  for (const kind of ['symlink', 'hardlink', 'directory']) {
    test(`Codex ${scope} ${kind} dotenv is unsafe and preserved`, async t => {
      const f = await fixture(t);
      const target = path.join(f.root, 'protected-synthetic-auth');
      await fs.writeFile(target, 'synthetic protected data\n');
      const dotenv = path.join(f[scope], '.env');
      if (kind === 'symlink') await fs.symlink(target, dotenv);
      else if (kind === 'hardlink') await fs.link(target, dotenv);
      else await fs.mkdir(dotenv);
      const before = await fs.lstat(dotenv);
      await assert.rejects(f.audit({}), /unsafe/iu);
      assert.equal((await fs.lstat(dotenv)).ino, before.ino);
      assert.equal(await fs.readFile(target, 'utf8'), 'synthetic protected data\n');
    });
  }
  test(`Codex ${scope} dotenv introduced while logging prevents clean admission`, async t => {
    const f = await fixture(t);
    let wrote = false;
    await assert.rejects(
      f.audit({
        verbose: true,
        log: async () => {
          if (!wrote) {
            wrote = true;
            await fs.writeFile(path.join(f[scope], '.env'), 'HOME=/synthetic/changed-home\n');
          }
        },
      }),
      /not clean|unsafe/iu
    );
    assert.equal(wrote, true);
  });
}

test('Codex without dotenv remains admissible and explicit quarantine restores admission', async t => {
  const f = await fixture(t);
  await f.audit({ autoRepair: false });
  const dotenv = path.join(f.selected, '.env');
  await fs.writeFile(dotenv, 'HOME=/synthetic/alternate\n');
  await assert.rejects(f.audit({}), /not clean/iu);
  await fs.rename(dotenv, path.join(f.root, 'quarantined.env'));
  await f.audit({ autoRepair: false });
});
