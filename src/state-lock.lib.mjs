/**
 * Cross-process exclusive locks over the durable bot state directory.
 *
 * Issue #2146 introduced two background maintainers — the Formal AI sidecar
 * lifecycle and the agentic-CLI refresh — that must never interleave with the
 * work they maintain. Both need the same primitive, so it lives here once.
 *
 * `mkdir` is the lock: it is atomic on every filesystem the bot runs on, unlike
 * "check then create" with a regular file. A lock older than `staleMs` is
 * broken so a killed process cannot deadlock the bot forever. Breaking it is
 * itself serialised (issue #3278): two waiters that both saw the old lock as
 * stale used to remove it one after the other, the second removing the fresh
 * lock the first had just taken, and both ran the critical section.
 *
 * Issue #4143 attaches the owner to the lock: `<lock>/owner.json` records the
 * PID, hostname and PID namespace of the holder. A lock whose holder died on
 * this host and namespace is released at once instead of after `staleMs`.
 * `HIVE_MIND_STATE_LOCK_MODE` (or the `mode` option) selects the strategy:
 * `pid` (default: owner liveness plus age), `age` (age only) or `none` (no
 * lock, for single-process setups and filesystems without atomic mkdir).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2146
 * @see https://github.com/link-assistant/hive-mind/issues/4143
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveBotStateDir } from './session-store.lib.mjs';

export const DEFAULT_STATE_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_STATE_LOCK_STALE_MS = 15 * 60 * 1000;
export const DEFAULT_STATE_LOCK_POLL_MS = 250;

export const STATE_LOCK_MODES = Object.freeze(['pid', 'age', 'none']);
const OWNER_FILE = 'owner.json';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Lock strategy from the option or `HIVE_MIND_STATE_LOCK_MODE`. */
export const resolveStateLockMode = (mode, env = process.env) => {
  const value = String(mode || env.HIVE_MIND_STATE_LOCK_MODE || 'pid')
    .trim()
    .toLowerCase();
  if (!STATE_LOCK_MODES.includes(value)) throw new Error(`Unknown state lock mode "${value}"; use ${STATE_LOCK_MODES.join(', ')}`);
  return value;
};

const readPidNamespace = () => {
  try {
    return fs.readlinkSync('/proc/self/ns/pid'); // hive-sync-ok: one-time read of a procfs link
  } catch {
    return null;
  }
};
let pidNamespace;

/** Identity written into a lock: same host and PID namespace means the PID can be probed. */
export const currentLockOwner = (now = () => Date.now()) => {
  pidNamespace ??= readPidNamespace() ?? '';
  return { pid: process.pid, hostname: os.hostname(), pidNamespace, acquiredAt: new Date(now()).toISOString() };
};

/** `kill(pid, 0)`: EPERM means the PID exists under another user. */
export const processIsAlive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
};

/** Whether the recorded owner is provably dead (same host and namespace, no such PID). */
export const isLockOwnerDead = (owner, { self = currentLockOwner(), isAlive = processIsAlive } = {}) => {
  const pid = Number(owner?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (owner.hostname !== self.hostname || (owner.pidNamespace ?? '') !== (self.pidNamespace ?? '')) return false;
  if (pid === self.pid) return false;
  return !isAlive(pid);
};

const readLockOwner = async (fsp, lockPath) => {
  try {
    return JSON.parse(await fsp.readFile(path.join(lockPath, OWNER_FILE), 'utf8'));
  } catch {
    return null;
  }
};

/** Absolute path of the lock directory backing `name`. */
export const resolveStateLockPath = (name, env = process.env) => path.join(resolveBotStateDir(env), `${name}.lock`);

const lockAge = async (fsp, target, now) => {
  try {
    return now() - (await fsp.stat(target)).mtimeMs;
  } catch {
    return null;
  }
};

/**
 * Remove a stale lock while holding `<lock>.break`, re-checking its age under
 * that guard, so a lock taken after the first check is never removed. Returns
 * whether the caller should retry at once (the lock is gone or was broken).
 */
const breakStaleLock = async ({ fsp, lockPath, staleMs, now, ownerDead = async () => false }) => {
  const guard = `${lockPath}.break`;
  try {
    await fsp.mkdir(guard);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    // A breaker that died inside this short section must not block forever.
    if ((await lockAge(fsp, guard, now)) > staleMs) await fsp.rm(guard, { recursive: true, force: true });
    return false;
  }
  try {
    const age = await lockAge(fsp, lockPath, now);
    if (age === null) return true;
    if (age <= staleMs && !(await ownerDead())) return false;
    await fsp.rm(lockPath, { recursive: true, force: true });
    return true;
  } finally {
    await fsp.rm(guard, { recursive: true, force: true }).catch(() => {});
  }
};

/**
 * Run `fn` while holding the named state lock.
 *
 * @param {string} name - Lock name, e.g. `formal-ai-sidecar`.
 * @param {() => Promise<any>} fn - Critical section.
 * @param {{lockPath?: string}} [options] - `lockPath` puts the lock next to state kept elsewhere.
 * @returns {Promise<any>} Whatever `fn` resolves to.
 */
export const withStateLock = async (name, fn, { env = process.env, fsImpl = fs, now = () => Date.now(), timeoutMs = DEFAULT_STATE_LOCK_TIMEOUT_MS, staleMs = DEFAULT_STATE_LOCK_STALE_MS, pollMs = DEFAULT_STATE_LOCK_POLL_MS, sleepImpl = sleep, log = null, lockPath = resolveStateLockPath(name, env), mode, isAlive = processIsAlive } = {}) => {
  const lockMode = resolveStateLockMode(mode, env);
  if (lockMode === 'none') return fn();
  const fsp = fsImpl.promises;
  await fsp.mkdir(path.dirname(lockPath), { recursive: true });
  const self = currentLockOwner(now);
  const ownerDead = async () => lockMode === 'pid' && isLockOwnerDead(await readLockOwner(fsp, lockPath), { self, isAlive });

  const deadline = now() + timeoutMs;
  for (;;) {
    try {
      await fsp.mkdir(lockPath);
      if (lockMode === 'pid') await fsp.writeFile(path.join(lockPath, OWNER_FILE), JSON.stringify(self)).catch(() => {});
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;

      const age = await lockAge(fsp, lockPath, now);
      // The holder released it between mkdir and stat; retry immediately.
      if (age === null) continue;

      const dead = age <= staleMs && (await ownerDead());
      if (age > staleMs || dead) {
        if (log) await log(dead ? `⚠️ ${name} lock holder exited without releasing it; breaking it` : `⚠️ ${name} lock held for ${Math.round(age / 1000)}s with no owner; breaking it`);
        if (await breakStaleLock({ fsp, lockPath, staleMs, now, ownerDead })) continue;
      }

      if (now() >= deadline) throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the ${name} lock at ${lockPath}`, { cause: error });
      await sleepImpl(pollMs);
    }
  }

  try {
    return await fn();
  } finally {
    try {
      await fsp.rm(lockPath, { recursive: true, force: true });
    } catch {
      // Losing the release is recoverable through the stale-lock path above.
    }
  }
};

export default { DEFAULT_STATE_LOCK_POLL_MS, DEFAULT_STATE_LOCK_STALE_MS, DEFAULT_STATE_LOCK_TIMEOUT_MS, STATE_LOCK_MODES, currentLockOwner, isLockOwnerDead, processIsAlive, resolveStateLockMode, resolveStateLockPath, withStateLock };
