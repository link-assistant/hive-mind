// Actual pinned native Qwen token manager; synthetic authority and no network.
// Reproduce stale same-timestamp reads and logout before preparing a repair.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.argv[2] === '--worker') {
  const { SharedTokenManager, QwenOAuth2Client } = await import(pathToFileURL(process.argv[3]).href);
  const nativeClient = process.argv[4] === '--native-client';
  const manager = SharedTokenManager.getInstance();
  let credentials;
  let exchanges = 0;
  const client = nativeClient
    ? new QwenOAuth2Client()
    : {
        setCredentials: value => {
          credentials = value;
        },
        getCredentials: () => credentials,
        refreshAccessToken: async () => {
          exchanges++;
          return { error: 'synthetic-refusal' };
        },
      };
  // A native-client control must also remain completely offline.
  if (nativeClient)
    globalThis.fetch = async () => {
      exchanges++;
      throw new Error('Synthetic network refusal.');
    };
  process.on('message', async message => {
    if (message.stop) {
      process.disconnect();
      return;
    }
    const before = exchanges;
    let generation = 'rejected';
    try {
      // Bypass only the five-second poll interval when requested: use the real
      // native forced-check method, leaving its timestamp predicate intact.
      if (message.force && !nativeClient) await manager.forceFileCheck(client);
      const result = nativeClient ? { access_token: (await client.getAccessToken()).token } : await manager.getValidCredentials(client);
      generation = result.access_token === undefined ? 'undefined-access-token' : ['G0', 'G1'].find(value => result.access_token === `synthetic-access-${value}`) || 'unexpected';
    } catch {
      // Never publish native exceptions or token content.
      if (client.getCredentials()?.access_token) generation = 'retained-after-refusal';
    }
    process.send({ id: message.id, generation, exchanges: exchanges - before });
  });
} else {
  const moduleFile = process.env.QWEN_PROBE_MODULE || '/home/box/.bun/install/global/node_modules/@qwen-code/qwen-code/chunks/chunk-KZQDCUQR.js';
  const metadata = JSON.parse(await fs.readFile(path.join(path.dirname(moduleFile), '..', 'package.json'), 'utf8'));
  assert.equal(metadata.version, '0.26.1', 'Use the inspected native package version.');
  const negative = process.argv.includes('--expect-native-gaps');
  const nativeClient = process.argv.includes('--native-client');
  const undefinedExpected = process.argv.includes('--expect-undefined-token');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-qwen-reads-'));
  const home = path.join(root, 'home');
  const authority = path.join(home, '.qwen');
  const file = path.join(authority, 'oauth_creds.json');
  let child;
  let closed;
  let deadline;
  const pending = new Map();
  let sequence = 0;
  let failed = false;
  const fail = () => {
    failed = true;
    for (const waiter of pending.values()) waiter.reject(new Error('Native Qwen read probe failed.'));
    pending.clear();
  };
  async function publish(generation, time) {
    await fs.writeFile(`${file}.next`, JSON.stringify({ access_token: `synthetic-access-${generation}`, refresh_token: `synthetic-refresh-${generation}`, token_type: 'Bearer', expiry_date: Date.now() + 3600000 }), { mode: 0o600 });
    await fs.utimes(`${file}.next`, time, time);
    await fs.rename(`${file}.next`, file);
  }
  try {
    await fs.mkdir(authority, { recursive: true, mode: 0o700 });
    const stamp = new Date(1000000000000);
    await publish('G0', stamp);
    // V8 needs virtual address reservations beyond its 128 MiB heap budget.
    child = spawn('/usr/bin/prlimit', ['--data=1610612736', '--stack=16777216', '--core=0', '--', process.execPath, '--max-old-space-size=128', fileURLToPath(import.meta.url), '--worker', moduleFile, nativeClient ? '--native-client' : '--manager'], {
      cwd: root,
      env: { PATH: process.env.PATH, HOME: home, QWEN_HOME: authority, QWEN_RUNTIME_DIR: path.join(root, 'runtime'), XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'), XDG_CACHE_HOME: path.join(home, '.cache') },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    closed = new Promise(resolve => child.once('close', resolve));
    child.on('error', fail);
    child.on('close', fail);
    let bytes = 0;
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 65536) {
          fail();
          child.kill('SIGKILL');
        }
      });
    }
    child.on('message', message => {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      waiter?.resolve({ generation: message.generation, exchanges: message.exchanges });
    });
    const read = force =>
      new Promise((resolve, reject) => {
        if (failed) return reject(new Error('Native Qwen read worker is unavailable.'));
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        child.send({ id, force });
      });
    deadline = setTimeout(() => {
      fail();
      child.kill('SIGKILL');
    }, 15000);
    assert.deepEqual(await read(true), { generation: 'G0', exchanges: 0 });
    console.log('PASS: actual native Qwen manager reads healthy synthetic G0 without exchanging.');
    const before = await fs.stat(file);
    await publish('G1', stamp);
    const after = await fs.stat(file);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.notEqual(after.ino, before.ino);
    assert.deepEqual(await read(true), { generation: negative ? 'G0' : 'G1', exchanges: 0 }, 'A forced native credential read must observe atomic same-timestamp replacement.');
    console.log(negative ? 'REPRODUCED: forced native Qwen read retains G0 after same-timestamp atomic G1 replacement.' : 'PASS: forced native Qwen read observes same-timestamp atomic replacement.');
    // A later timestamp is an independent healthy reload control.
    await publish('G1', new Date(1000000060000));
    assert.deepEqual(await read(true), { generation: 'G1', exchanges: 0 });
    console.log('PASS: native Qwen reads a later-timestamp G1 publication.');
    await fs.unlink(file);
    assert.deepEqual(await read(true), { generation: negative ? 'G1' : undefinedExpected ? 'undefined-access-token' : 'rejected', exchanges: 0 }, 'Native logout must invalidate cached credentials before a read or refresh exchange.');
    console.log(negative ? 'REPRODUCED: forced native Qwen read returns cached G1 after canonical logout.' : undefinedExpected ? 'REPRODUCED: actual native OAuth client swallows refusal and returns an undefined access token after logout.' : 'PASS: native Qwen logout refuses cached credentials without an exchange.');
    if (!negative && !undefinedExpected) {
      await publish('G0', stamp);
      assert.deepEqual(await read(false), { generation: 'G0', exchanges: 0 });
      await publish('G1', stamp);
      assert.deepEqual(await read(false), { generation: 'G1', exchanges: 0 });
      console.log('PASS: ordinary native reads observe recreation and same-timestamp replacement without waiting for a polling interval.');
      const healthy = await fs.readFile(file);
      for (const kind of ['malformed', 'permissions', 'symlink', 'hardlink', 'directory', 'oversized', 'unsafe-parent', 'redirected-parent']) {
        const protectedFile = path.join(root, 'protected');
        const moved = `${authority}.original`;
        await fs.unlink(file);
        if (kind === 'malformed') await fs.writeFile(file, '{"access_token":"synthetic-parser-sentinel",', { mode: 0o600 });
        if (kind === 'permissions') await fs.writeFile(file, healthy, { mode: 0o644 });
        if (kind === 'symlink' || kind === 'hardlink') {
          await fs.writeFile(protectedFile, healthy, { mode: 0o600 });
          if (kind === 'symlink') await fs.symlink(protectedFile, file);
          else await fs.link(protectedFile, file);
        }
        if (kind === 'directory') await fs.mkdir(file);
        if (kind === 'oversized') await fs.writeFile(file, Buffer.alloc(1024 * 1024 + 1, 0x20), { mode: 0o600 });
        if (kind === 'unsafe-parent' || kind === 'redirected-parent') {
          await fs.writeFile(file, healthy, { mode: 0o600 });
          if (kind === 'unsafe-parent') await fs.chmod(authority, 0o755);
          else {
            await fs.rename(authority, moved);
            await fs.symlink(moved, authority);
          }
        }
        assert.deepEqual(await read(false), { generation: 'rejected', exchanges: 0 }, `Unsafe ${kind} must clear native/client caches and refuse before exchange.`);
        if (kind === 'unsafe-parent') await fs.chmod(authority, 0o700);
        if (kind === 'redirected-parent') {
          await fs.unlink(authority);
          await fs.rename(moved, authority);
        }
        if (kind === 'symlink' || kind === 'hardlink') {
          assert.deepEqual(await fs.readFile(protectedFile), healthy);
          await fs.unlink(protectedFile);
        }
        await fs.rm(file, { recursive: true, force: true });
        await publish('G1', stamp);
        assert.deepEqual(await read(false), { generation: 'G1', exchanges: 0 }, `Repair after ${kind} must use disk authority.`);
        console.log(`PASS: native ${kind} refusal clears caches, preserves evidence and accepts repaired G1 without exchange.`);
      }
      await fs.unlink(file);
      assert.deepEqual(await read(false), { generation: 'rejected', exchanges: 0 });
      console.log('PASS: ordinary native reads refuse logout without a stale-token grace period.');
    }
    child.send({ stop: true });
    assert.equal(await closed, 0);
    console.log('LIMIT: actual native token-manager methods; independent config roots, all writers and model-request admission remain unverified.');
  } finally {
    clearTimeout(deadline);
    if (child?.exitCode === null) child.kill('SIGKILL');
    if (closed) await closed;
    await fs.rm(root, { recursive: true, force: true });
  }
}
