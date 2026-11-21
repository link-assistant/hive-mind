/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { stringify as stringifyToml } from 'smol-toml';
import { runAgentConfigAudit } from '../src/agent-config-audit.lib.mjs';

const approved = { command: 'npx', args: ['-y', '@playwright/mcp@latest', '--isolated', '--headless', '--no-sandbox', '--timeout-action=600000', '--viewport-size', '1920x1080'] };

async function fixture(t, scope, server) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'hive-3785-mcp-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(path.join(home, '.codex'), { recursive: true });
  await mkdir(path.join(home, '.claude'), { recursive: true });
  const codex = { features: { remote_plugin: false, plugins: false, apps: false } };
  if (scope === 'codex') codex.mcp_servers = { playwright: server };
  if (scope === 'profile') codex.profiles = { alternate: { mcp_servers: { playwright: server } } };
  await writeFile(path.join(home, '.codex/config.toml'), stringifyToml(codex));
  const claudeScope = scope.startsWith('claude');
  const config = claudeScope ? path.join(home, scope === 'claude' ? '.claude.json' : '.claude/.claude.json') : path.join(home, '.codex/config.toml');
  if (claudeScope) await writeFile(config, JSON.stringify({ mcpServers: { playwright: server }, oauthAccount: { syntheticAccount: true } }));
  const auth = path.join(home, '.codex/auth.json');
  await writeFile(auth, '{"syntheticCredential":"preserve"}\n');
  const authInfo = await stat(auth);
  return { home, config, auth, authInfo };
}

const unapproved = [
  ['arbitrary command', { ...approved, command: '/usr/bin/false' }],
  ['missing package', { command: 'npx', args: [] }],
  ['different package', { ...approved, args: ['-y', '@synthetic/unapproved'] }],
  ['npx package injection', { ...approved, args: ['--package=@synthetic/unapproved', '@playwright/mcp'] }],
  ['package URL', { ...approved, args: ['https://synthetic.invalid/playwright.tgz'] }],
  ['script option', { ...approved, args: ['@playwright/mcp', '--init-script', '/synthetic/private-script.js'] }],
  ['config option', { ...approved, args: ['@playwright/mcp', '--config=/synthetic/private-config.json'] }],
  ['environment injection', { ...approved, env: { NODE_OPTIONS: '--require=/synthetic/private-script.js' } }],
  ['working directory', { ...approved, cwd: '/synthetic/private-package' }],
  ['remote transport', { type: 'http', url: 'https://synthetic.invalid/mcp' }],
  ['unexpected field', { ...approved, synthetic_option: true }],
  ['untyped arguments', { ...approved, args: ['@playwright/mcp', 123] }],
];

for (const scope of ['claude', 'claude-config-dir', 'codex', 'profile']) {
  for (const [label, server] of unapproved) {
    test(`${scope} Playwright name cannot approve ${label}`, { timeout: 5000 }, async t => {
      const { home, config, auth, authInfo } = await fixture(t, scope, server);
      const before = await readFile(config, 'utf8');
      // Include repairable drift: an unsafe registration must stop all repairs.
      const skill = path.join(home, '.claude/skills/unapproved/SKILL.md');
      await mkdir(path.dirname(skill), { recursive: true });
      await writeFile(skill, 'preserve until unsafe registration is resolved');
      const logs = [];
      await assert.rejects(runAgentConfigAudit({ homeDir: home, requireClean: true, log: async line => logs.push(line) }), error => /Playwright MCP registration is not approved/u.test(error.message) && !error.message.includes('synthetic'));
      assert.equal(await readFile(config, 'utf8'), before);
      assert.equal(await readFile(skill, 'utf8'), 'preserve until unsafe registration is resolved');
      assert.equal(await readFile(auth, 'utf8'), '{"syntheticCredential":"preserve"}\n');
      assert.equal((await stat(auth)).ino, authInfo.ino);
      assert.ok(!logs.some(line => line.includes('synthetic')));
    });
  }
  test(`${scope} shipped Playwright registration remains byte-for-byte unchanged`, { timeout: 5000 }, async t => {
    const server = scope.startsWith('claude') ? { ...approved, type: 'stdio', env: {} } : { ...approved, startup_timeout_sec: 60, tool_timeout_sec: 600 };
    const { home, config } = await fixture(t, scope, server);
    const before = await readFile(config, 'utf8');
    await runAgentConfigAudit({ homeDir: home, requireClean: true });
    assert.equal(await readFile(config, 'utf8'), before);
  });
}
