import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

const fixture = new URL('./router-lifetime-native-fixture.mjs', import.meta.url);
const holdWrite = `
  import fs from 'node:fs';

  const write = fs.writeFileSync;
  fs.writeFileSync = (file, contents, ...options) => {
    // Simulate the writer being descheduled after creating the file.
    write(file, '');
    write(process.env.PID_WRITE_STARTED, '');
    const release = process.env.PID_WRITE_RELEASE;
    const wake = new Int32Array(new SharedArrayBuffer(4));
    for (let tries = 0; tries < 100 && !fs.existsSync(release); tries++) Atomics.wait(wake, 0, 0, 10);
    if (!fs.existsSync(release)) throw new Error('PID write was never released');
    return write(file, contents, ...options);
  };
  await import(process.argv[1]);
`;

test('the Router fixture only publishes a complete PID record', { skip: process.platform !== 'linux', timeout: 4000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'router-pid-publication-'));
  const ready = path.join(directory, 'pids');
  const started = path.join(directory, 'started');
  const release = path.join(directory, 'release');
  const command = spawn(process.execPath, ['--max-old-space-size=32', '--input-type=module', '-e', holdWrite, fixture.href], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ROUTER_LIFETIME_PID_FILE: ready, PID_WRITE_STARTED: started, PID_WRITE_RELEASE: release },
  });
  const closed = once(command, 'close');
  t.after(async () => {
    try {
      if (command.pid) process.kill(-command.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    } finally {
      await closed;
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  for (let tries = 0; tries < 100 && !fs.existsSync(started); tries++) await delay(10);
  assert.ok(fs.existsSync(started), 'fixture reached the simulated write interruption');
  assert.equal(fs.existsSync(ready), false, 'a watcher must not see an empty or partial PID file');
  fs.writeFileSync(release, '');
  for (let tries = 0; tries < 100 && !fs.existsSync(ready); tries++) await delay(10);
  const pids = JSON.parse(fs.readFileSync(ready, 'utf8'));
  assert.equal(pids.parent, command.pid);
  assert.ok(pids.child > 0);
});
