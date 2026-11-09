// Compile and exercise the exact pinned native maintenance implementation.
// Synthetic canonical rollouts, two private configurations, finite children.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import console from 'node:console';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { setTimeout, clearTimeout } from 'node:timers';
import { promisify } from 'node:util';
import { URL } from 'node:url';

const execute = promisify(execFile);
const sourceRoot = await fs.realpath(process.argv[2]);
const expectPrivate = process.argv.includes('--expect-private-locks');
assert.equal((await execute('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'])).stdout.trim(), '6aaac694803004a63c6f393d153c96d22521a6b9');
const nativeSource = path.join(sourceRoot, 'codex-rs/rollout/src/maintenance.rs');
assert.match(nativeSource, /^\/[a-zA-Z0-9_./-]+$/u, 'The generated Rust path must be a simple absolute path.');
if (expectPrivate)
  assert.equal(
    createHash('sha256')
      .update(await fs.readFile(nativeSource))
      .digest('hex'),
    'abdbd690732aaee671609fc0540c9e845a15116c0de183b0dd976d560f55c404',
    'The negative control must compile the exact stock module.'
  );
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-native-maintenance-'));
const children = [];

async function acquire(config, canonical) {
  const child = spawn('prlimit', ['--data=134217728', '--stack=8388608', '--core=0', '--', path.join(temporary, 'probe'), config], { env: { PATH: process.env.PATH, ...(canonical ? { CODEX_ROLLOUT_MAINTENANCE_HOME: canonical } : {}) }, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = new Promise(resolve => child.once('close', resolve));
  const lines = createInterface({ input: child.stdout });
  child.stderr.resume();
  let stopped;
  const handle = {
    child,
    closed,
    stop() {
      return (stopped ||= (async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await closed;
        lines.close();
      })());
    },
  };
  children.push(handle);
  let deadline;
  try {
    handle.result = await new Promise((resolve, reject) => {
      deadline = setTimeout(() => reject(new Error('Native maintenance readiness deadline exceeded.')), 5000);
      lines.once('line', resolve);
      child.once('error', () => reject(new Error('Native maintenance process could not start.')));
      child.once('close', () => reject(new Error('Native maintenance process closed without readiness.')));
    });
    assert.ok(['ACQUIRED', 'BUSY', 'REFUSED'].includes(handle.result), 'Native acquisition must report a structural result.');
    return handle;
  } finally {
    clearTimeout(deadline);
  }
}

try {
  const driver = (await fs.readFile(new URL('./native-codex/maintenance_probe.rs', import.meta.url), 'utf8')).replace('__NATIVE_MAINTENANCE_SOURCE__', nativeSource);
  await fs.writeFile(path.join(temporary, 'driver.rs'), driver);
  await execute('prlimit', ['--data=536870912', '--stack=16777216', '--core=0', '--', 'rustc', '+1.99.1', '--edition', '2024', '-C', 'debuginfo=0', path.join(temporary, 'driver.rs'), '-o', path.join(temporary, 'probe')], { maxBuffer: 256 * 1024 });
  const canonical = path.join(temporary, 'canonical');
  await fs.mkdir(canonical, { mode: 0o700 });
  await fs.mkdir(path.join(canonical, 'sessions'), { mode: 0o700 });
  const configs = [path.join(temporary, 'config-a'), path.join(temporary, 'config-b')];
  for (const config of configs) {
    await fs.mkdir(config, { mode: 0o700 });
    await fs.symlink(path.join(canonical, 'sessions'), path.join(config, 'sessions'));
  }
  assert.equal(await fs.realpath(path.join(configs[0], 'sessions')), await fs.realpath(path.join(configs[1], 'sessions')));
  for (const termination of ['release', 'owner-death']) {
    const owner = await acquire(configs[0], canonical);
    assert.equal(owner.result, 'ACQUIRED', 'The first actual native maintenance owner must acquire.');
    const before = !expectPrivate && (await fs.stat(path.join(canonical, 'rollout-maintenance.lock')));
    const peer = await acquire(configs[1], canonical);
    assert.equal(peer.result, expectPrivate ? 'ACQUIRED' : 'BUSY', 'Shared rollouts require exclusion across private task configurations.');
    await peer.stop();
    if (termination === 'release') {
      owner.child.stdin.end('\n');
      await owner.closed;
    } else await owner.stop();
    const successor = await acquire(configs[1], canonical);
    assert.equal(successor.result, 'ACQUIRED', 'Normal release and owner death must both permit a new native owner.');
    if (before) {
      const after = await fs.stat(path.join(canonical, 'rollout-maintenance.lock'));
      assert.deepEqual([after.dev, after.ino], [before.dev, before.ino], 'Release and forced owner death must preserve the same lock inode.');
    }
    await successor.stop();
    console.log(`PASS: ${termination} ${expectPrivate ? 'reproduces two native maintenance owners for the same rollouts' : 'preserves one native maintenance owner across private configurations'}.`);
  }
  if (!expectPrivate) {
    for (const config of configs) await assert.rejects(fs.lstat(path.join(config, '.tmp/rollout-maintenance.lock')), { code: 'ENOENT' });
    const refuse = async (label, selected = canonical) => {
      const child = await acquire(configs[0], selected);
      assert.equal(child.result, 'REFUSED', `${label} must refuse native maintenance before acquisition.`);
      await child.stop();
      console.log(`PASS: ${label} refuses native maintenance.`);
    };
    const lock = path.join(canonical, 'rollout-maintenance.lock');
    await fs.chmod(lock, 0o644);
    await refuse('unsafe lock permissions');
    await fs.chmod(lock, 0o600);
    await fs.link(lock, `${lock}.alias`);
    await refuse('hard-linked lock');
    await fs.unlink(`${lock}.alias`);
    await fs.rename(lock, `${lock}.saved`);
    await fs.symlink(`${lock}.saved`, lock);
    await refuse('symlinked lock');
    await fs.unlink(lock);
    await fs.rename(`${lock}.saved`, lock);
    await fs.chmod(canonical, 0o755);
    await refuse('unsafe canonical directory permissions');
    await fs.chmod(canonical, 0o700);
    const alias = path.join(temporary, 'canonical-alias');
    await fs.symlink(canonical, alias);
    await refuse('aliased canonical directory', alias);
    const absent = path.join(temporary, 'missing-authority');
    await refuse('missing canonical directory', absent);
    await assert.rejects(fs.lstat(absent), { code: 'ENOENT' });
    await refuse('configuration and canonical directory overlap', configs[0]);
    await fs.mkdir(path.join(configs[0], '.tmp'), { mode: 0o700 });
    await fs.writeFile(path.join(configs[0], '.tmp/rollout-maintenance.lock'), '', { mode: 0o600 });
    await refuse('private competing maintenance lock');
    await fs.unlink(path.join(configs[0], '.tmp/rollout-maintenance.lock'));
    const repaired = await acquire(configs[0], canonical);
    assert.equal(repaired.result, 'ACQUIRED', 'Repaired canonical authority must remain usable.');
    await repaired.stop();
    console.log('PASS: repaired canonical maintenance authority remains usable.');
    const legacy = [await acquire(configs[0]), await acquire(configs[1])];
    for (const child of legacy) assert.equal(child.result, 'ACQUIRED', 'No selector must retain the native private maintenance behavior.');
    await Promise.all(legacy.map(child => child.stop()));
    console.log('PASS: no selector preserves legacy native maintenance behavior.');
  }
} finally {
  await Promise.allSettled(children.map(child => child.stop()));
  await fs.rm(temporary, { recursive: true, force: true });
}
