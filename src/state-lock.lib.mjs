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
 * @see https://github.com/link-assistant/hive-mind/issues/2146
 */

import fs from 'node:fs';
import path from 'node:path';

import { resolveBotStateDir } from './session-store.lib.mjs';

export const DEFAULT_STATE_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_STATE_LOCK_STALE_MS = 15 * 60 * 1000;
export const DEFAULT_STATE_LOCK_POLL_MS = 250;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
const breakStaleLock = async ({ fsp, lockPath, staleMs, now }) => {
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
    if (age <= staleMs) return false;
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
export const withStateLock = async (name, fn, { env = process.env, fsImpl = fs, now = () => Date.now(), timeoutMs = DEFAULT_STATE_LOCK_TIMEOUT_MS, staleMs = DEFAULT_STATE_LOCK_STALE_MS, pollMs = DEFAULT_STATE_LOCK_POLL_MS, sleepImpl = sleep, log = null, lockPath = resolveStateLockPath(name, env) } = {}) => {
  const fsp = fsImpl.promises;
  await fsp.mkdir(path.dirname(lockPath), { recursive: true });

  const deadline = now() + timeoutMs;
  for (;;) {
    try {
      await fsp.mkdir(lockPath);
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;

      const age = await lockAge(fsp, lockPath, now);
      // The holder released it between mkdir and stat; retry immediately.
      if (age === null) continue;

      if (age > staleMs) {
        if (log) await log(`⚠️ ${name} lock held for ${Math.round(age / 1000)}s with no owner; breaking it`);
        if (await breakStaleLock({ fsp, lockPath, staleMs, now })) continue;
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

export default { DEFAULT_STATE_LOCK_POLL_MS, DEFAULT_STATE_LOCK_STALE_MS, DEFAULT_STATE_LOCK_TIMEOUT_MS, resolveStateLockPath, withStateLock };
