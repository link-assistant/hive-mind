/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parse } from 'smol-toml';
import { runAgentConfigAudit } from '../src/agent-config-audit.lib.mjs';

// These keys are consumed by the pinned native ConfigToml, beyond the already
// covered developer_instructions and model_instructions_file registrations.
const promptKeys = ['instructions', 'compact_prompt', 'experimental_compact_prompt_file', 'experimental_realtime_ws_backend_prompt', 'experimental_realtime_ws_startup_context', 'experimental_realtime_start_instructions', 'model_catalog_json'];
const runtime = 'model = "synthetic-model"\napproval_policy = "never"\nsandbox_mode = "read-only"\n';
const baseline = '[features]\nremote_plugin = false\nplugins = false\napps = false\n';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-global-prompts-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'home');
  const conventional = path.join(homeDir, '.codex');
  const selected = path.join(root, 'selected');
  const systemRoots = { codex: path.join(root, 'managed'), claude: path.join(root, 'unused') };
  for (const directory of [conventional, selected, systemRoots.codex]) {
    await fs.mkdir(directory, { recursive: true });
    if (directory !== systemRoots.codex) await fs.writeFile(path.join(directory, 'config.toml'), baseline);
  }
  const audit = options => runAgentConfigAudit({ tool: 'codex', homeDir, systemRoots, env: { CODEX_HOME: selected }, requireClean: true, ...options });
  return { root, conventional, selected, systemRoots, audit };
}

for (const key of promptKeys) {
  for (const scope of ['conventional', 'selected', 'profile-file', 'inline-profile']) {
    test(`global Codex ${key} is refused in ${scope} with protected settings preserved`, async t => {
      const f = await fixture(t);
      const target = path.join(scope === 'conventional' ? f.conventional : f.selected, scope === 'profile-file' ? 'work.config.toml' : 'config.toml');
      const inline = scope === 'inline-profile';
      const bytes = `${runtime}${inline ? baseline + '[profiles.work]\n' : ''}${key} = "/synthetic/private-global-prompt"\n${inline ? '' : baseline}`;
      await fs.writeFile(target, bytes);
      const protectedPaths = [path.join(f.selected, 'auth.json'), path.join(f.selected, 'history.jsonl'), path.join(f.root, 'prompt-source')];
      for (const file of protectedPaths) await fs.writeFile(file, 'synthetic untouched data\n');
      const before = await Promise.all(protectedPaths.map(file => fs.stat(file)));
      await assert.rejects(f.audit({ autoRepair: false }), error => /not clean/iu.test(error.message) && !error.message.includes('private-global-prompt'));
      assert.equal(await fs.readFile(target, 'utf8'), bytes);
      if (key === 'model_catalog_json') {
        await assert.rejects(f.audit({}), /not clean/iu);
        assert.equal(await fs.readFile(target, 'utf8'), bytes);
        const result = await f.audit({ requireClean: false, autoRepair: false });
        assert.ok(result.findings.some(finding => finding.name === key && finding.repair === null));
      } else {
        const result = await f.audit({});
        assert.ok(result.repaired.some(finding => finding.name === key && finding.kind === 'global-instructions'));
      }
      const parsed = parse(await fs.readFile(target, 'utf8'));
      assert.equal((inline ? parsed.profiles.work : parsed)[key], key === 'model_catalog_json' ? '/synthetic/private-global-prompt' : undefined);
      assert.equal(parsed.model, 'synthetic-model');
      assert.equal(parsed.approval_policy, 'never');
      assert.equal(parsed.sandbox_mode, 'read-only');
      for (const [index, file] of protectedPaths.entries()) {
        const after = await fs.stat(file);
        assert.equal(`${after.dev}:${after.ino}`, `${before[index].dev}:${before[index].ino}`);
        assert.equal(await fs.readFile(file, 'utf8'), 'synthetic untouched data\n');
      }
    });
  }
  for (const filename of ['config.toml', 'managed_config.toml']) {
    for (const inline of [false, true]) {
      test(`managed Codex ${filename} ${inline ? 'profile ' : ''}${key} refuses admission without changing policy`, async t => {
        const f = await fixture(t);
        const target = path.join(f.systemRoots.codex, filename);
        const bytes = `${runtime}${inline ? '[profiles.work]\n' : ''}${key} = "/synthetic/private-global-prompt"\n`;
        await fs.writeFile(target, bytes);
        const before = await fs.stat(target);
        await assert.rejects(f.audit({}), error => /managed.*not clean/iu.test(error.message) && !error.message.includes('private-global-prompt'));
        assert.equal(await fs.readFile(target, 'utf8'), bytes);
        assert.equal((await fs.stat(target)).ino, before.ino);
      });
    }
  }
}
