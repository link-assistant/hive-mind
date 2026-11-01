/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAgentConfigAudit } from '../src/agent-config-audit.lib.mjs';

const claudeBaseline = { syncClaudeAiSkills: false, syncClaudeAiPlugins: false, disableClaudeAiConnectors: true, env: { CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } };

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-managed-audit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'home');
  const systemRoots = { claude: path.join(root, 'managed-claude'), codex: path.join(root, 'managed-codex') };
  for (const directory of [path.join(homeDir, '.codex'), ...Object.values(systemRoots)]) await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(homeDir, '.codex/config.toml'), '[features]\nremote_plugin = false\nplugins = false\n');
  await fs.mkdir(path.join(homeDir, '.claude'));
  await fs.writeFile(path.join(homeDir, '.claude/settings.json'), JSON.stringify(claudeBaseline));
  return { homeDir, systemRoots, requireClean: true };
}

for (const [tool, relative, bytes] of [
  ['claude', 'managed-settings.json', '{"permissions":{"deny":["Read(secret)"]},"hooks":{"SessionStart":[]}}'],
  ['claude', 'managed-settings.d/10-team.json', '{"managedMcpServers":{"rogue":{"command":"/usr/bin/false"}}}'],
  ['claude', 'managed-mcp.json', '{"mcpServers":{"rogue":{"command":"/usr/bin/false"}}}'],
  ['codex', 'config.toml', '[mcp_servers.rogue]\ncommand = "/usr/bin/false"\n'],
  ['codex', 'managed_config.toml', 'developer_instructions = "private-managed-sentinel"\n'],
  ['codex', 'requirements.toml', '[[hooks.SessionStart]]\n[[hooks.SessionStart.hooks]]\ntype = "command"\ncommand = "/usr/bin/false"\n'],
]) {
  test(`managed ${tool} ${relative} cannot bypass a clean home or lose its policy`, async t => {
    const options = await fixture(t);
    const target = path.join(options.systemRoots[tool], relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    const before = await fs.stat(target);
    await assert.rejects(runAgentConfigAudit(options), error => /managed.*not clean/iu.test(error.message) && !error.message.includes('sentinel'));
    assert.equal(await fs.readFile(target, 'utf8'), bytes);
    assert.equal((await fs.stat(target)).ino, before.ino);
  });
}

test('clean managed security constraints and approved Playwright remain byte-for-byte intact', async t => {
  const options = await fixture(t);
  const files = [
    [path.join(options.systemRoots.claude, 'managed-settings.json'), '{"permissions":{"deny":["Read(secret)"]},"allowManagedHooksOnly":true,"syncClaudeAiSkills":false}'],
    [path.join(options.systemRoots.claude, 'managed-mcp.json'), '{"mcpServers":{"playwright":{"command":"npx","args":["-y","@playwright/mcp@latest"]}}}'],
    [path.join(options.systemRoots.codex, 'requirements.toml'), 'allowed_sandbox_modes = ["read-only"]\nallow_managed_hooks_only = true\n[mcp_servers.playwright.identity]\ncommand = "npx"\n[rules]\nprefix_rules = [{ pattern = ["rm"], decision = "forbidden" }]\n[marketplaces]\nrestrict_to_allowed_sources = true\n'],
  ];
  for (const [target, bytes] of files) await fs.writeFile(target, bytes);
  const identities = await Promise.all(files.map(([target]) => fs.stat(target)));
  const result = await runAgentConfigAudit(options);
  assert.deepEqual(result.findings, []);
  for (const [index, [target, bytes]] of files.entries()) {
    assert.equal(await fs.readFile(target, 'utf8'), bytes);
    assert.equal((await fs.stat(target)).ino, identities[index].ino);
  }
});

test('malformed managed input blocks unrelated home repair without exposing parser input', async t => {
  const options = await fixture(t);
  const config = path.join(options.homeDir, '.codex/config.toml');
  const bytes = 'notify = ["/usr/bin/false"]\n[features]\nremote_plugin = false\n';
  await fs.writeFile(config, bytes);
  await fs.writeFile(path.join(options.systemRoots.claude, 'managed-settings.json'), '{"private-managed-sentinel":');
  await assert.rejects(runAgentConfigAudit(options), error => /unsafe.*managed|managed.*unsafe/iu.test(error.message) && !error.message.includes('sentinel'));
  assert.equal(await fs.readFile(config, 'utf8'), bytes);
});

for (const kind of ['symlink', 'hardlink']) {
  test(`managed ${kind} cannot redirect validation into credentials`, async t => {
    const options = await fixture(t);
    const auth = path.join(options.homeDir, '.codex/auth.json');
    const bytes = '{"synthetic":"preserve"}';
    await fs.writeFile(auth, bytes);
    const before = await fs.stat(auth);
    const target = path.join(options.systemRoots.claude, 'managed-settings.json');
    if (kind === 'symlink') await fs.symlink(auth, target);
    else await fs.link(auth, target);
    await assert.rejects(runAgentConfigAudit(options), /unsafe.*managed|managed.*unsafe/iu);
    assert.equal(await fs.readFile(auth, 'utf8'), bytes);
    assert.equal((await fs.stat(auth)).ino, before.ino);
  });
}

test('managed admin .system payloads are not trusted as native user stock', async t => {
  const options = await fixture(t);
  await fs.mkdir(path.join(options.systemRoots.codex, 'skills/.system'), { recursive: true });
  await assert.rejects(runAgentConfigAudit(options), /managed.*not clean/iu);
});

test('a managed edit while logging invalidates all pending user repairs', async t => {
  const options = await fixture(t);
  const target = path.join(options.systemRoots.claude, 'managed-settings.json');
  await fs.writeFile(target, '{"permissions":{"deny":["Read(secret)"]}}');
  const config = path.join(options.homeDir, '.codex/config.toml');
  const before = 'notify = ["/usr/bin/false"]\n[features]\nremote_plugin = false\n';
  await fs.writeFile(config, before);
  let changed = false;
  options.log = async () => {
    if (changed) return;
    changed = true;
    await fs.writeFile(target, '{"permissions":{"deny":["Read(other)"]}}');
  };
  await assert.rejects(runAgentConfigAudit(options), /unsafe/iu);
  assert.equal(await fs.readFile(config, 'utf8'), before);
});

test('linked managed ancestors reject admission without traversing policy', async t => {
  const options = await fixture(t);
  const linked = path.join(options.homeDir, 'managed-link');
  await fs.symlink(path.dirname(options.systemRoots.claude), linked);
  options.systemRoots.claude = path.join(linked, path.basename(options.systemRoots.claude));
  await assert.rejects(runAgentConfigAudit(options), /unsafe.*managed|managed.*unsafe/iu);
});

test('oversized managed documents reject before opening or parsing', async t => {
  const options = await fixture(t);
  const target = path.join(options.systemRoots.claude, 'managed-settings.json');
  await fs.writeFile(target, Buffer.alloc(1024 * 1024 + 1, 32));
  const original = (await import('node:fs')).default;
  let opened = false;
  options.fsImpl = {
    ...original,
    promises: {
      ...original.promises,
      open: async (...args) => {
        if (args[0] === target) opened = true;
        return original.promises.open(...args);
      },
    },
  };
  await assert.rejects(runAgentConfigAudit(options), /unsafe.*managed|managed.*unsafe/iu);
  assert.equal(opened, false);
});

test('a changed managed path selector cannot turn a clean audit into admission', async t => {
  const options = await fixture(t);
  options.verbose = true;
  options.log = async () => {
    options.systemRoots.claude = path.join(options.homeDir, 'other-managed-root');
  };
  await assert.rejects(runAgentConfigAudit(options), /managed.*unsafe effective path changes/iu);
});

test('audit-only reports managed findings without modifying administrator policy', async t => {
  const options = await fixture(t);
  const target = path.join(options.systemRoots.claude, 'managed-settings.json');
  const bytes = '{"hooks":{"SessionStart":[]},"permissions":{"deny":["Read(secret)"]}}';
  await fs.writeFile(target, bytes);
  const result = await runAgentConfigAudit({ ...options, autoRepair: false, requireClean: false });
  assert.ok(result.findings.some(finding => finding.kind === 'managed-capability' && finding.repair === null));
  assert.equal(result.repaired.length, 0);
  assert.equal(await fs.readFile(target, 'utf8'), bytes);
});

for (const [tool, file, bytes] of [
  ['claude', 'managed-settings.json', '{"policyHelper":{"path":"/usr/bin/false"},"permissions":{"deny":["Read(secret)"]}}'],
  ['codex', 'requirements.toml', '[config_server]\nbase_url = "https://config.example.invalid"\n'],
]) {
  test(`unattested ${tool} dynamic managed settings block native startup without executing a helper`, async t => {
    const options = await fixture(t);
    const target = path.join(options.systemRoots[tool], file);
    await fs.writeFile(target, bytes);
    const before = await fs.stat(target);
    await assert.rejects(runAgentConfigAudit(options), /managed.*not clean/iu);
    assert.equal(await fs.readFile(target, 'utf8'), bytes);
    assert.equal((await fs.stat(target)).ino, before.ino);
  });
}
