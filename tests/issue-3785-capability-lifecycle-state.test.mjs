/** @hive-mind-test-suite default */
// Issue #3785: helpers behind the installed capability lifecycle gate
// (scripts/verify-capability-lifecycle.mjs). The manifest is written
// independently of the production audit, canonical comparison must catch a
// replaced or rewritten credential while tolerating appended history, traffic
// classification must name channels without values, and the synthetic
// provider must answer vendor hosts locally and refuse unknown origins.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { test } from 'node:test';
import { parse } from 'smol-toml';
import { assertNoCapabilityTraffic, captureCanonicalState, classifyCapabilityTraffic, compareCanonicalState, scanCapabilityManifest } from '../scripts/capability-lifecycle-state.lib.mjs';
import { isAccountCapabilitySyncRequest, startSyntheticVendorProvider, SYNTHETIC_ORG_UUID } from '../scripts/capability-lifecycle-provider.lib.mjs';

const baselineSettings = { syncClaudeAiSkills: false, syncClaudeAiPlugins: false, disableClaudeAiConnectors: true, env: { CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } };
const baselineCodex = '[features]\nremote_plugin = false\nplugins = false\napps = false\n\n[mcp_servers.playwright]\ncommand = "npx"\nargs = ["--no-install", "@playwright/mcp@latest"]\n';

async function scratch(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-lifecycle-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function baselineHome(t) {
  const home = await scratch(t);
  await fs.mkdir(path.join(home, '.claude'), { recursive: true });
  await fs.mkdir(path.join(home, '.codex/skills/.system/stock'), { recursive: true });
  await fs.writeFile(path.join(home, '.claude/settings.json'), JSON.stringify(baselineSettings));
  await fs.writeFile(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { playwright: { type: 'stdio', command: 'npx', args: [], env: {} } } }));
  await fs.writeFile(path.join(home, '.codex/config.toml'), baselineCodex);
  return home;
}

test('the Playwright-only baseline with stock Codex system skills has an empty manifest', async t => {
  assert.deepEqual(await scanCapabilityManifest(await baselineHome(t), { parseToml: parse }), []);
});

test('a missing home reports every policy key and pin, never an empty manifest', async t => {
  const manifest = await scanCapabilityManifest(path.join(await scratch(t), 'absent'), { parseToml: parse });
  assert.ok(manifest.includes('claude:policy:.claude/settings.json#syncClaudeAiSkills'));
  assert.ok(manifest.includes('claude:policy:.claude/settings.json#env.ENABLE_CLAUDEAI_MCP_SERVERS'));
  for (const pin of ['remote_plugin', 'plugins', 'apps']) assert.ok(manifest.includes(`codex:feature-pin:.codex/config.toml#features.${pin}`));
});

test('the manifest lists repopulated capability state by name only', async t => {
  const home = await baselineHome(t);
  const secret = 'instruction text that must never be read';
  await fs.mkdir(path.join(home, '.claude/skills/synced-skill'), { recursive: true });
  await fs.writeFile(path.join(home, '.claude/skills/synced-skill/SKILL.md'), secret);
  await fs.mkdir(path.join(home, '.claude/plugins/marketplaces/official'), { recursive: true });
  await fs.mkdir(path.join(home, '.claude/plugins/cache/tool'), { recursive: true });
  await fs.writeFile(path.join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'tool@official': [] } }));
  await fs.writeFile(path.join(home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({}));
  await fs.writeFile(path.join(home, '.claude/settings.json'), JSON.stringify({ ...baselineSettings, syncClaudeAiSkills: true, enabledPlugins: { 'tool@official': true, 'off@official': false } }));
  await fs.mkdir(path.join(home, '.codex/.tmp/plugins'), { recursive: true });
  await fs.mkdir(path.join(home, '.codex/plugins/cache/curated'), { recursive: true });
  await fs.mkdir(path.join(home, '.agents/skills/agent-skill'), { recursive: true });
  await fs.writeFile(path.join(home, '.codex/config.toml'), '[features]\nremote_plugin = false\nplugins = false\n\n[profiles.work.features]\napps = true\n\n[mcp_servers.extra]\ncommand = "x"\n\n[plugins."gmail@curated"]\nenabled = true\n');
  const manifest = await scanCapabilityManifest(home, { parseToml: parse });
  assert.deepEqual(manifest, ['claude:catalog:.claude/plugins/marketplaces/official', 'claude:enabled-plugin:.claude/settings.json#enabledPlugins.tool@official', 'claude:plugin-payload:.claude/plugins/cache/tool', 'claude:plugin-state:.claude/plugins/installed_plugins.json', 'claude:policy:.claude/settings.json#syncClaudeAiSkills', 'claude:skill:.claude/skills/synced-skill', 'codex:catalog:.codex/.tmp/plugins', 'codex:enabled-plugin:.codex/config.toml#plugins.gmail@curated', 'codex:feature-pin:.codex/config.toml#features.apps', 'codex:feature-pin:.codex/config.toml#profiles.work.features.apps', 'codex:mcp-server:.codex/config.toml#mcp_servers.extra', 'codex:plugin-payload:.codex/plugins/cache/curated', 'codex:skill:.agents/skills/agent-skill']);
  assert.ok(!manifest.join('\n').includes(secret));
  // A catalog checkout is a catalog, not proof that its plugins were enabled.
  assert.ok(!manifest.some(entry => entry.startsWith('codex:enabled-plugin:.codex/.tmp')));
});

test('an unparseable Codex config is reported instead of silently passing', async t => {
  const home = await baselineHome(t);
  await fs.writeFile(path.join(home, '.codex/config.toml'), '[features\n');
  assert.ok((await scanCapabilityManifest(home, { parseToml: parse })).includes('codex:config:.codex/config.toml#unparseable'));
});

test('canonical comparison catches rewrites, replacement and removal but allows appended history', async t => {
  const root = await scratch(t);
  const write = (name, text) => fs.writeFile(path.join(root, name), text);
  await Promise.all([write('auth.json', '{"synthetic":1}'), write('history.jsonl', 'a\n'), write('replaced.json', 'same'), write('gone.json', 'x'), write('restored.jsonl', 'r\n')]);
  const relatives = ['auth.json', 'history.jsonl', 'replaced.json', 'gone.json', 'restored.jsonl', 'never.json'];
  const before = await captureCanonicalState(root, relatives);
  assert.equal(before.get('never.json'), null);
  assert.deepEqual(compareCanonicalState(before, await captureCanonicalState(root, relatives)), []);

  await fs.appendFile(path.join(root, 'history.jsonl'), 'b\n');
  // Same bytes, new inode: an atomic replace that would break a shared mount.
  await write('replaced.json.tmp', 'same');
  await fs.rename(path.join(root, 'replaced.json.tmp'), path.join(root, 'replaced.json'));
  await fs.rm(path.join(root, 'gone.json'));
  await fs.rm(path.join(root, 'restored.jsonl'));
  await write('restored.jsonl', 'r\n');
  const after = await captureCanonicalState(root, relatives);
  assert.deepEqual(compareCanonicalState(before, after, { appendOnly: ['history.jsonl'], contentOnly: ['restored.jsonl'] }), ['replaced.json', 'gone.json']);
  assert.deepEqual(compareCanonicalState(before, after), ['history.jsonl', 'replaced.json', 'gone.json', 'restored.jsonl']);

  await write('auth.json', '{"synthetic":2}');
  await fs.writeFile(path.join(root, 'history.jsonl'), 'X\nb\nc\n');
  assert.deepEqual(compareCanonicalState(before, await captureCanonicalState(root, relatives), { appendOnly: ['history.jsonl', 'auth.json'] }), ['auth.json', 'history.jsonl', 'replaced.json', 'gone.json', 'restored.jsonl']);
});

test('traffic classification separates account sync, curated catalogs and hosted connectors', () => {
  const traffic = classifyCapabilityTraffic(['GET api.anthropic.com/api/oauth/organizations/:uuid/skills/list-skills', 'GET api.anthropic.com/api/oauth/organizations/:uuid/skills/list-skills', 'GET api.anthropic.com/api/oauth/profile', 'POST api.anthropic.com/v1/messages', 'GET chatgpt.com/backend-api/plugins/featured', 'POST chatgpt.com/backend-api/ps/mcp', 'POST chatgpt.com/backend-api/codex/responses'], new Set(['github.com', 'registry.npmjs.org']));
  assert.deepEqual(traffic, {
    accountSync: ['GET api.anthropic.com/api/oauth/organizations/:uuid/skills/list-skills'],
    curatedCatalog: ['GET chatgpt.com/backend-api/plugins/featured', 'TUNNEL github.com'],
    hostedConnectors: ['POST chatgpt.com/backend-api/ps/mcp'],
  });
  assert.throws(() => assertNoCapabilityTraffic(traffic, 'P9'), /^Error: P9: capability traffic accountSync=.*curatedCatalog=.*hostedConnectors=/u);
  assert.doesNotThrow(() => assertNoCapabilityTraffic(classifyCapabilityTraffic(['POST api.anthropic.com/v1/messages'], new Set(['registry.npmjs.org'])), 'P9'));
});

function connect(proxy, host, path, ca) {
  return new Promise((resolve, reject) => {
    const { port } = new URL(proxy);
    const request = http.request({ host: '127.0.0.1', port, method: 'CONNECT', path: `${host}:443` });
    request.once('error', reject);
    request.once('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        return resolve({ status: response.statusCode });
      }
      const options = { host, path, servername: host, ca: [ca], headers: { Connection: 'close' }, createConnection: () => tls.connect({ socket, servername: host, ca: [ca] }) };
      https
        .get(options, answer => {
          let body = '';
          answer.on('data', chunk => (body += chunk));
          answer.once('end', () => resolve({ status: answer.statusCode, body }));
        })
        .once('error', reject);
    });
    request.end();
  });
}

test('the synthetic provider answers vendor hosts locally and refuses unknown origins', { timeout: 30_000 }, async t => {
  const provider = await startSyntheticVendorProvider({ root: path.join(await scratch(t), 'provider'), tunnelHosts: [] });
  t.after(() => provider.close());
  const ca = await fs.readFile(provider.ca);
  const profile = await connect(provider.proxy, 'api.anthropic.com', '/api/oauth/profile', ca);
  assert.equal(profile.status, 200);
  assert.equal(JSON.parse(profile.body).organization.uuid, SYNTHETIC_ORG_UUID);
  const list = await connect(provider.proxy, 'api.anthropic.com', `/api/oauth/organizations/${SYNTHETIC_ORG_UUID}/skills/list-skills?x=1`, ca);
  assert.equal(list.status, 200);
  assert.equal((await connect(provider.proxy, 'chatgpt.com', '/backend-api/unknown', ca)).status, 404);
  // Download hosts are refused when they are not explicitly tunnelled.
  assert.equal((await connect(provider.proxy, 'registry.npmjs.org', '/', ca)).status, 502);
  assert.equal((await connect(provider.proxy, 'example.invalid', '/', ca)).status, 502);
  assert.deepEqual([...provider.refused].sort(), ['example.invalid', 'registry.npmjs.org']);
  assert.deepEqual([...provider.tunnels], []);
  // Only method, host and a UUID-masked path are recorded.
  assert.deepEqual(provider.requests, ['GET api.anthropic.com/api/oauth/profile', 'GET api.anthropic.com/api/oauth/organizations/:uuid/skills/list-skills', 'GET chatgpt.com/backend-api/unknown']);
  assert.deepEqual(provider.requests.filter(isAccountCapabilitySyncRequest), ['GET api.anthropic.com/api/oauth/organizations/:uuid/skills/list-skills']);
});

test('without forced account sync the provider answers account endpoints like a sync-disabled account', { timeout: 30_000 }, async t => {
  const provider = await startSyntheticVendorProvider({ root: path.join(await scratch(t), 'provider'), tunnelHosts: [], forceAccountSync: false });
  t.after(() => provider.close());
  assert.equal((await connect(provider.proxy, 'api.anthropic.com', '/api/oauth/profile', await fs.readFile(provider.ca))).status, 404);
});
