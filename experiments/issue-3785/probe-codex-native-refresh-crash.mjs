// Real native CLI refresh against a finite synthetic loopback provider.
// Kill the owner after the provider consumes G0 but before publication.
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
import { setTimeout as delay } from 'node:timers/promises';

const binary = process.argv[2];
const negative = process.argv.includes('--expect-reused-predecessor');
const repairMalformed = process.argv.includes('--repair-malformed');
assert.ok(!negative || !repairMalformed, 'The repair check requires the repaired native CLI.');
assert.ok(binary && path.isAbsolute(binary), 'Supply the actual native Codex binary.');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-refresh-crash-'));
const children = [];
const exchanges = [];
const trace = [];
const backgroundPaths = new Set(['/backend-api/plugins/featured', '/backend-api/ps/plugins/installed', '/backend-api/wham/accounts/check', '/backend-api/wham/settings/user', '/backend-api/codex/analytics-events/events']);
let modelRequests = 0;
let invalidRequest = false;
let timer;
let firstConsumed;
let peerConsumed;
const consumed = new Promise(resolve => {
  firstConsumed = resolve;
});
const reconsumed = new Promise(resolve => {
  peerConsumed = resolve;
});
const server = http.createServer(async (request, response) => {
  try {
    trace.push({ http: request.url });
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      assert.ok(body.length <= 65536);
    }
    if (request.method === 'POST' && request.url === '/oauth/token') {
      const input = JSON.parse(body);
      assert.equal(input.grant_type, 'refresh_token');
      assert.equal(input.refresh_token, 'SYNTHETIC-REFRESH-G0');
      exchanges.push('G0');
      assert.ok(exchanges.length <= 4);
      if (exchanges.length === 1) {
        firstConsumed();
        // The provider has consumed G0. No response is delivered before death.
        return;
      }
      peerConsumed();
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end('{"error":"refresh_token_reused"}');
    } else if (request.method === 'POST' && request.url === '/v1/responses') {
      modelRequests++;
      assert.ok(modelRequests <= 4);
      response.writeHead(401, { 'content-type': 'application/json', connection: 'close' });
      response.end('{"error":{"message":"Synthetic unauthorized","code":"invalid_api_key"}}');
    } else if (request.method === 'GET' && new URL(request.url, 'http://fixture.invalid').pathname === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"models":[]}');
    } else if (backgroundPaths.has(new URL(request.url, 'http://fixture.invalid').pathname)) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{}');
    } else throw new Error('Unexpected synthetic endpoint.');
  } catch {
    invalidRequest = true;
    response.writeHead(400).end();
  }
});
server.requestTimeout = 3000;
server.headersTimeout = 3000;
server.on('connect', (request, socket) => {
  if (!['github.com:443', 'api.github.com:443', 'chatgpt.com:443', 'raw.githubusercontent.com:443'].includes(request.url)) invalidRequest = true;
  socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
});

async function start(index, canonical) {
  const home = path.join(root, `home-${index}`);
  const config = path.join(root, `config-${index}`);
  await fs.mkdir(home, { mode: 0o700 });
  await fs.mkdir(config, { mode: 0o700 });
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  await fs.writeFile(path.join(config, 'config.toml'), `model_provider="offline"\nchatgpt_base_url="${endpoint}/backend-api"\n[model_providers.offline]\nname="Offline"\nbase_url="${endpoint}/v1"\nmodel_catalog_url="${endpoint}/v1/models"\nwire_api="responses"\nrequires_openai_auth=true\n[features]\nremote_plugin=false\napps=false\n`, { mode: 0o600 });
  const env = { PATH: process.env.PATH, HOME: home, CODEX_HOME: config, CODEX_AUTH_HOME: canonical, CODEX_REFRESH_TOKEN_URL_OVERRIDE: `http://127.0.0.1:${server.address().port}/oauth/token`, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', TOKIO_WORKER_THREADS: '2', RUST_LOG: 'off', HTTP_PROXY: endpoint, HTTPS_PROXY: endpoint, ALL_PROXY: endpoint, NO_PROXY: '127.0.0.1,localhost', CODEX_AUTHAPI_BASE_URL: `${endpoint}/forbidden-auth`, CODEX_AGENT_IDENTITY_AUTHAPI_BASE_URL: `${endpoint}/forbidden-identity`, CODEX_AGENT_IDENTITY_JWKS_BASE_URL: `${endpoint}/forbidden-jwks` };
  const child = spawn('/usr/bin/prlimit', ['--data=536870912', '--stack=16777216', '--core=0', '--', binary, 'app-server'], { cwd: root, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let sequence = 0;
  const state = { initialized: false, refused: false, completed: false };
  let complete;
  const completion = new Promise(resolve => {
    complete = resolve;
  });
  const pending = new Map();
  const closed = new Promise(resolve => child.once('close', resolve));
  const fail = () => {
    for (const waiter of pending.values()) waiter.reject(new Error('Native synthetic protocol closed.'));
    pending.clear();
    complete();
  };
  child.once('error', fail);
  child.once('close', fail);
  child.stdin.on('error', fail);
  let diagnostic = '';
  child.stderr.on('data', chunk => {
    if (diagnostic.length < 8192) diagnostic += chunk.toString().slice(0, 8192 - diagnostic.length);
  });
  child.once('close', () => trace.push({ index, diagnostic }));
  let outputBytes = 0;
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    outputBytes += line.length;
    if (outputBytes > 524288) {
      process.kill(-child.pid, 'SIGKILL');
      fail();
      return;
    }
    try {
      const message = JSON.parse(line);
      if (trace.length < 200) trace.push({ index, method: message.method, id: message.id, error: message.error });
      if (message.method === 'turn/completed') {
        state.completed = true;
        complete();
      }
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) {
        state.refused = true;
        waiter.reject(new Error('Native synthetic request refused.'));
      } else waiter.resolve(message.result);
    } catch {
      fail();
    }
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      trace.push({ index, request: method });
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  let stopped;
  const client = {
    state,
    stop() {
      return (stopped ||= (async () => {
        lines.close();
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
        await closed;
      })());
    },
    async turn() {
      const initialized = await request('initialize', { clientInfo: { name: 'synthetic-refresh-crash', version: '0.0.0' }, capabilities: { experimentalApi: true } });
      assert.match(initialized.userAgent, /0\.164\.0/u);
      state.initialized = true;
      child.stdin.write('{"method":"initialized"}\n');
      const result = await request('thread/start', { cwd: root, model: 'synthetic-model', modelProvider: 'offline', approvalPolicy: 'never', sandbox: 'read-only', config: { features: { remote_plugin: false, apps: false }, model_providers: { offline: { name: 'Offline', model_catalog_url: `${endpoint}/v1/models`, base_url: `http://127.0.0.1:${server.address().port}/v1`, wire_api: 'responses', requires_openai_auth: true, request_max_retries: 0, stream_max_retries: 0 } } } });
      await request('turn/start', { threadId: result.thread.id, input: [{ type: 'text', text: 'Synthetic request. Do not invoke tools.' }] });
      await completion;
    },
  };
  children.push(client);
  return client;
}

async function repairWithNativeLogin(canonical) {
  const home = path.join(root, 'repair-home');
  const config = path.join(root, 'repair-config');
  await fs.mkdir(home, { mode: 0o700 });
  await fs.mkdir(config, { mode: 0o700 });
  const child = spawn('/usr/bin/prlimit', ['--data=536870912', '--stack=16777216', '--core=0', '--', binary, 'login', '--with-api-key'], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: config, CODEX_AUTH_HOME: canonical, TOKIO_WORKER_THREADS: '2', RUST_LOG: 'off' },
    detached: true,
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  let expired = false;
  let failure;
  const closed = new Promise(resolve => {
    child.once('error', error => {
      failure = error;
      resolve(null);
    });
    child.once('close', resolve);
  });
  const stop = () => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  const deadline = setTimeout(() => {
    expired = true;
    stop();
  }, 8000);
  child.stdin.on('error', () => {});
  child.stdin.end('SYNTHETIC-EXPLICIT-REPAIR-KEY\n');
  try {
    const code = await closed;
    assert.equal(expired, false, 'Explicit native login must finish within the finite probe budget.');
    assert.equal(failure, undefined, 'The actual native login must start.');
    assert.equal(code, 0, 'Explicit native login must repair safe malformed JSON after an uncertain refresh.');
  } finally {
    clearTimeout(deadline);
    stop();
    await closed;
  }
  assert.equal(JSON.parse(await fs.readFile(path.join(canonical, 'auth.json'), 'utf8')).OPENAI_API_KEY, 'SYNTHETIC-EXPLICIT-REPAIR-KEY');
  assert.equal(
    await fs.access(path.join(config, 'auth.json')).then(
      () => true,
      () => false
    ),
    false,
    'Native repair must not create a private credential copy.'
  );
}

try {
  const canonical = path.join(root, 'canonical');
  await fs.mkdir(canonical, { mode: 0o700 });
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const idToken = `${part({ alg: 'none' })}.${part({ email: 'synthetic@example.invalid', 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account', chatgpt_plan_type: 'plus' } })}.synthetic`;
  const original = JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: idToken, access_token: 'SYNTHETIC-ACCESS-G0', refresh_token: 'SYNTHETIC-REFRESH-G0', account_id: 'synthetic-account', login_owner_id: 'synthetic-login' }, last_refresh: '2020-01-01T00:00:00Z' });
  await fs.writeFile(path.join(canonical, 'auth.json'), original, { mode: 0o600 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Finite native crash experiment deadline exceeded.')), 25000);
  });
  const first = await start(0, canonical);
  const firstTurn = first.turn().catch(() => {});
  await Promise.race([
    consumed,
    firstTurn.then(() => {
      throw new Error('Native initial turn completed without reaching the refresh barrier.');
    }),
    deadline,
  ]);
  const lock = await fs.stat(path.join(canonical, '.hive-mind-refresh.lock'));
  await first.stop();
  await firstTurn;
  const initialModelRequests = modelRequests;
  assert.equal(await fs.readFile(path.join(canonical, 'auth.json'), 'utf8'), original);
  const peer = await start(1, canonical);
  const peerTurn = peer.turn().catch(() => {});
  await Promise.race([peerTurn, reconsumed, deadline]);
  await peer.stop();
  await peerTurn;
  assert.equal(invalidRequest, false);
  assert.equal((await fs.stat(path.join(canonical, '.hive-mind-refresh.lock'))).ino, lock.ino);
  if (negative) assert.ok(exchanges.length >= 2 && exchanges.length <= 4, 'The native negative control must actually consume G0 again.');
  else assert.deepEqual(exchanges, ['G0'], 'A peer must not consume G0 again after an unknown native refresh outcome.');
  if (!negative) {
    assert.equal(peer.state.initialized, true, 'The actual peer must initialize successfully.');
    assert.ok(peer.state.refused || peer.state.completed, 'A broken protocol or crashed peer cannot satisfy refusal.');
    assert.equal(modelRequests, initialModelRequests, 'Unresolved refresh intent must refuse peer model execution.');
    const intent = await fs.readFile(path.join(canonical, '.hive-mind-refresh-intent'));
    assert.equal(intent.length, 40, 'Uncertain outcome evidence must remain durable.');
    assert.equal(await fs.readFile(path.join(canonical, 'auth.json'), 'utf8'), original);
    if (repairMalformed) {
      await fs.writeFile(path.join(canonical, 'auth.json'), 'malformed synthetic JSON', { mode: 0o600 });
      await repairWithNativeLogin(canonical);
      assert.deepEqual(exchanges, ['G0'], 'Explicit native repair must never exchange the consumed predecessor.');
      assert.equal(modelRequests, initialModelRequests, 'Explicit native login must not execute a model request.');
      assert.deepEqual(await fs.readFile(path.join(canonical, '.hive-mind-refresh-intent')), intent, 'Only a subsequent generation reconciliation may clear uncertainty.');
      console.log('PASS: actual native explicit login repairs safe malformed credentials after owner death without reusing G0 or creating a private copy.');
    }
  }
  console.log(negative ? 'REPRODUCED: an actual native CLI peer exchanges consumed G0 again after owner death; the same lock inode survives.' : 'PASS: actual native CLI peer preserves unresolved intent and refuses a second G0 exchange or model request after owner death.');
} finally {
  clearTimeout(timer);
  await Promise.all(children.map(child => child.stop()));
  if (process.env.SYNTHETIC_DIAGNOSTIC_FILE) await fs.writeFile(process.env.SYNTHETIC_DIAGNOSTIC_FILE, JSON.stringify({ trace, exchanges, modelRequests, invalidRequest }), { mode: 0o600 });
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await delay(10);
  await fs.rm(root, { recursive: true, force: true });
}
