// Actual pinned native manager, OAuth client, login publication and logout.
// Only synthetic credentials and an in-process OAuth response stub are used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL, URLSearchParams } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';

const credential = (generation, expired = false) => ({ access_token: `synthetic-access-${generation}`, refresh_token: `synthetic-refresh-${generation}`, token_type: 'Bearer', expiry_date: Date.now() + (expired ? -60000 : 3600000) });
const generation = token => ['G0', 'G1', 'G2'].find(value => token === `synthetic-access-${value}`) || 'unexpected';

if (process.argv[2] === '--worker') {
  const { QwenOAuth2Client, cacheQwenCredentials, clearQwenCredentials } = await import(pathToFileURL(process.argv[3]).href);
  const role = process.argv[4];
  let exchanges = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://chat.qwen.ai/api/v1/oauth2/token');
    assert.equal(new URLSearchParams(options.body).get('refresh_token'), 'synthetic-refresh-G0');
    exchanges++;
    process.send({ type: 'exchange', predecessor: 'G0' });
    const reply = await new Promise(resolve => process.once('message', resolve));
    if (reply.networkError) throw new Error('Synthetic network refusal.');
    const body = reply.invalidGrant ? { error: 'invalid_grant', error_description: 'synthetic-refusal' } : { access_token: 'synthetic-access-G1', refresh_token: reply.nonRotating ? 'synthetic-refresh-G0' : 'synthetic-refresh-G1', token_type: 'Bearer', expires_in: 3600 };
    return new globalThis.Response(JSON.stringify(body), { status: reply.invalidGrant ? 400 : 200, headers: { 'Content-Type': 'application/json' } });
  };
  process.send({ type: 'ready' });
  try {
    let selected;
    if (role === 'login' || role === 'same-refresh-login') {
      await cacheQwenCredentials({ ...credential('G2'), ...(role === 'same-refresh-login' ? { refresh_token: 'synthetic-refresh-G0' } : {}) });
      selected = 'G2';
    } else if (role === 'logout') {
      await clearQwenCredentials();
      selected = 'cleared';
    } else {
      const client = new QwenOAuth2Client();
      selected = generation(role === 'direct' ? (await client.refreshAccessToken()).access_token : (await client.getAccessToken()).token);
    }
    process.send({ type: 'result', selected, exchanges });
  } catch {
    // Never publish native exception details, response bodies or credentials.
    process.send({ type: 'result', selected: 'rejected', exchanges });
  } finally {
    process.disconnect();
  }
} else {
  const moduleFile = process.env.QWEN_PROBE_MODULE || '/home/box/.bun/install/global/node_modules/@qwen-code/qwen-code/chunks/chunk-KZQDCUQR.js';
  const metadata = JSON.parse(await fs.readFile(path.join(path.dirname(moduleFile), '..', 'package.json'), 'utf8'));
  assert.equal(metadata.version, '0.26.1');
  async function scenario(name) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-qwen-writers-'));
    const authority = path.join(root, 'authority');
    const file = path.join(authority, 'oauth_creds.json');
    const lock = path.join(authority, '.hive-mind-refresh.lock');
    const intent = path.join(authority, '.hive-qwen-refresh-intent.json');
    const workers = [];
    let timer;
    let fail;
    const failure = new Promise((_, reject) => {
      fail = reject;
    });
    function start(role) {
      const config = path.join(root, `config-${workers.length}`);
      const child = spawn('/usr/bin/prlimit', ['--data=1610612736', '--stack=16777216', '--core=0', '--', process.execPath, '--max-old-space-size=128', fileURLToPath(import.meta.url), '--worker', moduleFile, role], {
        cwd: root,
        env: { PATH: process.env.PATH, HOME: root, QWEN_HOME: config, QWEN_AUTH_HOME: authority, QWEN_RUNTIME_DIR: path.join(root, `runtime-${workers.length}`), XDG_CONFIG_HOME: path.join(root, '.config'), XDG_DATA_HOME: path.join(root, '.local/share'), XDG_CACHE_HOME: path.join(root, '.cache') },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      const events = [];
      const pending = new Map();
      let bytes = 0;
      for (const stream of [child.stdout, child.stderr])
        stream.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > 65536) fail(new Error('Synthetic writer output exceeded its bound.'));
        });
      child.on('error', () => fail(new Error('Synthetic writer could not start.')));
      child.on('message', message => {
        events.push(message);
        pending.get(message.type)?.(message);
        pending.delete(message.type);
      });
      const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
      const worker = { child, events, closed, wait: type => events.find(event => event.type === type) || new Promise(resolve => pending.set(type, resolve)) };
      workers.push(worker);
      return worker;
    }
    async function blocked(worker) {
      await worker.wait('ready');
      for (let attempt = 0; attempt < 100; attempt++) {
        const pids = (await fs.readFile(`/proc/${worker.child.pid}/task/${worker.child.pid}/children`, 'utf8')).trim().split(/\s+/u).filter(Boolean);
        for (const pid of pids) if ((await fs.readFile(`/proc/${pid}/wchan`, 'utf8').catch(() => '')).trim() === 'locks_lock_inode_wait') return;
        await delay(20);
      }
      throw new Error('The native writer did not wait on the live owner’s kernel lock.');
    }
    async function result(worker, selected, exchanges) {
      assert.deepEqual(await worker.wait('result'), { type: 'result', selected, exchanges });
      assert.deepEqual(await worker.closed, { code: 0, signal: null });
    }
    async function reader(selected) {
      const child = start('reader');
      await result(child, selected, 0);
    }
    try {
      await fs.mkdir(authority, { mode: 0o700 });
      await fs.writeFile(file, JSON.stringify(credential('G0', true)), { mode: 0o600 });
      await fs.writeFile(lock, '', { mode: 0o600 });
      const initial = await fs.stat(lock, { bigint: true });
      await Promise.race([
        failure,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Finite native writer deadline exceeded.')), 20000);
        }),
        (async () => {
          if (['unsafe-lock', 'legacy-lock', 'legacy-intent', 'conflicting-authority'].includes(name)) {
            if (name === 'unsafe-lock') await fs.chmod(lock, 0o644);
            if (name === 'legacy-lock') await fs.writeFile(path.join(authority, 'oauth_creds.lock'), 'synthetic-live-legacy-owner', { mode: 0o600 });
            let legacyIntent;
            if (name === 'legacy-intent') {
              legacyIntent = JSON.stringify({
                version: 1,
                generation: createHash('sha256')
                  .update(await fs.readFile(file))
                  .digest('hex'),
              });
              await fs.writeFile(intent, legacyIntent, { mode: 0o600 });
              const changed = { ...JSON.parse(await fs.readFile(file, 'utf8')), metadata: 'synthetic-legacy-metadata-change' };
              await fs.writeFile(file, JSON.stringify(changed), { mode: 0o600 });
            }
            if (name === 'conflicting-authority') {
              await fs.mkdir(path.join(root, 'config-0'), { mode: 0o700 });
              await fs.writeFile(path.join(root, 'config-0/oauth_creds.json'), JSON.stringify(credential('G2')), { mode: 0o600 });
            }
            await result(start('owner'), 'rejected', 0);
            assert.equal(generation(JSON.parse(await fs.readFile(file, 'utf8')).access_token), 'G0');
            if (name === 'unsafe-lock') assert.equal((await fs.stat(lock)).mode & 0o777, 0o644);
            if (name === 'legacy-lock') assert.equal(await fs.readFile(path.join(authority, 'oauth_creds.lock'), 'utf8'), 'synthetic-live-legacy-owner');
            if (name === 'legacy-intent') {
              await result(start('login'), 'rejected', 0);
              assert.equal(await fs.readFile(intent, 'utf8'), legacyIntent);
            }
            if (name === 'conflicting-authority') assert.equal(generation(JSON.parse(await fs.readFile(path.join(root, 'config-0/oauth_creds.json'), 'utf8')).access_token), 'G2');
          } else {
            const owner = start(name === 'direct-refresh' ? 'direct' : 'owner');
            assert.equal((await owner.wait('exchange')).predecessor, 'G0');
            let peer;
            if (['two-refreshes', 'login', 'logout', 'owner-death'].includes(name)) {
              peer = start(name === 'login' || name === 'logout' ? name : 'owner');
              await blocked(peer);
              assert.equal(generation(JSON.parse(await fs.readFile(file, 'utf8')).access_token), 'G0');
            }
            if (name === 'publication-race') {
              await fs.writeFile(`${file}.replacement`, JSON.stringify(credential('G2')), { mode: 0o600 });
              await fs.rename(`${file}.replacement`, file);
            }
            if (name === 'owner-death') {
              owner.child.kill('SIGKILL');
              assert.equal((await owner.closed).signal, 'SIGKILL');
              await result(peer, 'rejected', 0);
            } else {
              owner.child.send({ invalidGrant: name === 'invalid-grant', networkError: ['network-refusal', 'metadata-rewrite'].includes(name), nonRotating: name === 'non-rotating' });
              await result(owner, ['invalid-grant', 'network-refusal', 'metadata-rewrite', 'publication-race'].includes(name) ? 'rejected' : 'G1', 1);
              if (peer) await result(peer, name === 'logout' ? 'cleared' : name === 'login' ? 'G2' : 'G1', 0);
            }
            if (['owner-death', 'network-refusal', 'metadata-rewrite'].includes(name)) {
              assert.equal(generation(JSON.parse(await fs.readFile(file, 'utf8')).access_token), 'G0');
              assert.equal((await fs.stat(intent)).mode & 0o777, 0o600);
              if (name === 'metadata-rewrite') {
                const changed = { ...JSON.parse(await fs.readFile(file, 'utf8')), expiry_date: Date.now() - 120000, metadata: 'synthetic-metadata-change' };
                await fs.writeFile(`${file}.replacement`, JSON.stringify(changed), { mode: 0o600 });
                await fs.rename(`${file}.replacement`, file);
                const peer = start('reader');
                // Drain an erroneous extra exchange so the assertion reports
                // consumed-predecessor reuse without waiting for the deadline.
                peer.child.on('message', message => {
                  if (message.type === 'exchange') peer.child.send({ networkError: true });
                });
                await result(peer, 'rejected', 0);
                assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).refresh_token, 'synthetic-refresh-G0');
                assert.equal((await fs.stat(intent)).mode & 0o777, 0o600);
                await result(start('same-refresh-login'), 'rejected', 0);
                assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).refresh_token, 'synthetic-refresh-G0');
              }
              await reader('rejected');
              await result(start('login'), 'G2', 0);
              await reader('G2');
            } else if (name === 'logout' || name === 'invalid-grant') {
              await assert.rejects(fs.lstat(file), { code: 'ENOENT' });
              await reader('rejected');
            } else await reader(name === 'login' || name === 'publication-race' ? 'G2' : 'G1');
            await assert.rejects(fs.lstat(intent), { code: 'ENOENT' });
          }
          const after = await fs.stat(lock, { bigint: true });
          assert.equal(`${after.dev}:${after.ino}`, `${initial.dev}:${initial.ino}`);
          if (name !== 'conflicting-authority') for (let index = 0; index < workers.length; index++) await assert.rejects(fs.lstat(path.join(root, `config-${index}/oauth_creds.json`)), { code: 'ENOENT' });
          console.log(`PASS: actual native Qwen ${name}; stable lock identity, private configuration roots and bounded synthetic OAuth.`);
        })(),
      ]);
    } finally {
      clearTimeout(timer);
      for (const worker of workers) if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGKILL');
      await Promise.all(workers.map(worker => worker.closed));
      await fs.rm(root, { recursive: true, force: true });
    }
  }
  const scenarios = ['two-refreshes', 'login', 'logout', 'invalid-grant', 'owner-death', 'network-refusal', 'metadata-rewrite', 'non-rotating', 'direct-refresh', 'publication-race', 'unsafe-lock', 'legacy-lock', 'legacy-intent', 'conflicting-authority'];
  const selected = process.argv.find(value => value.startsWith('--scenario='))?.slice('--scenario='.length);
  if (selected) assert.ok(scenarios.includes(selected), 'Unknown native writer scenario.');
  for (const name of selected ? [selected] : scenarios) await scenario(name);
  console.log('LIMIT: actual native OAuth methods with a synthetic fetch stub; full CLI, history, release/deployment and remaining credential backends are not established.');
}
