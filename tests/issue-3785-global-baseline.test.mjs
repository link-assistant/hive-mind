/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, stat, link, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parse as parseToml } from 'smol-toml';
import { runAgentConfigAudit } from '../src/agent-config-audit.lib.mjs';

async function fixture(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'hive-3785-baseline-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(path.join(home, '.codex'), { recursive: true });
  await mkdir(path.join(home, '.claude'), { recursive: true });
  await writeFile(path.join(home, '.codex/config.toml'), '[features]\nremote_plugin = false\nplugins = false\napps = false\n');
  return home;
}

for (const relative of ['.claude/CLAUDE.md', '.claude/rules/operator.md', '.codex/AGENTS.md', '.codex/AGENTS.override.md', '.codex/prompts/operator.md']) {
  test(`global instruction or command payload blocks admission: ${relative}`, async t => {
    const home = await fixture(t);
    const target = path.join(home, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, 'synthetic global instruction');
    await assert.rejects(runAgentConfigAudit({ homeDir: home, requireClean: true }), /configuration.*not clean/i);
    assert.equal(await readFile(target, 'utf8'), 'synthetic global instruction', 'instructions require explicit removal or quarantine');
  });
}

test('Claude inline hooks are repaired without changing provider, permissions or auth metadata', async t => {
  const home = await fixture(t);
  const target = path.join(home, '.claude/settings.json');
  const auth = path.join(home, '.claude/.credentials.json');
  const authBytes = '{"syntheticCredential":"preserve"}\n';
  await writeFile(auth, authBytes);
  const authIdentity = await stat(auth);
  const keep = { syncClaudeAiSkills: false, syncClaudeAiPlugins: false, disableClaudeAiConnectors: true, model: 'synthetic-model', permissions: { deny: ['Read(secret)'] }, env: { ANTHROPIC_BASE_URL: 'https://provider.invalid', CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' }, disableAllHooks: true };
  await writeFile(target, JSON.stringify({ ...keep, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: '/usr/bin/false' }] }] } }));
  await runAgentConfigAudit({ homeDir: home, requireClean: true });
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), keep);
  assert.equal(await readFile(auth, 'utf8'), authBytes);
  assert.equal((await stat(auth)).ino, authIdentity.ino);
});

test('Codex hook manifests block admission without executing or deleting payloads', async t => {
  const home = await fixture(t);
  const target = path.join(home, '.codex/hooks.json');
  const hooks = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: '/usr/bin/false' }] }] } });
  await writeFile(target, hooks);
  await assert.rejects(runAgentConfigAudit({ homeDir: home, requireClean: true }), /configuration.*not clean/i);
  assert.equal(await readFile(target, 'utf8'), hooks);
});

for (const declaration of ['notify = ["/usr/bin/false"]', 'developer_instructions = "synthetic global instruction"', 'model_instructions_file = "/synthetic/global-instructions.md"', 'hooks = { SessionStart = [{ hooks = [{ type = "command", command = "/usr/bin/false" }] }] }']) {
  test(`Codex inline global behavior is repaired: ${declaration.split('=')[0].trim()}`, async t => {
    const home = await fixture(t);
    const target = path.join(home, '.codex/config.toml');
    await writeFile(target, `${declaration}\nmodel = "synthetic-model"\n[features]\nremote_plugin = false\nplugins = false\napps = false\n`);
    await runAgentConfigAudit({ homeDir: home, requireClean: true });
    const actual = parseToml(await readFile(target, 'utf8'));
    assert.equal(actual[declaration.split('=')[0].trim()], undefined);
    assert.equal(actual.model, 'synthetic-model');
    assert.equal(actual.features.remote_plugin, false);
  });
}

test('Codex profiles cannot hide global registrations and hooks', async t => {
  const home = await fixture(t);
  const target = path.join(home, '.codex/config.toml');
  await writeFile(target, '[features]\nremote_plugin = false\nplugins = false\napps = false\n[profiles.alternate]\nmodel = "synthetic-model"\nnotify = ["/usr/bin/false"]\n[profiles.alternate.mcp_servers.rogue]\ncommand = "/usr/bin/false"\n[profiles.alternate.plugins.rogue]\nenabled = true\n[profiles.alternate.features]\nremote_plugin = true\n');
  await runAgentConfigAudit({ homeDir: home, requireClean: true });
  const actual = parseToml(await readFile(target, 'utf8')).profiles.alternate;
  assert.equal(actual.model, 'synthetic-model');
  assert.equal(actual.notify, undefined);
  assert.deepEqual(Object.keys(actual.plugins ?? {}), []);
  assert.deepEqual(Object.keys(actual.mcp_servers ?? {}), []);
  assert.equal(actual.features.remote_plugin, false);
});

test('Codex global agent declarations are removed while concurrency limits survive', async t => {
  const home = await fixture(t);
  const target = path.join(home, '.codex/config.toml');
  await writeFile(target, '[features]\nremote_plugin = false\nplugins = false\napps = false\n[agents]\nmax_threads = 2\n[agents.worker]\ndescription = "synthetic global role"\nconfig_file = "/synthetic/worker.toml"\n');
  await runAgentConfigAudit({ homeDir: home, requireClean: true });
  const actual = parseToml(await readFile(target, 'utf8')).agents;
  assert.equal(actual.max_threads, 2);
  assert.equal(actual.worker, undefined);
});

for (const relative of ['.claude/CLAUDE.md', '.claude/rules/operator.md', '.codex/AGENTS.md', '.codex/hooks.json']) {
  for (const kind of ['symlink', 'hardlink']) {
    test(`${kind} on ${relative} cannot redirect inspection or repair into credentials`, async t => {
      const home = await fixture(t);
      const auth = path.join(home, '.codex/auth.json');
      const authBytes = '{"syntheticCredential":"preserve"}\n';
      await writeFile(auth, authBytes);
      const authIdentity = await stat(auth);
      const target = path.join(home, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await (kind === 'symlink' ? symlink : link)(auth, target);
      await assert.rejects(runAgentConfigAudit({ homeDir: home, requireClean: true }), /unsafe/i);
      assert.equal(await readFile(auth, 'utf8'), authBytes);
      assert.equal((await stat(auth)).ino, authIdentity.ino);
    });
  }
}

test('malformed hook manifest prevents unrelated repairs and keeps diagnostics constant', async t => {
  const home = await fixture(t);
  const target = path.join(home, '.codex/hooks.json');
  const input = '{"private-hook-sentinel":';
  const config = path.join(home, '.codex/config.toml');
  const configBytes = 'notify = ["/usr/bin/false"]\n[features]\nremote_plugin = false\nplugins = false\napps = false\n';
  await writeFile(target, input);
  await writeFile(config, configBytes);
  await assert.rejects(runAgentConfigAudit({ homeDir: home, requireClean: true }), error => /unsafe/i.test(error.message) && !error.message.includes('sentinel'));
  assert.equal(await readFile(target, 'utf8'), input);
  assert.equal(await readFile(config, 'utf8'), configBytes);
});

test('clean profiles inherit disabled remote plugins without configuration rewrites', async t => {
  const home = await fixture(t);
  const target = path.join(home, '.codex/config.toml');
  const input = '# retain operator comment\n[features]\nremote_plugin = false\nplugins = false\napps = false\n[profiles.alternate]\nmodel = "synthetic-model"\n[profiles.alternate.mcp_servers.playwright]\ncommand = "npx"\nargs = ["-y", "@playwright/mcp@latest"]\n';
  await writeFile(target, input);
  await runAgentConfigAudit({ homeDir: home, requireClean: true });
  assert.equal(await readFile(target, 'utf8'), input);
});
