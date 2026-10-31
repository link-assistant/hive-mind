// Bounded real-CLI experiment, not a production auth adapter or release gate.
// It uses only disposable synthetic state and a network-disabled container.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rename, rm, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import os from 'node:os';
import path from 'node:path';

const execute = promisify(execFile);
const root = await mkdtemp(path.join(os.tmpdir(), 'hive-3785-appserver-'));
const name = `hive-3785-appserver-${process.pid}`;
const binary = process.env.CODEX_PROBE_BINARY || '/home/box/.bun/install/global/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex';
const task = path.join(root, 'task');
const canonical = path.join(root, 'canonical.json');
const jwt = generation => `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'synthetic-user', exp: Math.floor(Date.now() / 1000) + 3600, generation, 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account', chatgpt_user_id: 'synthetic-user', chatgpt_plan_type: 'pro' } })).toString('base64url')}.synthetic`;
const generations = [jwt(0), jwt(1)];
const pending = new Map();
const trace = event => {
  if (process.env.HIVE_3785_PROBE_VERBOSE === '1') console.error(event);
};
let sequence = 0;
let callbacks = 0;
let child;
let timer;
let completed;
const turnDone = new Promise(resolve => {
  completed = resolve;
});
const deadline = new Promise((_, reject) => {
  timer = setTimeout(() => reject(new Error('Finite app-server probe deadline exceeded.')), 45000);
});
const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
const request = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    send({ id, method, params });
  });
try {
  await mkdir(path.join(task, 'home', '.codex'), { recursive: true });
  await mkdir(path.join(task, 'project'));
  await writeFile(canonical, JSON.stringify({ generation: 0, accessToken: generations[0] }), { mode: 0o600 });
  for (const [index, token] of generations.entries()) await writeFile(path.join(task, `g${index}.bearer`), token, { mode: 0o600 });
  const args = ['run', '--rm', '-i', '--name', name, '--cgroup-parent', '/', '--pids-limit', '64', '--network', 'none', '--user', `${process.getuid()}:${process.getgid()}`, '--ulimit', 'data=536870912:536870912', '--mount', `type=bind,source=${binary},target=/usr/local/bin/codex,readonly`, '--mount', `type=bind,source=${task},target=/probe`, '--mount', `type=bind,source=${path.resolve('experiments/issue-3785/appserver-auth-stub.sh')},target=/handler.sh,readonly`, '-e', 'HOME=/probe/home', '-e', 'CODEX_HOME=/probe/home/.codex', '-e', 'TOKIO_WORKER_THREADS=2', 'alpine:3.22', 'sh', '-c', 'nc -lk -p 18486 -e /handler.sh & exec codex -c features.remote_plugin=false app-server'];
  child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume();
  child.on('error', () => completed(new Error('Unable to start disposable CLI container.')));
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    void (async () => {
      const message = JSON.parse(line);
      trace(`app-server: ${message.method || 'response'}${message.error ? ` error=${message.error.code}` : ''}`);
      if (message.method === 'turn/completed') {
        trace(`turn error kind: ${JSON.stringify(message.params?.turn?.error?.codexErrorInfo ?? null)}`);
        // This isolated probe only sees synthetic input. Redact the two token
        // values even in opt-in local debugging; never print the RPC payload.
        trace(
          `turn error: ${String(message.params?.turn?.error?.message || '')
            .replaceAll(generations[0], '<synthetic-token>')
            .replaceAll(generations[1], '<synthetic-token>')}`
        );
      }
      if (message.method === 'account/chatgptAuthTokens/refresh') {
        callbacks++;
        assert.ok(message.params.reason === 'unauthorized', 'callback must be caused by the synthetic 401');
        const stored = JSON.parse(await readFile(canonical, 'utf8'));
        assert.ok(stored.generation === 0, 'single-client experiment must rotate its initial generation once');
        await writeFile(`${canonical}.new`, JSON.stringify({ generation: 1, accessToken: generations[1] }), { mode: 0o600 });
        await rename(`${canonical}.new`, canonical);
        send({ id: message.id, result: { accessToken: generations[1], chatgptAccountId: 'synthetic-account', chatgptPlanType: 'pro' } });
      } else if (message.id !== undefined && pending.has(message.id)) {
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(`App-server rejected probe request with code ${message.error.code}.`));
        else waiter.resolve(message.result);
      } else if (message.method === 'turn/completed') completed(null);
    })().catch(error => completed(error));
  });
  await Promise.race([
    deadline,
    (async () => {
      await request('initialize', { clientInfo: { name: 'hive-3785-synthetic-probe', version: '0.0.0' }, capabilities: { experimentalApi: true } });
      send({ method: 'initialized' });
      await request('account/login/start', { type: 'chatgptAuthTokens', accessToken: generations[0], chatgptAccountId: 'synthetic-account', chatgptPlanType: 'pro' });
      const thread = await request('thread/start', { cwd: '/probe/project', model: 'synthetic-model', modelProvider: 'offline', approvalPolicy: 'never', sandbox: 'read-only', config: { model_providers: { offline: { name: 'Offline', base_url: 'http://127.0.0.1:18486/v1', wire_api: 'responses', requires_openai_auth: true, request_max_retries: 0, stream_max_retries: 0 } } } });
      await request('turn/start', { threadId: thread.thread.id, input: [{ type: 'text', text: 'Do not invoke tools. Exit.' }] });
      const error = await turnDone;
      if (error) throw error;
      assert.ok(callbacks === 1, 'real CLI must request exactly one external token refresh');
      const events = (await readFile(path.join(task, 'events'), 'utf8')).trim().split('\n');
      assert.deepEqual(events, ['model-rejected-g0', 'model-observed-g1']);
      assert.ok(JSON.parse(await readFile(canonical, 'utf8')).generation === 1, 'external owner must commit the replacement generation');
      await assert.rejects(stat(path.join(task, 'home', '.codex', 'auth.json')), { code: 'ENOENT' });
      console.log('OBSERVED: real app-server requested an external refresh after a local synthetic 401.');
      console.log('Its next model request used the externally committed generation; no native auth.json was created.');
      console.log('This internal, unstable interface is not integrated into Hive Mind; concurrency, login/logout and full history remain unverified.');
    })(),
  ]);
} finally {
  clearTimeout(timer);
  child?.stdin.end();
  await execute('docker', ['rm', '-f', name]).catch(() => {});
  if (child && child.exitCode === null) await new Promise(resolve => child.once('close', resolve));
  await rm(root, { recursive: true, force: true });
}
