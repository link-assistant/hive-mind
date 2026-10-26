/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAgentConfigAudit } from '../src/agent-config-audit.lib.mjs';
import { ensureClaudeQuietConfig, buildClaudeQuietEnv } from '../src/claude-quiet-config.lib.mjs';
import { resolveSettingsPath } from '../src/configure-claude.lib.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const baseline = { syncClaudeAiSkills: false, syncClaudeAiPlugins: false, disableClaudeAiConnectors: true, env: { CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } };
async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-cloud-baseline-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const config = path.join(home, '.claude');
  await fs.mkdir(config);
  return { home, config, options: { homeDir: home, tool: 'claude', requireClean: true, systemRoots: { claude: path.join(home, 'managed-claude'), codex: path.join(home, 'managed-codex') } } };
}

for (const [name, settings] of [
  ['absent', null],
  ['empty', {}],
  ['skills enabled', { ...baseline, syncClaudeAiSkills: true }],
  ['plugins enabled', { ...baseline, syncClaudeAiPlugins: true }],
  ['connectors enabled', { ...baseline, disableClaudeAiConnectors: false }],
  ['marketplace enabled', { ...baseline, env: {} }],
]) {
  test(`admission refuses ${name} cloud policy when repair is disabled`, async t => {
    const { config, options } = await fixture(t);
    if (settings) await fs.writeFile(path.join(config, 'settings.json'), JSON.stringify(settings));
    await assert.rejects(runAgentConfigAudit({ ...options, autoRepair: false }), /not clean/iu);
  });
}

test('cloud policy repair preserves protected state and unrelated security settings', async t => {
  const { config, options } = await fixture(t);
  const auth = path.join(config, '.credentials.json');
  const history = path.join(config, 'projects');
  await fs.writeFile(auth, '{"synthetic":"preserve"}');
  await fs.mkdir(history);
  await fs.writeFile(path.join(history, 'session.jsonl'), 'synthetic conversation');
  const before = await Promise.all([fs.stat(auth), fs.stat(history)]);
  const settingsPath = path.join(config, 'settings.json');
  await fs.writeFile(settingsPath, JSON.stringify({ model: 'synthetic', permissions: { deny: ['Read(secret)'] }, env: { CUSTOM: 'preserve' } }));
  const result = await runAgentConfigAudit(options);
  assert.equal(result.failed.length, 0);
  const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  assert.deepEqual(settings, { ...baseline, model: 'synthetic', permissions: { deny: ['Read(secret)'] }, env: { CUSTOM: 'preserve', ...baseline.env } });
  assert.equal(await fs.readFile(auth, 'utf8'), '{"synthetic":"preserve"}');
  assert.equal(await fs.readFile(path.join(history, 'session.jsonl'), 'utf8'), 'synthetic conversation');
  assert.deepEqual(
    (await Promise.all([fs.stat(auth), fs.stat(history)])).map(s => s.ino),
    before.map(s => s.ino)
  );
  assert.equal((await runAgentConfigAudit({ ...options, autoRepair: false })).findings.length, 0);
});

test('new quiet configuration disables skills, plugins and connectors', async t => {
  const { config } = await fixture(t);
  const settingsPath = path.join(config, 'settings.json');
  await ensureClaudeQuietConfig({ settingsPath });
  const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  for (const key of ['syncClaudeAiSkills', 'syncClaudeAiPlugins', 'disableClaudeAiConnectors']) assert.equal(settings[key], baseline[key]);
  assert.equal(buildClaudeQuietEnv({ ENABLE_CLAUDEAI_MCP_SERVERS: 'true' }).ENABLE_CLAUDEAI_MCP_SERVERS, 'false');
});

test('configure-claude resolves the same selected native directory as admission', () => {
  assert.equal(resolveSettingsPath(undefined, { homeDir: '/synthetic/home', env: { CLAUDE_CONFIG_DIR: '/synthetic/effective' } }), '/synthetic/effective/settings.json');
});

test('the configure command writes only its selected disposable home', { timeout: 5000 }, async t => {
  const { home, config } = await fixture(t);
  const alternate = path.join(home, 'effective');
  await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../src/configure-claude.mjs', import.meta.url))], {
    env: { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: alternate },
    maxBuffer: 64 * 1024,
  });
  const settings = JSON.parse(await fs.readFile(path.join(alternate, 'settings.json'), 'utf8'));
  for (const key of ['syncClaudeAiSkills', 'syncClaudeAiPlugins', 'disableClaudeAiConnectors']) assert.equal(settings[key], baseline[key]);
  await assert.rejects(fs.stat(path.join(config, 'settings.json')), { code: 'ENOENT' });
});

test('a selected home must carry the cloud baseline even when the conventional home is clean', async t => {
  const { home, config, options } = await fixture(t);
  await fs.writeFile(path.join(config, 'settings.json'), JSON.stringify(baseline));
  const alternate = path.join(home, 'effective');
  await fs.mkdir(alternate);
  await assert.rejects(runAgentConfigAudit({ ...options, env: { CLAUDE_CONFIG_DIR: alternate }, autoRepair: false }), /not clean/iu);
});

test('managed synced plugins reject admission before any user repair', async t => {
  const { config, options } = await fixture(t);
  await fs.mkdir(options.systemRoots.claude);
  await fs.writeFile(path.join(options.systemRoots.claude, 'managed-settings.json'), '{"syncClaudeAiPlugins":true}');
  await assert.rejects(runAgentConfigAudit(options), /managed.*not clean/iu);
  await assert.rejects(fs.stat(path.join(config, 'settings.json')), { code: 'ENOENT' });
});

for (const [name, policy] of [
  ['connectors enabled', { disableClaudeAiConnectors: false }],
  ['connector environment enabled', { env: { ENABLE_CLAUDEAI_MCP_SERVERS: 'true' } }],
  ['marketplace environment enabled', { env: { CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '0' } }],
]) {
  test(`managed ${name} cannot override the user cloud baseline`, async t => {
    const { config, options } = await fixture(t);
    await fs.writeFile(path.join(config, 'settings.json'), JSON.stringify(baseline));
    await fs.mkdir(options.systemRoots.claude);
    const managed = path.join(options.systemRoots.claude, 'managed-settings.json');
    const bytes = JSON.stringify(policy);
    await fs.writeFile(managed, bytes);
    const before = await fs.stat(managed);
    await assert.rejects(runAgentConfigAudit(options), /managed.*not clean/iu);
    assert.equal(await fs.readFile(managed, 'utf8'), bytes);
    assert.equal((await fs.stat(managed)).ino, before.ino);
  });
}

test('restored synced plugin payloads cannot survive the global audit', async t => {
  const { config, options } = await fixture(t);
  await fs.writeFile(path.join(config, 'settings.json'), JSON.stringify(baseline));
  const directory = path.join(config, 'plugins/synced/synthetic-plugin');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'plugin.json'), '{"name":"synthetic"}');
  await assert.rejects(runAgentConfigAudit({ ...options, autoRepair: false }), /not clean/iu);
  await runAgentConfigAudit(options);
  await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
});
