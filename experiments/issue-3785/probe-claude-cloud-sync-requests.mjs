#!/usr/bin/env node
// Issue #3785: which account/cloud capability endpoints does the actual Claude
// CLI request at startup, with and without Hive Mind's cloud policy?
// Synthetic OAuth only; a loopback MITM provider answers every request and
// records method + path (never headers or bodies). Nothing is forwarded.
// Usage: node probe-claude-cloud-sync-requests.mjs [claude-binary] [--force-sync]
//
// Observed 2026-11-01 with --force-sync (synthetic GrowthBook flag, Max org
// profile and empty org policy):
// - Claude 2.1.310 (image pin) and 2.1.316 *without* the policy request
//   GET api.anthropic.com/api/oauth/organizations/:uuid/skills/list-skills and
//   .../skills/synthetic-sync-skill/download, then land
//   ~/.claude/skills/synced/<org>_<account>/synthetic-sync-skill/SKILL.md and
//   ~/.claude/plugins/synced/<org>_<account> — the deployment report reproduced.
// - *With* the Hive Mind policy (syncClaudeAiSkills/syncClaudeAiPlugins false,
//   connectors disabled) neither binary sends a skills/plugins request and no
//   capability path appears (2.1.316 only writes the built-in
//   plugins/store/cc-plugin-agents-md_builtin-*.json usage file).
import fs from 'node:fs/promises';
import http from 'node:http';
import tls from 'node:tls';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const claude = process.argv.slice(2).find(arg => !arg.startsWith('--')) || 'claude';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-cloud-sync-'));
const hosts = ['api.anthropic.com', 'platform.claude.com', 'claude.ai', 'statsig.anthropic.com', 'mcp-proxy.anthropic.com'];
await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=api.anthropic.com', '-addext', `subjectAltName=${hosts.map(host => `DNS:${host}`).join(',')}`, '-keyout', path.join(root, 'key.pem'), '-out', path.join(root, 'ca.pem')]);
const [key, cert] = await Promise.all([fs.readFile(path.join(root, 'key.pem')), fs.readFile(path.join(root, 'ca.pem'))]);

const requests = [];
// --force-sync answers the server-side gates (GrowthBook flag, org profile,
// org policy) as an account with skills/plugins sync enabled would, so the run
// shows whether the local `false` settings alone stop the sync requests.
const forceSync = process.argv.includes('--force-sync');
const zipDir = path.join(root, 'zip');
await fs.mkdir(path.join(zipDir, 'synthetic-sync-skill'), { recursive: true });
await fs.writeFile(path.join(zipDir, 'synthetic-sync-skill/SKILL.md'), '---\nname: synthetic-sync-skill\ndescription: Synthetic account skill\n---\nSynthetic.\n');
await run('zip', ['-qr', path.join(root, 'skill.zip'), 'synthetic-sync-skill'], { cwd: zipDir });
const skillZip = await fs.readFile(path.join(root, 'skill.zip'));
const orgUuid = '00000000-0000-4000-8000-000000000001';
function synthetic(endpoint) {
  if (!forceSync) return null;
  if (endpoint.startsWith('/api/eval')) return { features: Object.fromEntries(['tengu_claudeai_skills_sync_enabled', 'tengu_claudeai_plugins_sync_enabled'].map(name => [name, { defaultValue: true }])) };
  if (endpoint === '/api/oauth/profile') return { account: { uuid: '00000000-0000-4000-8000-000000000002', email: 'synthetic@example.invalid', has_claude_max: true }, organization: { uuid: orgUuid, organization_type: 'claude_max', rate_limit_tier: 'default_claude_max_20x' } };
  if (endpoint === '/api/claude_code/policy_limits') return { restrictions: {} };
  if (endpoint.endsWith('/skills/list-skills')) return { skills: [{ id: 'synthetic-sync-skill', name: 'synthetic-sync-skill', description: 'Synthetic account skill', source: 'custom', creator_type: 'user', partition_by: 'account', enabled: true, updated_at: '2026-11-01T00:00:00Z' }] };
  if (endpoint.endsWith('/skills/synthetic-sync-skill/download')) return Buffer.from(skillZip);
  return null;
}
const server = http.createServer(async (request, response) => {
  for await (const _ of request);
  const endpoint = request.url.split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27}/giu, ':uuid');
  requests.push(`${request.method} ${request.socket.servername || 'plain'}${endpoint}`);
  if (endpoint === '/v1/messages') {
    const message = { id: 'synthetic', type: 'message', role: 'assistant', content: [], model: 'synthetic-model', stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } };
    const events = [
      ['message_start', { type: 'message_start', message }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }],
      ['message_stop', { type: 'message_stop' }],
    ];
    response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'close' });
    return response.end(events.map(([kind, value]) => `event: ${kind}\ndata: ${JSON.stringify(value)}\n\n`).join(''));
  }
  const forced = synthetic(endpoint);
  if (forced) {
    if (Buffer.isBuffer(forced)) {
      response.writeHead(200, { 'Content-Type': 'application/zip', Connection: 'close' });
      return response.end(forced);
    }
    response.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
    return response.end(JSON.stringify(forced));
  }
  response.writeHead(404, { 'Content-Type': 'application/json', Connection: 'close' });
  response.end('{"error":"synthetic"}');
});
server.on('connect', (request, socket, head) => {
  const [host] = request.url.split(':');
  if (!hosts.includes(host)) return socket.end('HTTP/1.1 502 Synthetic proxy refuses origin\r\n\r\n');
  socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  if (head?.length) socket.unshift(head);
  const secure = new tls.TLSSocket(socket, { isServer: true, key, cert });
  secure.servername = host;
  secure.on('error', () => secure.destroy());
  server.emit('connection', secure);
});
server.on('clientError', (_error, socket) => socket.destroy());
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const proxy = `http://127.0.0.1:${server.address().port}`;

const credentials = { claudeAiOauth: { accessToken: 'SYNTHETIC-ACCESS', refreshToken: 'SYNTHETIC-REFRESH', expiresAt: Date.now() + 3_600_000, scopes: ['user:inference', 'user:profile', 'user:sessions:claude_code'], subscriptionType: 'max' } };
const policy = { syncClaudeAiSkills: false, syncClaudeAiPlugins: false, disableClaudeAiConnectors: true, env: { CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } };
for (const [label, settings] of [
  ['without cloud policy', {}],
  ['with Hive Mind cloud policy', policy],
]) {
  const home = path.join(root, label.replace(/\W+/gu, '-'));
  await fs.mkdir(path.join(home, '.claude'), { recursive: true });
  await fs.mkdir(path.join(home, 'work'));
  await fs.writeFile(path.join(home, '.claude/.credentials.json'), JSON.stringify(credentials), { mode: 0o600 });
  await fs.writeFile(path.join(home, '.claude/settings.json'), JSON.stringify(settings));
  requests.length = 0;
  const env = { HOME: home, PATH: process.env.PATH, TERM: 'dumb', HTTPS_PROXY: proxy, https_proxy: proxy, NODE_EXTRA_CA_CERTS: path.join(root, 'ca.pem'), SSL_CERT_FILE: path.join(root, 'ca.pem'), ...(settings.env || {}) };
  const result = await run(claude, ['-p', 'ping', '--max-turns', '1'], { cwd: path.join(home, 'work'), env, timeout: 60_000 }).catch(error => error);
  await new Promise(resolve => setTimeout(resolve, 2000));
  const { stdout: tree } = await run('find', ['.', '-mindepth', '1', '-path', './work', '-prune', '-o', '-print'], { cwd: home });
  console.log(`\n### ${label}: exit ${result.code ?? 0}`);
  console.log([...new Set(requests)].sort().join('\n'));
  console.log('-- capability paths:', tree.split('\n').filter(line => /skills|plugins|marketplace/u.test(line)).join(' ') || 'none');
}
server.close();
await fs.rm(root, { recursive: true, force: true });
