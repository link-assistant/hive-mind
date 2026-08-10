/**
 * Cross-process exclusive locks over the durable bot state directory.
 *
 * Issue #2146 introduced two background maintainers — the Formal AI sidecar
 * lifecycle and the agentic-CLI refresh — that must never interleave with the
 * work they maintain. Both need the same primitive, so it lives here once.
 *
 * `mkdir` is the lock: it is atomic on every filesystem the bot runs on, unlike
 * "check then create" with a regular file. A lock older than `staleMs` is
 * broken so a killed process cannot deadlock the bot forever.
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

/**
 * Run `fn` while holding the named state lock.
 *
 * @param {string} name - Lock name, e.g. `formal-ai-sidecar`.
 * @param {() => Promise<any>} fn - Critical section.
 * @returns {Promise<any>} Whatever `fn` resolves to.
 */
export const withStateLock = async (name, fn, { env = process.env, fsImpl = fs, now = () => Date.now(), timeoutMs = DEFAULT_STATE_LOCK_TIMEOUT_MS, staleMs = DEFAULT_STATE_LOCK_STALE_MS, pollMs = DEFAULT_STATE_LOCK_POLL_MS, sleepImpl = sleep, log = null } = {}) => {
  const lockPath = resolveStateLockPath(name, env);
  fsImpl.mkdirSync(path.dirname(lockPath), { recursive: true });

  const deadline = now() + timeoutMs;
  for (;;) {
    try {
      fsImpl.mkdirSync(lockPath);
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;

      let age;
      try {
        age = now() - fsImpl.statSync(lockPath).mtimeMs;
      } catch {
        // The holder released it between mkdir and stat; retry immediately.
        continue;
      }

      if (age > staleMs) {
        if (log) await log(`⚠️ ${name} lock held for ${Math.round(age / 1000)}s with no owner; breaking it`);
        try {
          fsImpl.rmSync(lockPath, { recursive: true, force: true });
        } catch {
          // Another waiter won the race; retry normally.
        }
        continue;
      }

      if (now() >= deadline) throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the ${name} lock at ${lockPath}`, { cause: error });
      await sleepImpl(pollMs);
    }
  }

  try {
    return await fn();
  } finally {
    try {
      fsImpl.rmSync(lockPath, { recursive: true, force: true });
    } catch {
      // Losing the release is recoverable through the stale-lock path above.
    }
  }
};

export default { DEFAULT_STATE_LOCK_POLL_MS, DEFAULT_STATE_LOCK_STALE_MS, DEFAULT_STATE_LOCK_TIMEOUT_MS, resolveStateLockPath, withStateLock };
