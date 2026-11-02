/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { withSharedAuthRefreshLock } from '../src/shared-auth-refresh-lock.lib.mjs';

const helper = fileURLToPath(new URL('../experiments/issue-3785/shared-refresh-lock-worker.mjs', import.meta.url));
const workers = new Map();
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-refresh-lock-'));
  await fs.chmod(directory, 0o700);
  workers.set(directory, []);
  t.after(async () => {
    for (const { child } of workers.get(directory)) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await Promise.all(workers.get(directory).map(({ closed }) => closed));
    workers.delete(directory);
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}
async function waitFor(file) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await fs.stat(file).catch(() => null)) return;
    await delay(20);
  }
  throw new Error('Finite synthetic worker barrier did not complete.');
}
function worker(t, directory, name, mode = 'rotate') {
  const child = spawn(process.execPath, [helper, directory, name, mode], { env: { PATH: process.env.PATH }, stdio: 'ignore' });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  workers.get(directory).push({ child, closed });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  });
  return { child, closed };
}

test('separate refresh writers reread the committed generation under one stable OS lock', { timeout: 8000 }, async t => {
  const directory = await fixture(t);
  await fs.writeFile(path.join(directory, 'generation'), '0');
  const first = worker(t, directory, 'first');
  await waitFor(path.join(directory, 'first-entered'));
  const identity = await fs.stat(path.join(directory, '.hive-mind-refresh.lock'), { bigint: true });
  const second = worker(t, directory, 'second');
  await waitFor(path.join(directory, 'second-ready'));
  await fs.writeFile(path.join(directory, 'release'), 'synthetic');
  assert.equal((await first.closed).code, 0);
  assert.equal((await second.closed).code, 0);
  assert.equal(await fs.readFile(path.join(directory, 'generation'), 'utf8'), '1');
  assert.equal(await fs.readFile(path.join(directory, 'exchanges'), 'utf8'), 'once');
  const after = await fs.stat(path.join(directory, '.hive-mind-refresh.lock'), { bigint: true });
  assert.equal(`${after.dev}:${after.ino}`, `${identity.dev}:${identity.ino}`);
});

test('forced refresh-owner death releases the lock without deleting its inode', { timeout: 8000 }, async t => {
  const directory = await fixture(t);
  const first = worker(t, directory, 'owner', 'hold');
  await waitFor(path.join(directory, 'owner-entered'));
  const before = await fs.stat(path.join(directory, '.hive-mind-refresh.lock'), { bigint: true });
  const peer = worker(t, directory, 'peer', 'observe');
  await waitFor(path.join(directory, 'peer-ready'));
  first.child.kill('SIGKILL');
  assert.equal((await first.closed).signal, 'SIGKILL');
  assert.equal((await peer.closed).code, 0);
  const after = await fs.stat(path.join(directory, '.hive-mind-refresh.lock'), { bigint: true });
  assert.equal(`${after.dev}:${after.ino}`, `${before.dev}:${before.ino}`);
});

test('a rejected refresh releases its descriptor before another attempt', { timeout: 8000 }, async t => {
  const directory = await fixture(t);
  await assert.rejects(
    withSharedAuthRefreshLock({ directory }, async () => {
      throw new Error('synthetic refresh refused');
    }),
    /synthetic refresh refused/u
  );
  assert.equal(await withSharedAuthRefreshLock({ directory }, async () => 'next'), 'next');
});

for (const cancellation of ['deadline', 'abort']) {
  test(`a waiting refresh ${cancellation} is reaped without taking ownership`, { timeout: 8000 }, async t => {
    const directory = await fixture(t);
    const owner = worker(t, directory, 'owner', 'hold');
    await waitFor(path.join(directory, 'owner-entered'));
    const controller = new AbortController();
    let entered = false;
    const pending = withSharedAuthRefreshLock({ directory, waitMs: cancellation === 'deadline' ? 50 : 2000, signal: controller.signal }, async () => {
      entered = true;
    });
    if (cancellation === 'abort') controller.abort();
    await assert.rejects(pending, /shared authentication refresh lock/iu);
    assert.equal(entered, false);
    assert.equal(owner.child.exitCode, null);
    owner.child.kill('SIGKILL');
    await owner.closed;
    assert.equal(await withSharedAuthRefreshLock({ directory }, async () => 'available'), 'available');
  });
}

for (const kind of ['symlink', 'hardlink', 'directory', 'world-readable']) {
  test(`unsafe ${kind} lock refuses exchange and preserves the protected file`, async t => {
    const directory = await fixture(t);
    const lock = path.join(directory, '.hive-mind-refresh.lock');
    const protectedFile = path.join(directory, 'protected');
    await fs.writeFile(protectedFile, 'synthetic-protected', { mode: 0o600 });
    if (kind === 'symlink') await fs.symlink(protectedFile, lock);
    else if (kind === 'hardlink') await fs.link(protectedFile, lock);
    else if (kind === 'directory') await fs.mkdir(lock);
    else await fs.writeFile(lock, '', { mode: 0o644 });
    let exchanged = false;
    await assert.rejects(
      withSharedAuthRefreshLock({ directory }, async () => {
        exchanged = true;
      }),
      /shared authentication refresh lock/iu
    );
    assert.equal(exchanged, false);
    assert.equal(await fs.readFile(protectedFile, 'utf8'), 'synthetic-protected');
  });
}

test('a replaced lock path is rejected before a pending exchange commits', async t => {
  const directory = await fixture(t);
  await assert.rejects(
    withSharedAuthRefreshLock({ directory }, async ({ assertCurrent }) => {
      await fs.rename(path.join(directory, '.hive-mind-refresh.lock'), path.join(directory, 'former-lock'));
      await fs.writeFile(path.join(directory, '.hive-mind-refresh.lock'), '', { mode: 0o600 });
      await assertCurrent();
      assert.fail('a replaced lock must not authorize commit');
    }),
    /shared authentication refresh lock/iu
  );
});
