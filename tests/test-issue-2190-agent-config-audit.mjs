#!/usr/bin/env node
/**
 * Regression test for issue #2190 ("Codex refuses to work as requested").
 *
 * The operator's global `~/.codex` had the Superpowers plugin synced into
 * `plugins/cache/openai-curated-remote/` by Codex's remote catalog, and that
 * whole directory was bind-mounted into every task. Superpowers' skills force a
 * brainstorming/approval gate, so autonomous runs ended with a question instead
 * of a pull request at ~9M input tokens. This suite rebuilds that state in a
 * temporary home, asserts the audit reports every non-minimal item, and asserts
 * the repair leaves exactly the minimal configuration behind.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2190
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { AGENT_CONFIG_MINIMAL_ENV, auditAgentConfig, CODEX_REMOTE_PLUGIN_DISABLE_ARGS, isAgentConfigAutoRepairEnabled, MINIMAL_MCP_SERVERS, removeTomlTable, repairAgentConfig, runAgentConfigAudit } from '../src/agent-config-audit.lib.mjs';
import { REQUIRED_CLAUDE_QUIET_ENV } from '../src/claude-quiet-config.lib.mjs';

let passed = 0;
let failed = 0;

function pass(label) {
  console.log(`  PASS: ${label}`);
  passed++;
}

function fail(label, expected, actual) {
  console.error(`  FAIL: ${label}`);
  if (expected !== undefined) console.error(`     expected: ${JSON.stringify(expected)}`);
  if (actual !== undefined) console.error(`     actual:   ${JSON.stringify(actual)}`);
  failed++;
}

function assertEqual(actual, expected, label) {
  if (actual === expected) pass(label);
  else fail(label, expected, actual);
}

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass(label);
  else fail(label, expected, actual);
}

const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

const CODEX_CONFIG_WITH_DRIFT = `model = "gpt-5.3-codex"

[features]
memories = false

[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp@latest"]

[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]

[plugins."openai-curated-remote/superpowers"]
enabled = true
`;

const makeDriftedHome = () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-mind-2190-home-'));
  // Codex: the exact layout observed on the operator's box.
  write(path.join(home, '.codex', 'auth.json'), '{"tokens":{}}');
  write(path.join(home, '.codex', 'config.toml'), CODEX_CONFIG_WITH_DRIFT);
  write(path.join(home, '.codex', 'plugins', 'cache', 'openai-curated-remote', 'superpowers', '6.3.0', 'skills', 'using-superpowers', 'SKILL.md'), '# using-superpowers');
  write(path.join(home, '.codex', 'plugins', 'cache', 'openai-curated-remote', 'superpowers', '6.3.0', 'skills', 'brainstorming', 'SKILL.md'), '# brainstorming');
  write(path.join(home, '.codex', 'skills', 'my-global-skill', 'SKILL.md'), '# global');
  write(path.join(home, '.agents', 'skills', 'shared-skill', 'SKILL.md'), '# shared');
  write(path.join(home, '.codex', 'sessions', '2026', 'rollout.jsonl'), '{}');
  // Claude: official marketplace auto-installed plus an extra MCP server and a global skill.
  write(path.join(home, '.claude', '.credentials.json'), '{"claudeAiOauth":{}}');
  write(path.join(home, '.claude', 'plugins', 'marketplaces', 'claude-plugins-official', '.claude-plugin', 'marketplace.json'), '{}');
  write(path.join(home, '.claude', 'plugins', 'known_marketplaces.json'), JSON.stringify({ 'claude-plugins-official': { source: { source: 'github' } } }));
  write(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'superpowers@claude-plugins-official': [{ scope: 'user' }] } }));
  write(path.join(home, '.claude', 'plugins', 'cache', 'claude-plugins-official', 'superpowers', '6.3.0', 'skills', 'brainstorming', 'SKILL.md'), '# brainstorming');
  write(path.join(home, '.claude', 'skills', 'leftover-skill', 'SKILL.md'), '# leftover');
  write(path.join(home, '.claude', 'commands', 'review.md'), 'review');
  write(path.join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'opus', enabledPlugins: { 'superpowers@claude-plugins-official': true } }));
  write(path.join(home, '.claude', 'projects', '-tmp-x', 'session.jsonl'), '{}');
  write(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'x@example.com' }, mcpServers: { playwright: { command: 'npx' }, github: { command: 'npx' } }, officialMarketplaceAutoInstalled: true }));
  return home;
};

console.log('\n1. The drifted configuration is fully reported');
const home = makeDriftedHome();
const { findings, repairable, warnOnly } = auditAgentConfig({ homeDir: home });
const keyOf = f => `${f.tool}:${f.kind}:${f.name}`;
const keys = findings.map(keyOf).sort();
assertDeepEqual(keys, ['claude:custom-command:review.md', 'claude:marketplace:claude-plugins-official', 'claude:mcp-server:github', 'claude:plugin-enable:superpowers@claude-plugins-official', 'claude:plugin-state:installed_plugins.json', 'claude:plugin-state:known_marketplaces.json', 'claude:plugin:claude-plugins-official/superpowers', 'claude:skill:leftover-skill', 'codex:mcp-server:github', 'codex:plugin-enable:openai-curated-remote/superpowers', 'codex:plugin:openai-curated-remote/superpowers', 'codex:remote-plugin-sync:features.remote_plugin', 'codex:skill:my-global-skill', 'codex:skill:shared-skill'], 'every non-minimal item is a finding and playwright MCP is not');
assertEqual(warnOnly.length, 1, 'only the custom command is warn-only');
assertEqual(warnOnly[0].kind, 'custom-command', 'custom commands are reported but never removed');
assertEqual(repairable.length, findings.length - 1, 'everything else carries a repair');
assertEqual(findings.find(f => f.kind === 'plugin' && f.tool === 'codex').location, path.join(home, '.codex', 'plugins', 'cache', 'openai-curated-remote', 'superpowers'), 'the codex plugin repair targets the whole <marketplace>/<plugin> directory');

console.log('\n2. Scoping by tool');
assertEqual(
  auditAgentConfig({ homeDir: home, tool: 'claude' }).findings.every(f => f.tool === 'claude'),
  true,
  'tool=claude only inspects claude'
);
assertEqual(
  auditAgentConfig({ homeDir: home, tool: 'codex' }).findings.every(f => f.tool === 'codex'),
  true,
  'tool=codex only inspects codex'
);
assertEqual(auditAgentConfig({ homeDir: home, tool: 'agent' }).findings.length, 0, 'unknown tools produce no findings');

console.log('\n3. Repair leaves exactly the minimal configuration');
const { repaired, failed: repairFailures } = repairAgentConfig(repairable);
assertEqual(repairFailures.length, 0, 'no repair failed');
assertEqual(repaired.length, repairable.length, 'every repair was applied');
assertEqual(fs.existsSync(path.join(home, '.codex', 'plugins', 'cache', 'openai-curated-remote')), false, 'superpowers cache is gone');
assertEqual(fs.existsSync(path.join(home, '.codex', 'skills')), false, 'global codex skills are gone');
assertEqual(fs.existsSync(path.join(home, '.agents', 'skills', 'shared-skill')), false, 'global ~/.agents skills are gone');
assertEqual(fs.existsSync(path.join(home, '.codex', 'auth.json')), true, 'codex auth is untouched');
assertEqual(fs.existsSync(path.join(home, '.codex', 'sessions', '2026', 'rollout.jsonl')), true, 'codex sessions are untouched');
const repairedCodexConfig = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
assertEqual(/\[mcp_servers\.playwright\]/u.test(repairedCodexConfig), true, 'playwright MCP survives in config.toml');
assertEqual(/\[mcp_servers\.github\]/u.test(repairedCodexConfig), false, 'the extra MCP table is removed');
assertEqual(/\[plugins\."openai-curated-remote\/superpowers"\]/u.test(repairedCodexConfig), false, 'the plugin table is removed');
assertEqual(/model = "gpt-5\.3-codex"/u.test(repairedCodexConfig), true, 'unrelated top-level keys survive');
assertEqual(/memories = false/u.test(repairedCodexConfig), true, 'existing feature pins survive');
assertEqual(/remote_plugin = false/u.test(repairedCodexConfig), true, 'features.remote_plugin is pinned to false');
assertEqual(fs.existsSync(path.join(home, '.claude', 'plugins', 'marketplaces')) && fs.readdirSync(path.join(home, '.claude', 'plugins', 'marketplaces')).length > 0, false, 'claude marketplaces are gone');
assertEqual(fs.existsSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json')), false, 'installed_plugins.json is gone');
assertEqual(fs.existsSync(path.join(home, '.claude', 'plugins', 'known_marketplaces.json')), false, 'known_marketplaces.json is gone');
assertEqual(fs.existsSync(path.join(home, '.claude', 'skills', 'leftover-skill')), false, 'global claude skill is gone');
assertEqual(fs.existsSync(path.join(home, '.claude', 'commands', 'review.md')), true, 'custom command is kept');
assertEqual(fs.existsSync(path.join(home, '.claude', '.credentials.json')), true, 'claude credentials are untouched');
assertEqual(fs.existsSync(path.join(home, '.claude', 'projects', '-tmp-x', 'session.jsonl')), true, 'claude projects are untouched');
const repairedSettings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
assertDeepEqual(repairedSettings, { model: 'opus', enabledPlugins: {} }, 'only the plugin enable entry left settings.json');
const repairedClaudeJson = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
assertDeepEqual(Object.keys(repairedClaudeJson.mcpServers), ['playwright'], 'only playwright MCP remains in ~/.claude.json');
assertEqual(repairedClaudeJson.oauthAccount.emailAddress, 'x@example.com', 'auth state in ~/.claude.json survives');

console.log('\n4. A repaired home is clean');
const after = auditAgentConfig({ homeDir: home });
assertDeepEqual(after.findings.map(keyOf), ['claude:custom-command:review.md'], 'second audit reports only the warn-only item');

console.log('\n5. A fresh Docker-image home is clean');
const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-mind-2190-fresh-'));
write(path.join(fresh, '.codex', 'config.toml'), '[features]\nremote_plugin = false\n\n[mcp_servers.playwright]\ncommand = "npx"\n');
write(path.join(fresh, '.claude.json'), JSON.stringify({ mcpServers: { playwright: {} } }));
assertEqual(auditAgentConfig({ homeDir: fresh }).findings.length, 0, 'the minimal configuration has no findings');
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-mind-2190-empty-'));
const emptyFindings = auditAgentConfig({ homeDir: empty }).findings;
assertDeepEqual(emptyFindings.map(keyOf), ['codex:remote-plugin-sync:features.remote_plugin'], 'an empty home only needs the remote plugin pin');
repairAgentConfig(emptyFindings);
assertEqual(fs.readFileSync(path.join(empty, '.codex', 'config.toml'), 'utf8').includes('remote_plugin = false'), true, 'the pin creates config.toml when missing');

console.log('\n6. runAgentConfigAudit honours auto-repair and logs warnings');
const home2 = makeDriftedHome();
const lines = [];
const log = async (message, meta) => lines.push({ message, meta });
const disabled = await runAgentConfigAudit({ homeDir: home2, autoRepair: false, log });
assertEqual(disabled.repaired.length, 0, 'nothing is repaired when auto-repair is off');
assertEqual(disabled.skipped.length > 0, true, 'the skipped repairs are reported');
assertEqual(fs.existsSync(path.join(home2, '.codex', 'plugins', 'cache', 'openai-curated-remote', 'superpowers')), true, 'superpowers stays when auto-repair is off');
assertEqual(
  lines.some(l => l.meta?.level === 'warn' && l.message.includes('not minimal')),
  true,
  'a warning is logged'
);
assertEqual(
  lines.some(l => l.message.includes('--no-agent-config-auto-repair')),
  true,
  'the opt-out flag is named in the warning'
);
const enabled = await runAgentConfigAudit({ homeDir: home2, autoRepair: true, log });
assertEqual(enabled.repaired.length, repairable.length, 'auto-repair removes everything repairable');
assertEqual(fs.existsSync(path.join(home2, '.codex', 'plugins', 'cache', 'openai-curated-remote', 'superpowers')), false, 'superpowers is removed by auto-repair');
const clean = await runAgentConfigAudit({ homeDir: fresh, autoRepair: true, log: async () => fail('a clean home must stay silent') });
assertEqual(clean.findings.length, 0, 'a clean home logs nothing');

console.log('\n7. Auto-repair resolution');
assertEqual(isAgentConfigAutoRepairEnabled({ env: {} }), true, 'auto-repair is on by default');
assertEqual(isAgentConfigAutoRepairEnabled({ argv: { agentConfigAutoRepair: false }, env: {} }), false, '--no-agent-config-auto-repair turns it off');
assertEqual(isAgentConfigAutoRepairEnabled({ args: ['--no-agent-config-auto-repair'], env: {} }), false, 'raw argv from the Docker launcher is honoured');
assertEqual(isAgentConfigAutoRepairEnabled({ env: { HIVE_MIND_AGENT_CONFIG_AUTO_REPAIR: '0' } }), false, 'HIVE_MIND_AGENT_CONFIG_AUTO_REPAIR=0 turns it off');
assertEqual(isAgentConfigAutoRepairEnabled({ argv: { agentConfigAutoRepair: true }, env: { HIVE_MIND_AGENT_CONFIG_AUTO_REPAIR: '0' } }), true, 'argv wins over the environment');

console.log('\n8. Prevention: the environment and flags that keep the configuration minimal');
assertEqual(REQUIRED_CLAUDE_QUIET_ENV.CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL, '1', 'claude quiet env stops the official marketplace auto-install');
assertEqual(AGENT_CONFIG_MINIMAL_ENV.CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL, '1', 'the minimal env is exported for other launchers');
assertDeepEqual([...CODEX_REMOTE_PLUGIN_DISABLE_ARGS], ['-c', 'features.remote_plugin=false'], 'codex exec pins remote_plugin off per run');
assertDeepEqual([...MINIMAL_MCP_SERVERS], ['playwright'], 'playwright is the only MCP server in the minimal set');

console.log('\n9. removeTomlTable');
assertEqual(removeTomlTable('a = 1\n[x]\nb = 2\n[y]\nc = 3\n', 'x'), 'a = 1\n[y]\nc = 3\n', 'a middle table is removed');
assertEqual(removeTomlTable('[x]\nb = 2\n', 'x'), '', 'a lone table leaves an empty file');
assertEqual(removeTomlTable('[x."q.q"]\nb = 2\n[x.z]\nc = 3\n', 'x."q.q"'), '[x.z]\nc = 3\n', 'quoted dotted keys are matched exactly');
assertEqual(removeTomlTable('[x]\nb = 2\n', 'y'), '[x]\nb = 2\n', 'a missing table is a no-op');

for (const dir of [home, home2, fresh, empty]) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
