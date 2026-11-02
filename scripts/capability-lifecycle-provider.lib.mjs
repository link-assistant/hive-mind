// Issue #3785: loopback provider for the installed capability lifecycle gate.
//
// Every host a synthetic credential could be sent to (Anthropic and OpenAI
// API, OAuth and account hosts) is terminated here with a throwaway CA and
// answered synthetically; nothing is forwarded. Only package/binary download
// hosts, which never receive a vendor credential, are tunnelled so the real
// updaters can fetch real releases. Every other origin is refused.
//
// `forceAccountSync` answers the server-side gates of Claude's account
// skill/plugin sync (feature flag, Max organization profile, empty org policy)
// the way an account with sync enabled would, so a run proves that the local
// configuration alone keeps the sync off. Only method, host and a UUID-masked
// path are recorded: never headers or bodies.
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const SYNTHETIC_MITM_HOSTS = Object.freeze(['api.anthropic.com', 'platform.claude.com', 'claude.ai', 'console.anthropic.com', 'statsig.anthropic.com', 'mcp-proxy.anthropic.com', 'chatgpt.com', 'ab.chatgpt.com', 'api.openai.com', 'auth.openai.com']);
export const DOWNLOAD_TUNNEL_HOSTS = Object.freeze(['downloads.claude.ai', 'storage.googleapis.com', 'registry.npmjs.org', 'github.com', 'api.github.com', 'codeload.github.com', 'objects.githubusercontent.com', 'raw.githubusercontent.com', 'release-assets.githubusercontent.com']);
export const SYNTHETIC_ORG_UUID = '00000000-0000-4000-8000-000000000001';
export const SYNTHETIC_ACCOUNT_UUID = '00000000-0000-4000-8000-000000000002';
export const SYNTHETIC_SYNC_SKILL = 'synthetic-sync-skill';
export const SYNTHETIC_CHATGPT_ACCOUNT_ID = 'synthetic-account';

/** Requests that only an enabled account skill/plugin sync sends. */
export const isAccountCapabilitySyncRequest = line => /\/api\/oauth\/organizations\/:uuid\/(?:skills|plugins)\//u.test(line);

const sse = events => events.map(([kind, value]) => `event: ${kind}\ndata: ${JSON.stringify(value)}\n\n`).join('');

const claudeMessage = () => {
  const message = { id: 'synthetic', type: 'message', role: 'assistant', content: [], model: 'synthetic-model', stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } };
  return sse([
    ['message_start', { type: 'message_start', message }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }],
    ['message_stop', { type: 'message_stop' }],
  ]);
};

const codexResponse = () =>
  sse([
    ['response.created', { type: 'response.created', response: { id: 'synthetic-response' } }],
    ['response.output_item.done', { type: 'response.output_item.done', item: { type: 'message', role: 'assistant', id: 'synthetic-message', content: [{ type: 'output_text', text: 'ok' }] } }],
    ['response.completed', { type: 'response.completed', response: { id: 'synthetic-response', usage: { input_tokens: 1, input_tokens_details: null, output_tokens: 1, output_tokens_details: null, total_tokens: 2 } } }],
  ]);

async function syntheticSkillZip(root) {
  const zipDir = path.join(root, 'zip');
  await fs.mkdir(path.join(zipDir, SYNTHETIC_SYNC_SKILL), { recursive: true });
  await fs.writeFile(path.join(zipDir, SYNTHETIC_SYNC_SKILL, 'SKILL.md'), `---\nname: ${SYNTHETIC_SYNC_SKILL}\ndescription: Synthetic account skill\n---\nSynthetic.\n`);
  await run('zip', ['-qr', path.join(root, 'skill.zip'), SYNTHETIC_SYNC_SKILL], { cwd: zipDir });
  return fs.readFile(path.join(root, 'skill.zip'));
}

function accountSyncAnswer(endpoint, skillZip) {
  if (endpoint.startsWith('/api/eval')) return { features: Object.fromEntries(['tengu_claudeai_skills_sync_enabled', 'tengu_claudeai_plugins_sync_enabled'].map(name => [name, { defaultValue: true }])) };
  if (endpoint === '/api/oauth/profile') return { account: { uuid: SYNTHETIC_ACCOUNT_UUID, email: 'synthetic@example.invalid', has_claude_max: true }, organization: { uuid: SYNTHETIC_ORG_UUID, organization_type: 'claude_max', rate_limit_tier: 'default_claude_max_20x' } };
  if (endpoint === '/api/claude_code/policy_limits') return { restrictions: {} };
  if (endpoint.endsWith('/skills/list-skills')) return { skills: [{ id: SYNTHETIC_SYNC_SKILL, name: SYNTHETIC_SYNC_SKILL, description: 'Synthetic account skill', source: 'custom', creator_type: 'user', partition_by: 'account', enabled: true, updated_at: '2026-11-01T00:00:00Z' }] };
  if (endpoint.endsWith(`/skills/${SYNTHETIC_SYNC_SKILL}/download`)) return skillZip;
  if (endpoint.endsWith('/plugins/list-plugins')) return { plugins: [] };
  return null;
}

/**
 * Start the provider. `root` must be a private scratch directory.
 * @returns {Promise<{ proxy: string, ca: string, env: object, requests: string[], tunnels: Set<string>, refused: Set<string>, holdModels: Function, close: Function }>}
 */
export async function startSyntheticVendorProvider({ root, forceAccountSync = true, mitmHosts = SYNTHETIC_MITM_HOSTS, tunnelHosts = DOWNLOAD_TUNNEL_HOSTS, systemBundle = '/etc/ssl/certs/ca-certificates.crt' } = {}) {
  await fs.mkdir(root, { recursive: true });
  // A separate CA and leaf: rustls (Codex) rejects a self-signed CA:TRUE
  // certificate presented as the server certificate (CaUsedAsEndEntity).
  const ca = path.join(root, 'ca.pem');
  const file = name => path.join(root, name);
  await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=hive-synthetic-provider-ca', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-keyout', file('ca-key.pem'), '-out', ca]);
  await run('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=hive-synthetic-provider', '-keyout', file('key.pem'), '-out', file('leaf.csr')]);
  await fs.writeFile(file('leaf.ext'), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${mitmHosts.map(host => `DNS:${host}`).join(',')}\n`);
  await run('openssl', ['x509', '-req', '-in', file('leaf.csr'), '-CA', ca, '-CAkey', file('ca-key.pem'), '-CAcreateserial', '-days', '1', '-extfile', file('leaf.ext'), '-out', file('leaf.pem')]);
  const [key, cert, caCert] = await Promise.all([fs.readFile(file('key.pem')), fs.readFile(file('leaf.pem')), fs.readFile(ca)]);
  // Tunnelled download hosts keep their real certificates, so clients that
  // replace (rather than extend) their roots get the system bundle plus ours.
  const bundle = path.join(root, 'ca-bundle.pem');
  const system = await fs.readFile(systemBundle).catch(() => Buffer.alloc(0));
  await fs.writeFile(bundle, Buffer.concat([system, Buffer.from('\n'), caCert]));
  const skillZip = await syntheticSkillZip(root);
  const requests = [];
  const tunnels = new Set();
  const refused = new Set();
  const sockets = new Set();
  // A held model response keeps the native process alive for a measured
  // window, which is when background catalog/account sync runs.
  let hold = null;
  const server = http.createServer(async (request, response) => {
    for await (const _ of request);
    const endpoint = request.url.split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu, ':uuid');
    requests.push(`${request.method} ${request.socket.servername || 'plain'}${endpoint}`);
    const isClaudeModel = endpoint === '/v1/messages';
    const isCodexModel = /\/responses$/u.test(endpoint) && request.method === 'POST';
    if (isClaudeModel || isCodexModel) {
      if (hold) await hold;
      response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'close' });
      return response.end(isClaudeModel ? claudeMessage() : codexResponse());
    }
    // Codex 0.166+ resolves the workspace backend before its first model call.
    if (endpoint === '/backend-api/wham/accounts/check') {
      response.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      return response.end(JSON.stringify({ accounts: [{ id: SYNTHETIC_CHATGPT_ACCOUNT_ID, workspace_backend_origin: 'https://chatgpt.com', account_routing_override: 'NO_CONSTRAINT' }] }));
    }
    const forced = forceAccountSync ? accountSyncAnswer(endpoint, skillZip) : null;
    if (Buffer.isBuffer(forced)) {
      response.writeHead(200, { 'Content-Type': 'application/zip', Connection: 'close' });
      return response.end(forced);
    }
    response.writeHead(forced ? 200 : 404, { 'Content-Type': 'application/json', Connection: 'close' });
    response.end(forced ? JSON.stringify(forced) : '{"error":"synthetic"}');
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('connect', (request, socket, head) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    const [host, portText] = request.url.split(':');
    if (mitmHosts.includes(host)) {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) socket.unshift(head);
      const secure = new tls.TLSSocket(socket, { isServer: true, key, cert });
      secure.servername = host;
      secure.on('error', () => secure.destroy());
      server.emit('connection', secure);
      return;
    }
    if (!tunnelHosts.includes(host) || Number(portText || 443) !== 443) {
      refused.add(host);
      socket.end('HTTP/1.1 502 Synthetic provider refuses origin\r\n\r\n');
      return;
    }
    tunnels.add(host);
    const upstream = net.connect(443, host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    sockets.add(upstream);
    upstream.once('close', () => sockets.delete(upstream));
    upstream.on('error', () => socket.destroy());
  });
  // Codex opens the Responses API as a WebSocket first; refusing the upgrade
  // makes it fall back to the HTTPS stream answered above.
  server.on('upgrade', (request, socket) => {
    requests.push(`UPGRADE ${request.socket.servername || 'plain'}${request.url.split('?')[0]}`);
    socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const proxy = `http://127.0.0.1:${server.address().port}`;
  return {
    proxy,
    ca,
    requests,
    tunnels,
    refused,
    // Node, Bun, Rust (reqwest/rustls-native) and git all honour these.
    env: { HTTPS_PROXY: proxy, https_proxy: proxy, HTTP_PROXY: proxy, http_proxy: proxy, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', NODE_EXTRA_CA_CERTS: ca, SSL_CERT_FILE: bundle, CODEX_CA_CERTIFICATE: bundle, GIT_SSL_CAINFO: bundle },
    holdModels(promise) {
      hold = promise;
    },
    close: async () => {
      hold = null;
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
