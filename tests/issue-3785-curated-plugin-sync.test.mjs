/** @hive-mind-test-suite default */
// Issue #3785: `features.remote_plugin = false` alone makes Codex 0.164+ start
// the *local* curated marketplace sync (`maybe_start_curated_repo_sync_for_config`
// runs when plugins are enabled and the remote catalog is inactive), cloning
// hundreds of curated SKILL.md files into CODEX_HOME/.tmp/plugins on every
// model start. The global baseline therefore also pins `features.plugins`,
// reports the synced catalog as a checkout (never as an enabled plugin), and
// only a task scope that selected plugins re-enables the loader privately.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { auditAgentConfig, CODEX_CURATED_SYNC_PATHS, CODEX_HOSTED_APPS_DISABLE_ARGS, CODEX_PLUGIN_SYNC_DISABLE_ARGS, runAgentConfigAudit } from '../src/agent-config-audit.lib.mjs';
import { runCodexCapabilityPreflight } from '../src/codex-capability-preflight.lib.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const claudeBaseline = { syncClaudeAiSkills: false, syncClaudeAiPlugins: false, disableClaudeAiConnectors: true, env: { CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } };
const cleanCodex = '[features]\nremote_plugin = false\nplugins = false\napps = false\n';

async function home(t, codexConfig = cleanCodex) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-curated-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.codex'), { recursive: true });
  await fs.mkdir(path.join(root, '.claude'), { recursive: true });
  await fs.writeFile(path.join(root, '.claude/settings.json'), JSON.stringify(claudeBaseline));
  if (codexConfig !== null) await fs.writeFile(path.join(root, '.codex/config.toml'), codexConfig);
  return root;
}

const keys = findings => findings.map(finding => `${finding.kind}:${finding.name}`).sort();

test('the clean baseline pins both remote and curated plugin sync off', async t => {
  const root = await home(t);
  assert.deepEqual(auditAgentConfig({ homeDir: root }).findings, []);
});

for (const [label, config, expected] of [
  ['an unpinned loader', '[features]\nremote_plugin = false\napps = false\n', 'not pinned'],
  ['an explicitly enabled loader', '[features]\nremote_plugin = false\nplugins = true\napps = false\n', 'explicitly enabled'],
]) {
  test(`${label} is reported and repaired to plugins=false without touching credentials or history`, async t => {
    const root = await home(t, config);
    const auth = path.join(root, '.codex/auth.json');
    const sessions = path.join(root, '.codex/sessions');
    await fs.writeFile(auth, '{"synthetic":"preserve"}\n');
    await fs.mkdir(sessions);
    const findings = auditAgentConfig({ tool: 'codex', homeDir: root }).findings;
    assert.deepEqual(keys(findings), ['curated-plugin-sync:features.plugins']);
    assert.match(findings[0].detail, new RegExp(expected));
    await runAgentConfigAudit({ tool: 'codex', homeDir: root, requireClean: true });
    const repaired = parse(await fs.readFile(path.join(root, '.codex/config.toml'), 'utf8'));
    assert.equal(repaired.features.plugins, false);
    assert.equal(repaired.features.remote_plugin, false);
    assert.equal(await fs.readFile(auth, 'utf8'), '{"synthetic":"preserve"}\n');
    assert.ok((await fs.stat(sessions)).isDirectory());
  });
}

test('a profile cannot re-enable the curated loader; an absent profile flag inherits the pin', async t => {
  const root = await home(t, `${cleanCodex}[profiles.inherit]\nmodel = "synthetic-model"\n[profiles.loud.features]\nplugins = true\n`);
  const findings = auditAgentConfig({ tool: 'codex', homeDir: root }).findings;
  assert.deepEqual(keys(findings), ['curated-plugin-sync:features.plugins']);
  await runAgentConfigAudit({ tool: 'codex', homeDir: root, requireClean: true });
  const repaired = parse(await fs.readFile(path.join(root, '.codex/config.toml'), 'utf8'));
  assert.equal(repaired.profiles.loud.features.plugins, false);
  assert.equal(repaired.profiles.inherit.features, undefined);
});

test('a missing config gets every pin', async t => {
  const root = await home(t, null);
  assert.deepEqual(keys(auditAgentConfig({ tool: 'codex', homeDir: root }).findings), ['curated-plugin-sync:features.plugins', 'hosted-connectors:features.apps', 'remote-plugin-sync:features.remote_plugin']);
});

for (const [label, config] of [
  ['an unpinned', '[features]\nremote_plugin = false\nplugins = false\n'],
  ['an explicitly enabled', '[features]\nremote_plugin = false\nplugins = false\napps = true\n'],
  ['a profile-enabled', `${cleanCodex}[profiles.loud.features]\napps = true\n`],
]) {
  test(`${label} hosted ChatGPT connectors MCP server is reported and repaired to apps=false`, async t => {
    // Codex 0.166 observed through the synthetic provider: `features.apps`
    // (stable, default on) adds the hosted `codex_apps` MCP server, POST
    // chatgpt.com/backend-api/ps/mcp, to every start, outside the
    // Playwright-only global baseline.
    const root = await home(t, config);
    const auth = path.join(root, '.codex/auth.json');
    await fs.writeFile(auth, '{"synthetic":"preserve"}\n');
    assert.deepEqual(keys(auditAgentConfig({ tool: 'codex', homeDir: root }).findings), ['hosted-connectors:features.apps']);
    await runAgentConfigAudit({ tool: 'codex', homeDir: root, requireClean: true });
    const repaired = parse(await fs.readFile(path.join(root, '.codex/config.toml'), 'utf8'));
    assert.equal(repaired.features.apps, false);
    if (repaired.profiles?.loud) assert.equal(repaired.profiles.loud.features.apps, false);
    assert.equal(await fs.readFile(auth, 'utf8'), '{"synthetic":"preserve"}\n');
  });
}

test('a synced curated catalog is a checkout to remove, never an enabled plugin, and its contents are not read', async t => {
  const root = await home(t);
  const tmp = path.join(root, '.codex/.tmp');
  const skill = path.join(tmp, 'plugins/plugins/synthetic/skills/demo/SKILL.md');
  await fs.mkdir(path.dirname(skill), { recursive: true });
  await fs.writeFile(skill, '---\nname: demo\n---\nsynthetic private instruction sentinel\n');
  await fs.writeFile(path.join(tmp, 'plugins.sha'), 'synthetic\n');
  await fs.writeFile(path.join(tmp, 'plugins.sync.lock'), '');
  await fs.writeFile(path.join(tmp, 'unrelated-native-state'), 'keep\n');
  const auth = path.join(root, '.codex/auth.json');
  await fs.writeFile(auth, '{"synthetic":"preserve"}\n');
  const findings = auditAgentConfig({ tool: 'codex', homeDir: root }).findings;
  assert.deepEqual(keys(findings), CODEX_CURATED_SYNC_PATHS.map(relative => `marketplace:curated-sync:${relative}`).sort());
  assert.ok(findings.every(finding => finding.kind !== 'plugin' && finding.kind !== 'plugin-enable'));
  assert.ok(!JSON.stringify(findings).includes('sentinel'));
  const logs = [];
  await runAgentConfigAudit({ tool: 'codex', homeDir: root, requireClean: true, log: async line => logs.push(line) });
  assert.deepEqual((await fs.readdir(tmp)).sort(), ['unrelated-native-state']);
  assert.equal(await fs.readFile(auth, 'utf8'), '{"synthetic":"preserve"}\n');
  assert.ok(!logs.join('\n').includes('sentinel'));
});

test('managed configuration cannot force the curated loader on', async t => {
  const root = await home(t);
  const managed = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-curated-managed-'));
  t.after(() => fs.rm(managed, { recursive: true, force: true }));
  const target = path.join(managed, 'requirements.toml');
  await fs.writeFile(target, '[features]\nplugins = true\n');
  await assert.rejects(runAgentConfigAudit({ homeDir: root, requireClean: true, systemRoots: { claude: path.join(managed, 'claude'), codex: managed } }), /managed.*not clean/iu);
  assert.equal(await fs.readFile(target, 'utf8'), '[features]\nplugins = true\n');
});

async function preflight(t, { requiredPlugins = [] } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-curated-scope-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const baseCodexHome = path.join(root, 'operator');
  const projectDir = path.join(root, 'checkout');
  await fs.mkdir(baseCodexHome);
  await fs.mkdir(projectDir);
  await fs.writeFile(path.join(baseCodexHome, 'config.toml'), cleanCodex);
  const seen = [];
  const runCommand = async invocation => {
    const config = parse(await fs.readFile(path.join(invocation.env.CODEX_HOME, 'config.toml'), 'utf8'));
    seen.push({ args: invocation.args, plugins: config.features?.plugins, remote: config.features?.remote_plugin, apps: config.features?.apps, home: invocation.env.CODEX_HOME });
    if (invocation.args.includes('--available')) return { code: 0, stdout: JSON.stringify({ installed: [], available: [] }), stderr: '' };
    const skill = path.join(invocation.env.CODEX_HOME, 'skills/.system/imagegen/SKILL.md');
    await fs.mkdir(path.dirname(skill), { recursive: true });
    await fs.writeFile(skill, '---\nname: imagegen\n---\n');
    return { code: 0, stdout: JSON.stringify({ text: `<skills_instructions>\n### Available skills\n- imagegen: Fixture. (file: ${skill})\n</skills_instructions>` }), stderr: '' };
  };
  const run = () => runCodexCapabilityPreflight({ owner: 'fixture', repo: 'task', baseCodexHome, projectDir, env: {}, runCommand, requiredPlugins });
  return { baseCodexHome, seen, run };
}

test('a task without plugin requirements keeps the scoped loader off', async t => {
  const f = await preflight(t);
  const result = await f.run();
  t.after(() => result.dispose?.());
  assert.ok(f.seen.length > 0);
  assert.ok(f.seen.every(call => call.plugins === false && call.remote === false && call.apps === false));
  assert.equal(await fs.readFile(path.join(f.baseCodexHome, 'config.toml'), 'utf8'), cleanCodex);
});

test('plugin discovery re-enables the loader only inside the private task scope', async t => {
  const f = await preflight(t, { requiredPlugins: ['synthetic@fixture'] });
  await assert.rejects(f.run(), /synthetic@fixture/u);
  const discovery = f.seen.find(call => call.args.includes('--available'));
  assert.ok(discovery, 'catalog discovery ran');
  assert.equal(discovery.plugins, true);
  assert.equal(discovery.remote, false);
  assert.equal(discovery.apps, false, 'catalog discovery never needs the hosted connectors server');
  assert.notEqual(discovery.home, f.baseCodexHome);
  assert.equal(await fs.readFile(path.join(f.baseCodexHome, 'config.toml'), 'utf8'), cleanCodex, 'operator pin is unchanged');
});

test('every launch without selected plugins disables the loader and hosted connectors, and every image pins both', async () => {
  assert.deepEqual([...CODEX_PLUGIN_SYNC_DISABLE_ARGS], ['-c', 'features.plugins=false']);
  assert.deepEqual([...CODEX_HOSTED_APPS_DISABLE_ARGS], ['-c', 'features.apps=false']);
  const launcher = await fs.readFile(path.join(repoRoot, 'src/codex.lib.mjs'), 'utf8');
  assert.match(launcher, /if \(!\(capabilityPreflight\?\.plugins\?\.length > 0\)\) \{\s*for \(const arg of \[\.\.\.CODEX_PLUGIN_SYNC_DISABLE_ARGS, \.\.\.CODEX_HOSTED_APPS_DISABLE_ARGS\]\)/u);
  for (const file of ['Dockerfile', 'Dockerfile.dind', 'coolify/Dockerfile']) {
    const text = await fs.readFile(path.join(repoRoot, file), 'utf8');
    assert.match(text, /printf '\\n\[features\]\\nremote_plugin = false\\nplugins = false\\napps = false\\n'/u, `${file} writes the curated-sync and hosted-connector pins`);
    assert.match(text, /grep -q '\^plugins = false'/u, `${file} fails the build without the curated-sync pin`);
    assert.match(text, /grep -q '\^apps = false'/u, `${file} fails the build without the hosted-connector pin`);
  }
});

test('Claude built-in plugin usage state written by `claude -p` is not misreported as an enabled plugin', async t => {
  // Claude 2.1.316 writes this on every print-mode run; it records built-in
  // AGENTS.md usage, not an installed or enabled capability.
  const root = await home(t);
  const store = path.join(root, '.claude/plugins/store');
  await fs.mkdir(store, { recursive: true });
  await fs.writeFile(path.join(store, 'cc-plugin-agents-md_builtin-000000000000.json'), '{"usage-rows-queued":"synthetic"}\n');
  assert.deepEqual(auditAgentConfig({ homeDir: root }).findings, []);
});
