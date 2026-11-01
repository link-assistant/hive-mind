/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAgentConfigAudit } from '../src/agent-config-audit.lib.mjs';
import { verifyAgentRuntime } from '../src/verify-agent-runtime.mjs';

const claudeBaseline = { syncClaudeAiSkills: false, syncClaudeAiPlugins: false, disableClaudeAiConnectors: true, env: { CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } };

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-effective-audit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const alternate = path.join(root, 'alternate');
  await fs.mkdir(path.join(home, '.codex'), { recursive: true });
  await fs.mkdir(alternate);
  await fs.mkdir(path.join(home, '.claude'));
  for (const directory of [path.join(home, '.claude'), alternate]) await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify(claudeBaseline));
  await fs.writeFile(path.join(home, '.codex/config.toml'), '[features]\nremote_plugin = false\nplugins = false\n');
  return { root, home, alternate };
}

for (const [tool, variable, relative] of [
  ['claude', 'CLAUDE_CONFIG_DIR', 'CLAUDE.md'],
  ['claude', 'CLAUDE_CONFIG_DIR', '.claude.json'],
  ['codex', 'CODEX_HOME', 'AGENTS.md'],
]) {
  test(`effective ${variable} cannot hide ${relative} behind a clean conventional home`, async t => {
    const { home, alternate } = await fixture(t);
    const bytes = relative.endsWith('.json') ? '{"mcpServers":{"rogue":{"command":"/usr/bin/false"}}}' : 'synthetic instruction';
    const target = path.join(alternate, relative);
    await fs.writeFile(target, bytes);
    if (tool === 'codex') await fs.writeFile(path.join(alternate, 'config.toml'), '[features]\nremote_plugin = false\nplugins = false\n');
    await assert.rejects(runAgentConfigAudit({ tool, homeDir: home, env: { [variable]: alternate }, autoRepair: false, requireClean: true }), /not clean/iu);
    assert.equal(await fs.readFile(target, 'utf8'), bytes);
  });
}

test('unsafe effective input prevents unrelated conventional-home repair', async t => {
  const { home, alternate } = await fixture(t);
  const config = path.join(home, '.codex/config.toml');
  const before = 'notify = ["/usr/bin/false"]\n[features]\nremote_plugin = false\n';
  await fs.writeFile(config, before);
  await fs.writeFile(path.join(alternate, 'settings.json'), '{"private-effective-sentinel":');
  await assert.rejects(runAgentConfigAudit({ homeDir: home, env: { CLAUDE_CONFIG_DIR: alternate }, requireClean: true }), error => /unsafe/iu.test(error.message) && !error.message.includes('sentinel'));
  assert.equal(await fs.readFile(config, 'utf8'), before);
});

for (const ancestor of [false, true]) {
  test(`effective config ${ancestor ? 'ancestor' : 'root'} symlink cannot redirect repair`, async t => {
    const { root, home, alternate } = await fixture(t);
    await fs.mkdir(path.join(alternate, 'inner'));
    await fs.symlink(alternate, path.join(root, 'linked'));
    const target = path.join(alternate, ancestor ? 'inner/settings.json' : 'settings.json');
    const bytes = '{"hooks":{"SessionStart":[]}}';
    await fs.writeFile(target, bytes);
    await assert.rejects(runAgentConfigAudit({ tool: 'claude', homeDir: home, env: { CLAUDE_CONFIG_DIR: path.join(root, 'linked', ...(ancestor ? ['inner'] : [])) }, requireClean: true }), /unsafe/iu);
    assert.equal(await fs.readFile(target, 'utf8'), bytes);
  });
}

test('effective repairs preserve auth/history identities and unrelated settings', async t => {
  const { home, alternate } = await fixture(t);
  const auth = path.join(alternate, '.credentials.json');
  const history = path.join(alternate, 'projects');
  await fs.writeFile(auth, '{"synthetic":"preserve"}');
  await fs.mkdir(history);
  await fs.writeFile(path.join(history, 'session.jsonl'), 'synthetic conversation');
  const before = await Promise.all([fs.stat(auth), fs.stat(history)]);
  const settings = path.join(alternate, 'settings.json');
  await fs.writeFile(settings, JSON.stringify({ ...claudeBaseline, model: 'synthetic-model', permissions: { deny: ['Read(secret)'] }, hooks: { SessionStart: [] } }));
  await fs.writeFile(path.join(home, '.codex/config.toml'), 'notify = ["/usr/bin/false"]\n[features]\nremote_plugin = false\nplugins = false\n');
  const result = await runAgentConfigAudit({ homeDir: home, env: { CLAUDE_CONFIG_DIR: alternate }, requireClean: true });
  assert.equal(result.repaired.length, 2);
  assert.deepEqual(JSON.parse(await fs.readFile(settings, 'utf8')), { ...claudeBaseline, model: 'synthetic-model', permissions: { deny: ['Read(secret)'] } });
  assert.equal(await fs.readFile(auth, 'utf8'), '{"synthetic":"preserve"}');
  assert.equal(await fs.readFile(path.join(history, 'session.jsonl'), 'utf8'), 'synthetic conversation');
  const after = await Promise.all([fs.stat(auth), fs.stat(history)]);
  assert.deepEqual(
    after.map(info => info.ino),
    before.map(info => info.ino)
  );
});

test('a concurrent effective edit invalidates every pending repair', async t => {
  const { home, alternate } = await fixture(t);
  const target = path.join(alternate, 'settings.json');
  await fs.writeFile(target, '{"hooks":{"SessionStart":[]}}');
  const conventional = path.join(home, '.codex/config.toml');
  const bytes = 'notify = ["/usr/bin/false"]\n[features]\nremote_plugin = false\n';
  await fs.writeFile(conventional, bytes);
  let changed = false;
  await assert.rejects(
    runAgentConfigAudit({
      homeDir: home,
      env: { CLAUDE_CONFIG_DIR: alternate },
      requireClean: true,
      log: async () => {
        if (!changed) {
          changed = true;
          await fs.writeFile(target, '{"model":"concurrent-edit","hooks":{"SessionStart":[]}}');
        }
      },
    }),
    /unsafe/iu
  );
  assert.equal(await fs.readFile(conventional, 'utf8'), bytes);
  assert.equal(JSON.parse(await fs.readFile(target, 'utf8')).model, 'concurrent-edit');
});

test('relative effective config paths reject admission without disclosing values', async t => {
  const { home } = await fixture(t);
  await assert.rejects(runAgentConfigAudit({ homeDir: home, env: { CODEX_HOME: 'private-relative-sentinel' }, requireClean: true }), error => /unsafe/iu.test(error.message) && !error.message.includes('sentinel'));
});

for (const dirty of [false, true]) {
  test(`changed path selectors reject ${dirty ? 'repair' : 'clean admission'} after asynchronous logging`, async t => {
    const { home, alternate } = await fixture(t);
    const target = path.join(home, '.codex/config.toml');
    const bytes = `${dirty ? 'notify = ["/usr/bin/false"]\n' : ''}[features]\nremote_plugin = false\n`;
    await fs.writeFile(target, bytes);
    const env = {};
    await assert.rejects(
      runAgentConfigAudit({
        homeDir: home,
        env,
        requireClean: true,
        verbose: true,
        log: async () => {
          env.CODEX_HOME = alternate;
        },
      }),
      /unsafe effective path changes/iu
    );
    assert.equal(await fs.readFile(target, 'utf8'), bytes);
  });
}

test('an effective hard-linked configuration cannot repair a credential inode', async t => {
  const { home, alternate } = await fixture(t);
  const auth = path.join(home, '.codex/auth.json');
  const bytes = '{"synthetic":"preserve","hooks":{"SessionStart":[]}}';
  await fs.writeFile(auth, bytes);
  const before = await fs.stat(auth);
  await fs.unlink(path.join(alternate, 'settings.json'));
  await fs.link(auth, path.join(alternate, 'settings.json'));
  await assert.rejects(runAgentConfigAudit({ homeDir: home, env: { CLAUDE_CONFIG_DIR: alternate }, requireClean: true }), /unsafe/iu);
  assert.equal(await fs.readFile(auth, 'utf8'), bytes);
  assert.equal((await fs.stat(auth)).ino, before.ino);
});

test('a conventional registration is repaired once when effective roots also exist', async t => {
  const { home, alternate } = await fixture(t);
  const target = path.join(home, '.claude.json');
  await fs.writeFile(target, '{"mcpServers":{"rogue":{"command":"/usr/bin/false"}},"syntheticAccount":"preserve"}');
  const result = await runAgentConfigAudit({ homeDir: home, env: { CLAUDE_CONFIG_DIR: alternate }, requireClean: true });
  assert.equal(result.repaired.length, 1);
  assert.equal(JSON.parse(await fs.readFile(target, 'utf8')).syntheticAccount, 'preserve');
});

test('the installed-runtime verifier audits selected tool roots before native commands', async t => {
  const { home, alternate } = await fixture(t);
  await fs.writeFile(path.join(alternate, 'CLAUDE.md'), 'synthetic global instruction');
  await assert.rejects(verifyAgentRuntime({ homeDir: home, env: { CLAUDE_CONFIG_DIR: alternate }, codexCommand: '/never-run-codex', claudeCommand: '/never-run-claude' }), /not clean/iu);
});

test('an effective Codex TOML repair preserves approved Playwright and synthetic auth', async t => {
  const { home, alternate } = await fixture(t);
  const target = path.join(alternate, 'config.toml');
  const auth = path.join(alternate, 'auth.json');
  await fs.writeFile(auth, '{"synthetic":"preserve"}');
  const identity = await fs.stat(auth);
  await fs.writeFile(target, 'model = "synthetic-model"\n[features]\nremote_plugin = false\nplugins = false\n[mcp_servers.rogue]\ncommand = "/usr/bin/false"\n[mcp_servers.playwright]\ncommand = "npx"\nargs = ["-y", "@playwright/mcp@latest"]\n');
  const result = await runAgentConfigAudit({ tool: 'codex', homeDir: home, env: { CODEX_HOME: alternate }, requireClean: true });
  assert.equal(result.repaired.length, 1);
  const content = await fs.readFile(target, 'utf8');
  assert.match(content, /synthetic-model/u);
  assert.match(content, /mcp_servers\.playwright/u);
  assert.doesNotMatch(content, /rogue/u);
  assert.equal(await fs.readFile(auth, 'utf8'), '{"synthetic":"preserve"}');
  assert.equal((await fs.stat(auth)).ino, identity.ino);
});
