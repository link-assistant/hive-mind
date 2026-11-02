// Exercise the installed Qwen 0.26.1 token-manager class with mocked OAuth.
// This neither starts a model turn nor changes any real account state.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';

if (process.argv[2] === '--worker') {
  const { SharedTokenManager } = await import(pathToFileURL(process.argv[4]).href);
  const role = process.argv[3];
  if (role === 'observer') SharedTokenManager.getInstance();
  if (role === 'observer' || role === 'control-observer') {
    process.disconnect();
  } else {
    const manager = SharedTokenManager.getInstance();
    let credentials;
    const client = {
      setCredentials: value => {
        credentials = value;
        process.send({ type: 'loaded', generation: value.access_token === 'synthetic-access-g0' ? 0 : 1 });
      },
      getCredentials: () => credentials,
      refreshAccessToken: () =>
        new Promise(resolve => {
          process.once('message', response => resolve(response));
          process.send({ type: 'exchange', predecessorIsG0: credentials.refresh_token === 'synthetic-refresh-g0' });
        }),
    };
    try {
      process.send({ type: 'ready' });
      const selected = await manager.getValidCredentials(client);
      process.send({ type: 'result', generation: selected.access_token === 'synthetic-access-g1' ? 1 : -1 });
    } catch {
      process.send({ type: 'rejected' });
    } finally {
      process.disconnect();
    }
  }
} else {
  const moduleFile = process.env.QWEN_PROBE_MODULE || '/home/box/.bun/install/global/node_modules/@qwen-code/qwen-code/chunks/chunk-KZQDCUQR.js';
  const metadata = JSON.parse(await fs.readFile(path.join(path.dirname(moduleFile), '..', 'package.json'), 'utf8'));
  assert.equal(metadata.version, '0.26.1', 'The probe requires the inspected native package version.');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-qwen-lock-'));
  const home = path.join(root, 'home');
  const qwen = path.join(home, '.qwen');
  const control = process.argv.includes('--without-observer-manager');
  const coordinated = process.argv.includes('--expect-coordinated');
  const privateConfigs = process.argv.includes('--private-configs');
  const children = [];
  let timer;
  let fail;
  const failure = new Promise((_, reject) => {
    fail = reject;
  });
  function start(role) {
    const child = spawn('/usr/bin/prlimit', ['--data=1610612736', '--stack=16777216', '--core=0', '--', process.execPath, '--max-old-space-size=128', fileURLToPath(import.meta.url), '--worker', role, moduleFile], {
      cwd: root,
      env: { PATH: process.env.PATH, HOME: home, QWEN_HOME: privateConfigs ? path.join(root, `config-${role}`) : qwen, ...(privateConfigs ? { QWEN_AUTH_HOME: qwen } : {}), QWEN_RUNTIME_DIR: path.join(root, `runtime-${role}`), XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'), XDG_CACHE_HOME: path.join(home, '.cache') },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const events = [];
    const waiters = new Map();
    let bytes = 0;
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 65536) fail(new Error('Native probe diagnostics exceeded their fixed bound.'));
      });
    child.on('error', () => fail(new Error('Native probe worker could not start.')));
    child.on('message', message => {
      events.push(message);
      waiters.get(message.type)?.(message);
      waiters.delete(message.type);
    });
    const closed = new Promise(resolve => child.once('close', resolve));
    const wait = type => events.find(event => event.type === type) || new Promise(resolve => waiters.set(type, resolve));
    const worker = { child, events, wait, closed };
    children.push(worker);
    return worker;
  }
  try {
    await fs.mkdir(qwen, { recursive: true, mode: 0o700 });
    if (privateConfigs) for (const role of ['owner', 'observer', 'control-observer', 'peer']) await fs.mkdir(path.join(root, `config-${role}`), { mode: 0o700 });
    await fs.writeFile(path.join(qwen, 'oauth_creds.json'), JSON.stringify({ access_token: 'synthetic-access-g0', refresh_token: 'synthetic-refresh-g0', token_type: 'Bearer', expiry_date: Date.now() - 60000 }), { mode: 0o600 });
    await Promise.race([
      failure,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Finite Qwen native lock probe deadline exceeded.')), 20000);
      }),
      (async () => {
        const owner = start('owner');
        assert.equal((await owner.wait('exchange')).predecessorIsG0, true);
        const lock = path.join(qwen, coordinated ? '.hive-mind-refresh.lock' : 'oauth_creds.lock');
        const before = await fs.stat(lock, { bigint: true });
        const observer = start(control ? 'control-observer' : 'observer');
        assert.equal(await observer.closed, 0);
        assert.equal(owner.child.exitCode, null, 'The original lock owner is still refreshing.');
        if (control || coordinated) {
          const after = await fs.stat(lock, { bigint: true });
          assert.equal(`${after.dev}:${after.ino}`, `${before.dev}:${before.ino}`);
          const peer = start('peer');
          if (coordinated) {
            await peer.wait('ready');
            let blocked = false;
            for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
              const pids = (await fs.readFile(`/proc/${peer.child.pid}/task/${peer.child.pid}/children`, 'utf8')).trim().split(/\s+/u).filter(Boolean);
              for (const pid of pids) {
                const waiting = await fs.readFile(`/proc/${pid}/wchan`, 'utf8').catch(() => '');
                if (waiting.trim() === 'locks_lock_inode_wait') blocked = true;
              }
              if (!blocked) await delay(20);
            }
            assert.equal(blocked, true, 'The actual native peer must block on the live owner’s kernel lock before release.');
          } else assert.equal((await peer.wait('loaded')).generation, 0);
          owner.child.send({ access_token: 'synthetic-access-g1', refresh_token: 'synthetic-refresh-g1', token_type: 'Bearer', expires_in: 3600 });
          assert.equal((await owner.wait('result')).generation, 1);
          assert.equal((await peer.wait('result')).generation, 1);
          assert.equal(
            peer.events.some(event => event.type === 'exchange'),
            false
          );
          console.log(coordinated ? 'PASS: constructing and exiting a non-owner preserves the live stable native lock; the peer reads committed G1 without another exchange.' : 'CONTROL: without constructing the exiting observer manager, the lock survives and the peer uses persisted G1 without an exchange.');
        } else {
          await assert.rejects(fs.stat(lock), { code: 'ENOENT' });
          const peer = start('peer');
          assert.equal((await peer.wait('exchange')).predecessorIsG0, true);
          assert.equal(owner.child.exitCode, null);
          peer.child.send({ error: 'synthetic-predecessor-reuse', error_description: 'Disposable OAuth stub rejection.' });
          await peer.wait('rejected');
          owner.child.send({ access_token: 'synthetic-access-g1', refresh_token: 'synthetic-refresh-g1', token_type: 'Bearer', expires_in: 3600 });
          assert.equal((await owner.wait('result')).generation, 1);
          console.log('REPRODUCED: an exiting non-owner deletes the live native Qwen refresh lock; a peer exchanges the same synthetic G0 before the owner finishes.');
        }
        await Promise.all(children.map(worker => worker.closed));
        if (privateConfigs) {
          for (const role of ['owner', 'observer', 'control-observer', 'peer']) await assert.rejects(fs.lstat(path.join(root, `config-${role}`, 'oauth_creds.json')), { code: 'ENOENT' });
          console.log('PASS: actual native peers use one auth authority across separate private configuration roots without credential copies.');
        }
        console.log('LIMIT: installed native token-manager class with mocked OAuth; no production fix, CLI lifecycle or cross-container claim.');
      })(),
    ]);
  } catch {
    console.error('Synthetic native Qwen ownership probe failed; no native diagnostic or credential bytes are published.');
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    for (const worker of children) if (worker.child.exitCode === null) worker.child.kill('SIGKILL');
    await Promise.all(children.map(worker => worker.closed));
    await fs.rm(root, { recursive: true, force: true });
  }
}
