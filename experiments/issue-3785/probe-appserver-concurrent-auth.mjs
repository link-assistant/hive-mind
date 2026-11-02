// Two actual pinned app servers with disposable synthetic external auth.
// Run --without-lock to reproduce consumed-predecessor reuse in the adapter.
// This is not integrated with Hive Mind's native exec path or opaque host CLIs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { fileURLToPath, URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { setTimeout, clearTimeout } from 'node:timers';
import { Buffer } from 'node:buffer';
import console from 'node:console';

const execute = promisify(execFile);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-concurrent-external-'));
const authority = path.join(root, 'authority');
const locked = !process.argv.includes('--without-lock');
const binary = process.env.CODEX_PROBE_BINARY || '/home/box/.bun/install/global/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex';
const jwt = generation => `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'synthetic-user', exp: Math.floor(Date.now() / 1000) + 3600, generation, 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account', chatgpt_user_id: 'synthetic-user', chatgpt_plan_type: 'pro' } })).toString('base64url')}.synthetic`;
const tokens = [jwt(0), jwt(1)];
const clients = [];
const workers = [];
let callbacks = 0;
let exchanges = 0;
let consumed = false;
let lockIdentity;
let releaseCallbacks;
let releaseExchanges;
const bothCallbacks = new Promise(resolve => {
  releaseCallbacks = resolve;
});
const bothExchanges = new Promise(resolve => {
  releaseExchanges = resolve;
});
let timer;
let failed;
const failure = new Promise((_, reject) => {
  failed = reject;
});
const server = http.createServer((request, response) => {
  void (async () => {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      assert.ok(body.length <= 4096);
    }
    assert.equal(JSON.parse(body).refreshToken, 'synthetic-refresh-g0');
    exchanges++;
    if (exchanges === 2) releaseExchanges();
    await bothCallbacks;
    if (!locked) await bothExchanges;
    response.setHeader('content-type', 'application/json');
    if (consumed) {
      response.writeHead(409);
      response.end('{"error":"synthetic-predecessor-reuse"}');
    } else {
      consumed = true;
      response.end(JSON.stringify({ synthetic: true, generation: 1, accessToken: tokens[1], refreshToken: 'synthetic-refresh-g1' }));
    }
  })().catch(() => {
    response.writeHead(500);
    response.end('{}');
    failed(new Error('Synthetic refresh provider failed.'));
  });
});

async function verifyOwnerDeath() {
  const name = `hive-3785-lock-owner-${randomUUID()}`;
  const args = ['--cgroup-parent', '/', '--pids-limit', '16', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', `${process.getuid()}:${process.getgid()}`, '--mount', `type=bind,source=${authority},target=/authority`];
  const ready = path.join(authority, 'owner-ready');
  try {
    await execute('docker', ['run', '--detach', '--name', name, ...args, 'node:24-alpine', 'flock', '-x', '/authority/refresh.lock', 'sh', '-c', 'printf ready > /authority/owner-ready; exec sleep 30']);
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await fs.stat(ready).catch(() => null)) break;
      await delay(100);
    }
    await fs.access(ready);
    const peer = ['run', '--rm', ...args, 'node:24-alpine', 'flock', '-n', '/authority/refresh.lock', 'true'];
    await assert.rejects(execute('docker', peer), error => error.code === 1);
    await execute('docker', ['rm', '-f', name]);
    await execute('docker', peer);
    console.log('PASS: a live container owner excludes its peer; forced owner removal releases the same lock inode.');
  } finally {
    await execute('docker', ['rm', '-f', name]).catch(() => {});
    await fs.rm(ready, { force: true });
  }
}

function startClient(index) {
  const task = path.join(root, `task-${index}`);
  const name = `hive-3785-external-${randomUUID()}`;
  // A 1 GiB data limit permits V8's virtual CodeRange reservation; callback
  // workers separately cap the JS heap at 64 MiB. No host credentials or env.
  const args = [
    'run',
    '--rm',
    '-i',
    '--name',
    name,
    '--cgroup-parent',
    '/',
    '--pids-limit',
    '64',
    '--network',
    'none',
    '--user',
    `${process.getuid()}:${process.getgid()}`,
    '--ulimit',
    'data=1073741824:1073741824',
    '--mount',
    `type=bind,source=${binary},target=/usr/local/bin/codex,readonly`,
    '--mount',
    `type=bind,source=${task},target=/probe`,
    '--mount',
    `type=bind,source=${authority},target=/authority`,
    '--mount',
    `type=bind,source=${fileURLToPath(new URL('appserver-auth-stub.sh', import.meta.url))},target=/handler.sh,readonly`,
    '--mount',
    `type=bind,source=${fileURLToPath(new URL('appserver-refresh-worker.mjs', import.meta.url))},target=/adapter.mjs,readonly`,
    '--mount',
    `type=bind,source=${fileURLToPath(new URL('../../src/shared-auth-refresh-lock.lib.mjs', import.meta.url))},target=/src/shared-auth-refresh-lock.lib.mjs,readonly`,
    '-e',
    `HIVE_SYNTHETIC_LOCKED=${locked ? '1' : '0'}`,
    '-e',
    'HOME=/probe/home',
    '-e',
    'CODEX_HOME=/probe/home/.codex',
    '-e',
    'TOKIO_WORKER_THREADS=2',
    '-e',
    'HIVE_SYNTHETIC_AUTH_PROBE=1',
    'node:24-alpine',
    'sh',
    '-c',
    "codex --version | grep -Ex 'codex(-cli)? 0[.]164[.]0' >/dev/null || exit 1; nc -lk -p 18486 -e /handler.sh & exec codex -c features.remote_plugin=false app-server",
  ];
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let sequence = 0;
  let complete;
  const done = new Promise(resolve => {
    complete = resolve;
  });
  const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      send({ id, method, params });
    });
  child.stderr.resume();
  child.stdin.on('error', () => failed(new Error('Disposable app-server input closed.')));
  child.on('error', () => failed(new Error('Disposable app server did not start.')));
  child.on('close', () => complete());
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    const operation = (async () => {
      const message = JSON.parse(line);
      if (message.method === 'account/chatgptAuthTokens/refresh') {
        assert.equal(message.params.reason, 'unauthorized');
        callbacks++;
        if (callbacks === 2) releaseCallbacks();
        // Each callback uses the packaged OS-lock primitive in its own PID
        // namespace, then rereads G under the same host-backed lock inode.
        const command = ['exec', name, 'node', '--max-old-space-size=64', '/adapter.mjs', '0'];
        const { stdout } = await execute('docker', command, { maxBuffer: 16384 }).catch(async error => {
          await fs.writeFile('/tmp/issue-3785-concurrent-external-worker.log', error.stderr || 'Synthetic worker failed.', { mode: 0o600 });
          throw new Error('Synthetic worker failed; inspect the private local worker log.');
        });
        const selected = JSON.parse(stdout);
        assert.equal(selected.identity, lockIdentity);
        send({ id: message.id, result: selected.credentials });
      } else if (message.id !== undefined && pending.has(message.id)) {
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error('Native app server rejected a synthetic request.'));
        else waiter.resolve(message.result);
      } else if (message.method === 'turn/completed') complete();
    })();
    workers.push(operation);
    void operation.catch(() => failed(new Error('Synthetic external refresh callback failed.')));
  });
  return { name, task, child, send, request, done };
}

try {
  await fs.mkdir(authority, { mode: 0o700 });
  await fs.writeFile(path.join(authority, 'state.json'), JSON.stringify({ synthetic: true, generation: 0, accessToken: tokens[0], refreshToken: 'synthetic-refresh-g0' }), { mode: 0o600 });
  await fs.writeFile(path.join(authority, 'refresh.lock'), '', { mode: 0o600 });
  const lock = await fs.stat(path.join(authority, 'refresh.lock'), { bigint: true });
  lockIdentity = `${lock.dev}:${lock.ino}`;
  if (locked) await verifyOwnerDeath();
  await new Promise(resolve => server.listen(path.join(authority, 'provider.sock'), resolve));
  await fs.chmod(path.join(authority, 'provider.sock'), 0o600);
  for (let index = 0; index < 2; index++) {
    const task = path.join(root, `task-${index}`);
    await fs.mkdir(path.join(task, 'home', '.codex'), { recursive: true });
    await fs.mkdir(path.join(task, 'project'));
    for (const [generation, token] of tokens.entries()) await fs.writeFile(path.join(task, `g${generation}.bearer`), token, { mode: 0o600 });
    clients.push(startClient(index));
  }
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Finite concurrent app-server probe deadline exceeded.')), 45000);
  });
  await Promise.race([
    failure,
    deadline,
    (async () => {
      await Promise.all(
        clients.map(async client => {
          await client.request('initialize', { clientInfo: { name: 'hive-3785-synthetic-probe', version: '0.0.0' }, capabilities: { experimentalApi: true } });
          client.send({ method: 'initialized' });
          await client.request('account/login/start', { type: 'chatgptAuthTokens', accessToken: tokens[0], chatgptAccountId: 'synthetic-account', chatgptPlanType: 'pro' });
          const thread = await client.request('thread/start', { cwd: '/probe/project', model: 'synthetic-model', modelProvider: 'offline', approvalPolicy: 'never', sandbox: 'read-only', config: { model_providers: { offline: { name: 'Offline', base_url: 'http://127.0.0.1:18486/v1', wire_api: 'responses', requires_openai_auth: true, request_max_retries: 0, stream_max_retries: 0 } } } });
          await client.request('turn/start', { threadId: thread.thread.id, input: [{ type: 'text', text: 'Do not invoke tools. Exit.' }] });
          await client.done;
        })
      );
      assert.equal(callbacks, 2);
      assert.equal(exchanges, 1, 'A consumed synthetic predecessor was exchanged twice.');
      for (const client of clients) {
        assert.deepEqual((await fs.readFile(path.join(client.task, 'events'), 'utf8')).trim().split('\n'), ['model-rejected-g0', 'model-observed-g1']);
        await assert.rejects(fs.stat(path.join(client.task, 'home', '.codex', 'auth.json')), { code: 'ENOENT' });
      }
      assert.equal(JSON.parse(await fs.readFile(path.join(authority, 'state.json'), 'utf8')).generation, 1);
      console.log('PASS: two native app-server callbacks share a lock across containers; only one synthetic G0 exchange occurs.');
      console.log('PASS: both next native requests use committed G1 without creating a private native auth.json.');
      console.log('LIMIT: experimental callback adapter only; native exec/host writers, lifecycle and full history remain unimplemented.');
    })(),
  ]);
} catch {
  console.error(`Synthetic concurrent callback probe failed (callbacks=${callbacks}, exchanges=${exchanges}, lock=${locked}).`);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  for (const client of clients) client.child.stdin.end();
  await Promise.allSettled(clients.map(client => execute('docker', ['rm', '-f', client.name])));
  await Promise.allSettled(clients.map(client => (client.child.exitCode === null ? new Promise(resolve => client.child.once('close', resolve)) : Promise.resolve())));
  await Promise.allSettled(workers);
  await fs.rm(root, { recursive: true, force: true });
}
