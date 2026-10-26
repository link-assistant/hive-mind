// Actual model requests from two long-lived pinned native CLI processes.
// Only synthetic credentials, private homes and a bounded loopback provider.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { setTimeout, clearTimeout } from 'node:timers';

const binary = process.argv[2];
const uncoordinated = process.argv.includes('--expect-uncoordinated');
const unauthenticatedLogout = process.argv.includes('--expect-unauthenticated-logout');
const providerOverrides = process.argv.includes('--provider-overrides');
const expectProviderOverrides = process.argv.includes('--expect-provider-overrides');
assert.ok(!expectProviderOverrides || providerOverrides, 'Provider override controls require --provider-overrides.');
assert.ok(!uncoordinated || !unauthenticatedLogout, 'Select only one native negative control.');
assert.ok(binary && path.isAbsolute(binary), 'Supply an absolute native Codex binary path.');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-native-requests-'));
const clients = [];
const observed = [];
let invalidRequest = false;
const server = http.createServer(async (request, response) => {
  try {
    let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      assert.ok(bytes <= 256 * 1024, 'Synthetic model requests are bounded.');
    }
    if (request.method === 'POST' && request.url === '/v1/responses') {
      const header = request.headers.authorization;
      observed.push(request.headers['openai-organization'] === 'synthetic-organization' ? 'G2-organization' : request.headers['openai-project'] === 'synthetic-project' ? 'G2-project' : request.headers['x-api-key'] === 'sk-SYNTHETIC-G2' ? 'G2-extra' : ['G0', 'G1', 'G2'].find(generation => header === `Bearer sk-SYNTHETIC-${generation}` || header === `Bearer SYNTHETIC-ACCESS-${generation}`) || (header ? 'unexpected' : 'absent'));
      response.writeHead(503, { 'content-type': 'application/json', connection: 'close' });
      response.end('{"error":{"message":"Synthetic model deliberately unavailable","code":"offline"}}');
    } else if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"data":[]}');
    } else throw new Error('Unexpected synthetic endpoint.');
  } catch {
    invalidRequest = true;
    response.writeHead(400);
    response.end();
  }
});
server.requestTimeout = 3000;
server.headersTimeout = 3000;

async function startClient({ home, config, canonical, provider = {}, providerEnv = {} }) {
  await fs.mkdir(home, { mode: 0o700 });
  await fs.mkdir(config, { mode: 0o700, recursive: true });
  await fs.writeFile(path.join(config, 'config.toml'), '[features]\nremote_plugin=false\n', { mode: 0o600 });
  const env = { PATH: process.env.PATH, HOME: home, CODEX_HOME: config, CODEX_AUTH_HOME: canonical, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', TOKIO_WORKER_THREADS: '2', RUST_LOG: 'off', ...providerEnv };
  const child = spawn('prlimit', ['--data=536870912', '--stack=16777216', '--core=0', '--', binary, 'app-server'], { cwd: root, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const killGroup = () => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  const closed = new Promise(resolve => child.once('close', resolve));
  const pending = new Map();
  let sequence = 0;
  let turn;
  const fail = message => {
    const error = new Error(message);
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    turn?.reject(error);
    turn = null;
  };
  child.once('error', () => fail('Native process could not start.'));
  child.once('close', () => fail('Native process closed before completion.'));
  child.stdin.on('error', () => fail('Native protocol input closed.'));
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    try {
      const message = JSON.parse(line);
      if (message.method === 'turn/completed') {
        turn?.resolve();
        turn = null;
      }
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`Native request rejected (${message.error.code}).`));
      else waiter.resolve(message.result);
    } catch {
      fail('Native protocol output was malformed.');
    }
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  const timer = setTimeout(() => {
    fail('Finite native model-request deadline exceeded.');
    killGroup();
  }, 45_000);
  let stopped;
  const client = {
    stop() {
      return (stopped ||= (async () => {
        clearTimeout(timer);
        lines.close();
        child.stdin.end();
        killGroup();
        await closed;
      })());
    },
    async modelRequest() {
      const before = observed.length;
      const completion = new Promise((resolve, reject) => {
        turn = { resolve, reject };
      });
      await Promise.all([completion, request('turn/start', { threadId: client.threadId, input: [{ type: 'text', text: 'Synthetic request. Do not invoke tools.' }] })]);
      return observed.slice(before);
    },
  };
  clients.push(client);
  const initialized = await request('initialize', { clientInfo: { name: 'hive-3785-native-request-probe', version: '0.0.0' }, capabilities: { experimentalApi: true } });
  assert.match(initialized.userAgent, /0\.164\.0/u);
  child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
  const result = await request('thread/start', { cwd: root, model: 'synthetic-model', modelProvider: 'offline', approvalPolicy: 'never', sandbox: 'read-only', config: { features: { remote_plugin: false }, model_providers: { offline: { name: 'Offline', base_url: `http://127.0.0.1:${server.address().port}/v1`, wire_api: 'responses', requires_openai_auth: true, request_max_retries: 0, stream_max_retries: 0, ...provider } } } });
  client.threadId = result.thread.id;
  return client;
}

try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  for (const mode of providerOverrides ? ['provider-routes'] : ['api-key', 'chatgpt']) {
    const canonical = path.join(root, mode);
    await fs.mkdir(canonical, { mode: 0o700 });
    const auth = path.join(canonical, 'auth.json');
    if (providerOverrides) {
      await fs.writeFile(auth, JSON.stringify({ OPENAI_API_KEY: 'sk-SYNTHETIC-G0' }), { mode: 0o600 });
      const routes = [
        { name: 'provider-env', provider: { env_key: 'HIVE_SYNTHETIC_PROVIDER_KEY' }, providerEnv: { HIVE_SYNTHETIC_PROVIDER_KEY: 'sk-SYNTHETIC-G2' }, observed: 'G2' },
        { name: 'provider-bearer', provider: { experimental_bearer_token: 'sk-SYNTHETIC-G2' }, observed: 'G2' },
        { name: 'provider-no-auth', provider: { requires_openai_auth: false }, observed: 'absent' },
        { name: 'provider-header', provider: { requires_openai_auth: false, http_headers: { Authorization: 'Bearer sk-SYNTHETIC-G2' } }, observed: 'G2' },
        { name: 'provider-extra-header', provider: { http_headers: { 'X-Api-Key': 'sk-SYNTHETIC-G2' } }, observed: 'G2-extra' },
        { name: 'provider-env-header', provider: { env_http_headers: { 'X-Api-Key': 'HIVE_SYNTHETIC_PROVIDER_KEY' } }, providerEnv: { HIVE_SYNTHETIC_PROVIDER_KEY: 'sk-SYNTHETIC-G2' }, observed: 'G2-extra' },
        { name: 'provider-organization', provider: { env_http_headers: { 'OpenAI-Organization': 'OPENAI_ORGANIZATION' } }, providerEnv: { OPENAI_ORGANIZATION: 'synthetic-organization' }, observed: 'G2-organization' },
        { name: 'provider-project', provider: { env_http_headers: { 'OpenAI-Project': 'OPENAI_PROJECT' } }, providerEnv: { OPENAI_PROJECT: 'synthetic-project' }, observed: 'G2-project' },
        { name: 'stock-version-header', provider: { http_headers: { version: '0.164.0' } }, allowed: true },
        { name: 'stock-unset-identity-headers', provider: { env_http_headers: { 'OpenAI-Organization': 'OPENAI_ORGANIZATION', 'OpenAI-Project': 'OPENAI_PROJECT' } }, allowed: true },
      ];
      for (const route of routes) {
        const client = await startClient({ home: path.join(root, `${route.name}-home`), config: path.join(root, `${route.name}-config`), canonical, ...route });
        assert.deepEqual(await client.modelRequest(), route.allowed ? ['G0'] : expectProviderOverrides ? [route.observed] : [], 'An alternate provider must not bypass selected canonical authority; stock metadata must remain usable.');
        await client.stop();
        console.log(`PASS: ${route.name} ${route.allowed ? 'preserves canonical model execution' : expectProviderOverrides ? 'reproduces an alternate native authority' : 'refuses an alternate native authority before model execution'}.`);
      }
      continue;
    }
    const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const idToken = `${part({ alg: 'none' })}.${part({ email: 'synthetic@example.invalid', 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account', chatgpt_user_id: 'synthetic-user', chatgpt_plan_type: 'plus' } })}.synthetic`;
    const generation = value => (mode === 'api-key' ? { OPENAI_API_KEY: `sk-SYNTHETIC-${value}` } : { auth_mode: 'chatgpt', tokens: { id_token: idToken, access_token: `SYNTHETIC-ACCESS-${value}`, refresh_token: `SYNTHETIC-REFRESH-${value}`, account_id: 'synthetic-account', login_owner_id: 'synthetic-login' }, last_refresh: new Date().toISOString() });
    const commit = async value => {
      await fs.writeFile(`${auth}.next`, JSON.stringify(generation(value)), { mode: 0o600 });
      await fs.rename(`${auth}.next`, auth);
    };
    await commit('G0');
    const peers = [];
    for (const index of [0, 1]) {
      const client = await startClient({ home: path.join(root, `${mode}-home-${index}`), config: uncoordinated ? canonical : path.join(root, `${mode}-config-${index}`), canonical });
      peers.push(client);
      assert.deepEqual(await client.modelRequest(), ['G0'], 'Every live native client must first make a real model request with G0.');
    }
    console.log(`CHECK: ${mode} both live clients made their initial G0 model request.`);
    await commit('G1');
    for (const client of peers) assert.deepEqual(await client.modelRequest(), [uncoordinated && mode === 'api-key' ? 'G0' : 'G1'], 'The next actual model request must observe canonical atomic replacement.');
    console.log(`CHECK: ${mode} both live clients completed replacement requests.`);
    if (!uncoordinated) {
      await fs.writeFile(`${auth}.next`, '{malformed synthetic authority', { mode: 0o600 });
      await fs.rename(`${auth}.next`, auth);
      for (const client of peers) assert.deepEqual(await client.modelRequest(), unauthenticatedLogout ? ['absent'] : [], 'Malformed canonical auth must stop execution before a model request.');
      await commit('G1');
      await fs.chmod(auth, 0o644);
      for (const client of peers) assert.deepEqual(await client.modelRequest(), unauthenticatedLogout ? ['absent'] : [], 'Unsafe canonical auth permissions must stop execution before a model request.');
      await fs.chmod(auth, 0o600);
      for (const client of peers) assert.deepEqual(await client.modelRequest(), ['G1'], 'Refused authority must not prevent the live peer from reading a repaired canonical generation.');
      console.log(`CHECK: ${mode} both live clients completed malformed, unsafe and repaired-authority requests.`);
    }
    await fs.unlink(auth);
    for (const client of peers) {
      const events = await client.modelRequest();
      if (uncoordinated) assert.deepEqual(events, [mode === 'api-key' ? 'G0' : 'G1'], 'The negative control must demonstrate a stale authorized model request after logout.');
      else if (unauthenticatedLogout) assert.deepEqual(events, ['absent'], 'The intermediate native client must reproduce an unauthenticated model request after logout.');
      else assert.deepEqual(events, [], 'Logout must stop execution before making a model request.');
    }
    console.log(`CHECK: ${mode} both live clients completed logout requests.`);
    await commit('G2');
    for (const client of peers) assert.deepEqual(await client.modelRequest(), [uncoordinated && mode === 'api-key' ? 'G0' : 'G2'], 'Live peers must observe authority recreation on their next request.');
    await Promise.all(peers.map(client => client.stop()));
    if (!uncoordinated) for (const index of [0, 1]) await assert.rejects(fs.access(path.join(root, `${mode}-config-${index}`, 'auth.json')), { code: 'ENOENT' });
    console.log(`PASS: ${mode} actual model requests ${uncoordinated ? 'reproduce stale native authorization after logout' : unauthenticatedLogout ? 'reproduce unauthenticated execution after logout' : 'observe replacement, refuse logout and observe recreation'} in two live CLI processes.`);
  }
  assert.equal(invalidRequest, false, 'Only declared local synthetic endpoints may be used.');
} finally {
  await Promise.allSettled(clients.map(client => client.stop()));
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
