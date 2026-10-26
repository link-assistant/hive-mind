// Real codex-login processes, disposable state, and a loopback rotating provider.
// Run each case against the uncoordinated source before applying the repair.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';

const binary = process.argv[2];
const scenario = process.argv[3];
const uncoordinated = process.argv[4] === '--expect-uncoordinated';
assert.ok(binary && path.isAbsolute(binary), 'Supply the native manager probe binary.');
assert.ok(['replacement', 'logout', 'refresh', 'refresh-login', 'refresh-logout'].includes(scenario), 'Select a finite lifecycle case.');
const writerRace = scenario.startsWith('refresh-');
const oauth = scenario === 'refresh' || writerRace;
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-native-manager-'));
const children = [];
const requests = [];
let consumed = false;
let invalidRequest = false;
let watchdog;
let releaseExchange;
const exchangeRelease = new Promise(resolve => {
  releaseExchange = resolve;
});
const waitUntil = async (condition, description) => {
  const deadline = Date.now() + 15_000;
  while (!(await condition())) {
    assert.ok(Date.now() < deadline, description);
    await delay(10);
  }
};
const server = http.createServer(async (request, response) => {
  let body = '';
  try {
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 16_384) throw new Error('Oversized synthetic request.');
    }
    const data = JSON.parse(body);
    if (request.method !== 'POST' || request.url !== '/oauth/token' || data.grant_type !== 'refresh_token' || data.refresh_token !== 'SYNTHETIC-REFRESH-G0') throw new Error('Unexpected synthetic request.');
    requests.push('G0');
    const accepted = !consumed;
    consumed = true;
    // Keep the first real native exchange outstanding while a peer competes.
    if (writerRace) await exchangeRelease;
    else if (uncoordinated) await waitUntil(() => requests.length === 2, 'Both uncoordinated native processes must exchange G0.');
    else await delay(150);
    response.writeHead(accepted ? 200 : 401, { 'content-type': 'application/json' });
    response.end(JSON.stringify(accepted ? { access_token: 'SYNTHETIC-ACCESS-G1', refresh_token: 'SYNTHETIC-REFRESH-G1', token_type: 'Bearer' } : { error: 'refresh_token_reused' }));
  } catch {
    invalidRequest = true;
    response.writeHead(400);
    response.end();
  }
});
server.requestTimeout = 3000;
server.headersTimeout = 3000;
const finish = async child => {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await child.completed;
};
try {
  const canonical = path.join(root, 'canonical');
  const auth = path.join(canonical, 'auth.json');
  await fs.mkdir(canonical, { mode: 0o700 });
  const jwtPart = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const idToken = `${jwtPart({ alg: 'none' })}.${jwtPart({ email: 'synthetic@example.invalid', 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account', chatgpt_user_id: 'synthetic-user', chatgpt_plan_type: 'plus' } })}.synthetic`;
  const original = oauth ? { auth_mode: 'chatgpt', tokens: { id_token: idToken, access_token: 'SYNTHETIC-ACCESS-G0', refresh_token: 'SYNTHETIC-REFRESH-G0', account_id: 'synthetic-account', login_owner_id: 'synthetic-login' }, last_refresh: new Date().toISOString() } : { OPENAI_API_KEY: 'sk-SYNTHETIC-G0' };
  await fs.writeFile(auth, JSON.stringify(original), { mode: 0o600 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const releases = [0, 1].map(index => path.join(root, `release-${index}`));
  for (const index of [0, 1]) {
    const home = path.join(root, `home-${index}`);
    const config = path.join(root, `config-${index}`);
    const ready = path.join(root, `ready-${index}`);
    await fs.mkdir(home, { mode: 0o700 });
    await fs.mkdir(config, { mode: 0o700 });
    const env = { PATH: process.env.PATH, HOME: home, CODEX_HOME: config, CODEX_AUTH_HOME: canonical, SYNTHETIC_READY: ready, SYNTHETIC_RELEASE: releases[index], SYNTHETIC_STARTED: path.join(root, `started-${index}`), SYNTHETIC_EXPECT_ROTATED: writerRace ? '0' : '1', CODEX_REFRESH_TOKEN_URL_OVERRIDE: `http://127.0.0.1:${server.address().port}/oauth/token`, RUST_LOG: 'off', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    const mode = writerRace && index === 1 ? (scenario === 'refresh-login' ? 'write-login' : 'write-logout') : scenario === 'replacement' ? 'read-replacement' : scenario === 'logout' ? 'read-logout' : 'refresh';
    const child = spawn('prlimit', ['--data=536870912', '--stack=16777216', '--core=0', '--', binary, mode], { cwd: home, env, stdio: 'ignore' });
    child.completed = new Promise(resolve => {
      child.once('error', () => resolve({ code: -1 }));
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    children.push(child);
    const deadline = Date.now() + 15_000;
    while (
      !(await fs.access(ready).then(
        () => true,
        () => false
      ))
    ) {
      assert.ok(child.exitCode === null && child.signalCode === null && Date.now() < deadline, 'Native process failed before its synthetic barrier.');
      await delay(10);
    }
  }
  if (scenario === 'replacement') {
    await fs.writeFile(`${auth}.next`, JSON.stringify({ OPENAI_API_KEY: 'sk-SYNTHETIC-G1' }), { mode: 0o600 });
    await fs.rename(`${auth}.next`, auth);
  } else if (scenario === 'logout') await fs.unlink(auth);
  watchdog = globalThis.setTimeout(() => children.forEach(child => child.kill('SIGKILL')), 15_000);
  await fs.writeFile(releases[0], 'release', { mode: 0o600 });
  if (writerRace) await waitUntil(() => requests.length === 1, 'Native refresh must reach the paused provider before the competing write.');
  await fs.writeFile(releases[1], 'release', { mode: 0o600 });
  if (writerRace) {
    if (uncoordinated) {
      assert.equal((await children[1].completed).code, 0, 'The negative-control writer must commit while the provider is paused.');
    } else {
      await waitUntil(
        () =>
          fs.access(path.join(root, 'started-1')).then(
            () => true,
            () => false
          ),
        'The native writer must attempt its transaction before exchange completion.'
      );
      await delay(100);
      assert.equal(children[1].exitCode, null, 'A native writer must wait for the outstanding canonical refresh transaction.');
    }
    releaseExchange();
  }
  let outcomes;
  try {
    outcomes = await Promise.all(children.map(child => child.completed));
  } finally {
    globalThis.clearTimeout(watchdog);
  }
  assert.equal(invalidRequest, false, 'Only the declared synthetic refresh endpoint may be used.');
  if (oauth) {
    assert.equal(requests.length, uncoordinated && !writerRace ? 2 : 1, 'The predecessor exchange count must match the selected control.');
    if (scenario === 'refresh') assert.equal(JSON.parse(await fs.readFile(auth, 'utf8')).tokens.refresh_token, 'SYNTHETIC-REFRESH-G1');
    if (scenario === 'refresh-login') assert.equal(JSON.parse(await fs.readFile(auth, 'utf8')).OPENAI_API_KEY, 'sk-SYNTHETIC-G1');
    if (scenario === 'refresh-logout') await assert.rejects(fs.access(auth), { code: 'ENOENT' });
  } else assert.equal(requests.length, 0, 'A credential read must not contact the provider.');
  if (uncoordinated) {
    assert.deepEqual(outcomes.map(outcome => outcome.code).sort(), oauth ? [0, 1] : [1, 1], 'The native negative control must fail at the lifecycle boundary after both ready barriers.');
  } else for (const outcome of outcomes) assert.equal(outcome.code, 0, `Native ${scenario} process must accept the canonical generation.`);
  console.log(`PASS: ${uncoordinated ? 'reproduced uncoordinated' : 'two native managers observe canonical'} ${scenario}.`);
} finally {
  globalThis.clearTimeout(watchdog);
  releaseExchange();
  await Promise.all(children.map(finish));
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
}
