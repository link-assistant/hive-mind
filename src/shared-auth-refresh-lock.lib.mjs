/** Linux coordination primitive for participating canonical-state adapters.
 * Acquire one persistent inode with flock, then reread the canonical generation
 * inside the callback BEFORE exchanging a predecessor. Call assertCurrent again
 * before committing. Never unlink the lock file, including on process shutdown.
 *
 * This does not coordinate native writers that bypass the adapter, select a
 * different authority, or cache credentials without a coordinated reread.
 */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const refused = () => new Error('The shared authentication refresh lock is unavailable or unsafe; refresh is refused.');
const identity = info => `${info.dev}:${info.ino}`;

async function inspectDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.normalize(directory) !== directory || directory === path.parse(directory).root || /[\0\r\n]/u.test(directory)) throw refused();
  let current = path.parse(directory).root;
  for (const component of directory.slice(current.length).split(path.sep)) {
    current = path.join(current, component);
    const info = await fs.lstat(current, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink()) throw refused();
  }
  const info = await fs.lstat(directory, { bigint: true });
  if (info.uid !== BigInt(process.getuid()) || (info.mode & 0o077n) !== 0n) throw refused();
  return identity(info);
}

function safeLockFile(info) {
  return info.isFile() && !info.isSymbolicLink() && info.nlink === 1n && info.uid === BigInt(process.getuid()) && (info.mode & 0o077n) === 0n;
}

/** The child inherits the parent's open file description on FD 3. Linux flock
 * attaches to that description, so the parent's descriptor keeps the acquired
 * lock after the tiny child exits. Parent death closes it in the kernel. Both
 * GNU and BusyBox flock support this FD form; no PID/mtime stale-lock heuristic.
 */
async function acquire(handle, waitMs, signal) {
  const signals = [AbortSignal.timeout(waitMs), ...(signal ? [signal] : [])];
  const child = spawn('flock', ['-x', '3'], { env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'ignore', 'ignore', handle.fd], signal: AbortSignal.any(signals) });
  let failed = false;
  child.once('error', () => {
    failed = true;
  });
  const code = await new Promise(resolve => child.once('close', resolve));
  if (failed || code !== 0) throw refused();
}

export async function withSharedAuthRefreshLock({ directory, lockName = '.hive-mind-refresh.lock', waitMs = 60_000, signal } = {}, operation) {
  let handle;
  let assertCurrent;
  try {
    if (process.platform !== 'linux' || typeof operation !== 'function' || !/^[a-zA-Z0-9_.-]{1,80}$/u.test(lockName) || ['.', '..'].includes(lockName) || !Number.isInteger(waitMs) || waitMs < 1 || waitMs > 300_000) throw refused();
    const directoryIdentity = await inspectDirectory(directory);
    const target = path.join(directory, lockName);
    // O_NOFOLLOW refuses a redirected lock. Never truncate, replace, unlink or
    // chmod an existing lock: another participating process may be using it.
    handle = await fs.open(target, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    const opened = await handle.stat({ bigint: true });
    if (!safeLockFile(opened)) throw refused();
    const lockIdentity = identity(opened);
    assertCurrent = async () => {
      try {
        if (signal?.aborted || (await inspectDirectory(directory)) !== directoryIdentity) throw refused();
        const current = await fs.lstat(target, { bigint: true });
        if (!safeLockFile(current) || identity(current) !== lockIdentity) throw refused();
      } catch {
        throw refused();
      }
    };
    await acquire(handle, waitMs, signal);
    await assertCurrent();
  } catch {
    await handle?.close();
    throw refused();
  }
  try {
    const result = await operation({ assertCurrent });
    await assertCurrent();
    return result;
  } finally {
    // Closing our last reference releases ownership even if refresh rejects.
    // A waiting process keeps the same inode and rereads committed state.
    await handle.close();
  }
}
