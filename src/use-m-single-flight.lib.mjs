#!/usr/bin/env node

/**
 * Single-flight layer for `use-m` package loading (issue #2113).
 *
 * Root cause this file addresses
 * -----------------------------
 * `use-m` installs every package it resolves with a *global* npm install:
 *
 *     npm install -g <pkg>-v-<version>@npm:<pkg>@<version>
 *
 * and it has no in-flight deduplication — every `use(specifier)` call runs the
 * full `ensurePackageInstalled` → `installPackage` path. Hive Mind has 36
 * modules under `src/` whose module body starts with a top-level
 * `await use('command-stream')`, and Node evaluates sibling top-level-await
 * subgraphs *concurrently*. On a cold container that means dozens of
 * simultaneous `npm install -g command-stream-v-latest@npm:command-stream@latest`
 * processes writing into the same global `node_modules` directory.
 *
 * npm has no cross-process locking for the global prefix, so those installs
 * delete and re-extract each other's trees. The two symptoms recorded in the
 * issue are exactly what that race produces (both reproduced in
 * `experiments/issue-2113/reproduce-concurrent-install-race.mjs`):
 *
 *   * `npm error ENOTEMPTY: directory not empty, rmdir
 *     '<...>/command-stream-v-latest/examples'` — one npm is removing the alias
 *     while another is extracting into it, so the directory it just emptied is
 *     repopulated before the `rmdir`;
 *   * a half-extracted tree that imports fine at the entry point but throws
 *     `ERR_MODULE_NOT_FOUND` for an arbitrary internal file
 *     (`shell-parser.mjs`, `terminal-capture.mjs`, `$.trace.mjs`).
 *
 * Retrying cannot fix this, because every retry re-enters the same race with
 * the same 30-odd competitors — which is why use-m's own 3 install attempts and
 * `useWithRetry`'s backoff both failed in the logs attached to the issue.
 *
 * The fix
 * -------
 * Make the install happen **once**:
 *
 *   1. in-process memoisation per specifier — the 36 concurrent
 *      `use('command-stream')` calls collapse into one load (this also removes
 *      35 redundant `npm show command-stream version` network round-trips);
 *   2. an in-process mutex per npm *alias* — different specifiers that map to
 *      the same alias (`yargs@17.7.2` and `yargs@17.7.2/helpers`) are
 *      serialised, because they install the same directory;
 *   3. a cross-process advisory lock per alias — two Hive Mind processes
 *      started at the same time (worker + monitor, CI matrix jobs) share one
 *      global `node_modules`, so the lock has to outlive a single process.
 *
 * The lock is deliberately *advisory and self-healing*: it is an atomic
 * `mkdir`, refreshed by a heartbeat, stolen when stale, and abandoned (with a
 * diagnostic) after a timeout. A stuck lock therefore degrades to today's
 * behaviour instead of hanging Hive Mind.
 */

import os from 'node:os';
import path from 'node:path';
import { isBuiltin } from 'node:module';
import { USE_RETRY_WRAPPED } from './use-with-retry.lib.mjs';

export const DEFAULT_HEARTBEAT_MS = 1000;
export const DEFAULT_STALE_MS = 15000;
export const DEFAULT_POLL_MS = 100;
export const DEFAULT_TIMEOUT_MS = 300000;

const USE_SINGLE_FLIGHT_WRAPPED = Symbol.for('hive-mind.use-m-single-flight.wrapped');

// Mirrors use-m's own parser (`parseModuleSpecifier`) so the alias computed
// here is byte-identical to the directory npm will create.
const SPECIFIER_PATTERN = /^(?<packageName>(@[^@/]+\/)?[^@/]+)?(?:@(?<version>[^/]*))?(?<modulePath>(?:\/[^@]+)*)?$/;

/**
 * @param {string} specifier
 * @returns {{ packageName: string, version: string, modulePath: string } | null}
 *   `null` for anything that use-m will not install from npm (builtins,
 *   relative/absolute paths, unparseable input).
 */
export const parseSpecifier = specifier => {
  if (typeof specifier !== 'string' || specifier.trim() === '') return null;
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return null;
  const match = specifier.match(SPECIFIER_PATTERN);
  const packageName = match?.groups?.packageName;
  if (typeof packageName !== 'string' || packageName.trim() === '') return null;
  const version = typeof match.groups.version === 'string' && match.groups.version.trim() !== '' ? match.groups.version : 'latest';
  const modulePath = typeof match.groups.modulePath === 'string' ? match.groups.modulePath : '';
  return { packageName, version, modulePath };
};

/**
 * The global `node_modules` directory name use-m installs into, e.g.
 * `use('command-stream')` → `command-stream-v-latest`.
 *
 * @param {string} specifier
 * @returns {string | null}
 */
export const aliasForSpecifier = specifier => {
  const parsed = parseSpecifier(specifier);
  if (!parsed) return null;
  return `${parsed.packageName.replace('@', '').replace('/', '-')}-v-${parsed.version}`;
};

/**
 * Does loading this specifier run `npm install -g`?
 *
 * `use('fs')`, `use('path')` and `use('os')` account for 57 of Hive Mind's 128
 * `use()` call sites; use-m answers them from its built-in resolver without
 * touching npm, so they must not pay for (or wait on) an install lock. They are
 * still memoised — 26 identical `use('fs')` calls should resolve one promise.
 *
 * @param {string} specifier
 * @returns {boolean}
 */
export const installsFromNpm = specifier => {
  const parsed = parseSpecifier(specifier);
  if (!parsed) return false;
  return !isBuiltin(`${parsed.packageName}${parsed.modulePath}`);
};

export const defaultLockRoot = () => process.env.HIVE_MIND_USE_M_LOCK_DIR || path.join(os.tmpdir(), 'hive-mind-use-m-locks');

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const defaultLog = message => {
  if (process.env.HIVE_MIND_USE_M_DEBUG || process.argv.includes('--verbose')) {
    console.error(`[use-m] ${message}`);
  }
};

// `/` and `@` never survive alias generation, but a caller may lock on an
// arbitrary key in tests — keep the lock directory name filesystem-safe.
const lockDirectoryFor = (lockRoot, key) => path.join(lockRoot, `${key.replace(/[^\w.@-]+/g, '_')}.lock`);

const noopRelease = async () => {};

/**
 * Acquire a cross-process advisory lock for one npm alias.
 *
 * The lock is a directory: `mkdir` is atomic on every filesystem Hive Mind runs
 * on (ext4, overlayfs, fuse-overlayfs in the DinD image, tmpfs, APFS), unlike
 * `writeFile` with `flag: 'wx'` on network filesystems.
 *
 * @param {string} key - alias name.
 * @param {object} [options]
 * @param {string} [options.lockRoot]
 * @param {number} [options.heartbeatMs] - how often the owner refreshes mtime.
 * @param {number} [options.staleMs] - age after which a lock may be stolen.
 * @param {number} [options.pollMs] - wait between acquisition attempts.
 * @param {number} [options.timeoutMs] - give up (and proceed unlocked) after this.
 * @param {object} [options.fs] - injectable `node:fs/promises`.
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {() => number} [options.now]
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<{ acquired: boolean, path: string, release: () => Promise<void> }>}
 */
export const acquireAliasLock = async (key, options = {}) => {
  const fs = options.fs ?? (await import('node:fs/promises'));
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const log = options.log ?? defaultLog;
  const lockRoot = options.lockRoot ?? defaultLockRoot();
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const lockPath = lockDirectoryFor(lockRoot, key);
  const startedAt = now();

  try {
    await fs.mkdir(lockRoot, { recursive: true });
  } catch (error) {
    // A lock root we cannot create means no cross-process protection; the
    // in-process layers still dedupe, so continue instead of failing the load.
    log(`lock root ${lockRoot} is unusable (${error?.message}); continuing without a cross-process lock`);
    return { acquired: false, path: lockPath, release: noopRelease };
  }

  for (;;) {
    try {
      await fs.mkdir(lockPath);
      // Best-effort ownership breadcrumb: it makes a stuck lock diagnosable
      // (`cat /tmp/hive-mind-use-m-locks/<alias>.lock/owner.json`) but nothing
      // depends on it being readable.
      await fs.writeFile(path.join(lockPath, 'owner.json'), `${JSON.stringify({ pid: process.pid, hostname: os.hostname(), key, startedAt: new Date(startedAt).toISOString() }, null, 2)}\n`).catch(() => {});
      log(`acquired install lock for '${key}' at ${lockPath}`);

      // Keep the mtime fresh so other processes do not mistake a slow install
      // (a cold `npm install -g` can take a minute) for a crashed owner.
      const heartbeat = setInterval(() => {
        const stamp = new Date(now());
        Promise.resolve(fs.utimes(lockPath, stamp, stamp)).catch(() => {});
      }, heartbeatMs);
      heartbeat.unref?.();

      let released = false;
      const release = async () => {
        if (released) return;
        released = true;
        clearInterval(heartbeat);
        try {
          await fs.rm(lockPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        } catch (error) {
          log(`failed to release install lock ${lockPath}: ${error?.message}`);
        }
      };
      return { acquired: true, path: lockPath, release };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        log(`could not create install lock ${lockPath} (${error?.message}); continuing without a cross-process lock`);
        return { acquired: false, path: lockPath, release: noopRelease };
      }
    }

    const stats = await fs.stat(lockPath).catch(() => null);
    if (!stats) continue; // owner released between mkdir and stat — retry immediately.

    const age = now() - stats.mtimeMs;
    if (age > staleMs) {
      log(`stealing stale install lock ${lockPath} (idle for ${Math.round(age)}ms)`);
      await fs.rm(lockPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
      continue;
    }

    if (now() - startedAt > timeoutMs) {
      log(`timed out after ${timeoutMs}ms waiting for install lock ${lockPath}; proceeding without it`);
      return { acquired: false, path: lockPath, release: noopRelease };
    }

    await sleep(pollMs);
  }
};

/**
 * Serialise `fn` against every other caller holding the same alias, in this
 * process and across processes.
 *
 * @param {string} key
 * @param {() => Promise<T>} fn
 * @param {object} [options] - forwarded to {@link acquireAliasLock}.
 * @returns {Promise<T>}
 * @template T
 */
export const withAliasLock = async (key, fn, options = {}) => {
  if (options.disabled) return fn();
  const lock = await acquireAliasLock(key, options);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
};

const createState = () => ({ inflight: new Map(), chains: new Map() });

let sharedState = createState();

/** Drop memoised loads and alias chains (tests only). */
export const resetSingleFlightState = () => {
  sharedState = createState();
};

const runOnAliasChain = (state, alias, fn) => {
  const previous = state.chains.get(alias) ?? Promise.resolve();
  // `.then(fn, fn)` so a failed predecessor does not strand the queue.
  const result = previous.then(fn, fn);
  const tail = result.then(
    () => {},
    () => {}
  );
  state.chains.set(alias, tail);
  tail.then(() => {
    if (state.chains.get(alias) === tail) state.chains.delete(alias);
  });
  return result;
};

/**
 * Wrap a `use` function so concurrent loads of the same package collapse into a
 * single npm install.
 *
 * Composition order matters: single-flight must sit **outside**
 * `wrapUseWithRetry`, so that the retry/repair logic (which deletes and
 * reinstalls the alias directory) also runs under the lock. The wrapper carries
 * both wrapper symbols, which keeps `ensureUseM()` idempotent — re-wrapping an
 * already-protected `globalThis.use` returns it unchanged instead of nesting
 * retries inside locks inside retries.
 *
 * @param {Function} use
 * @param {object} [options]
 * @param {boolean} [options.disabled] - skip the cross-process lock only.
 * @param {object} [options.state] - injectable memo/chain state (tests).
 * @returns {Function}
 */
export const wrapUseWithSingleFlight = (use, options = {}) => {
  if (typeof use !== 'function' || use[USE_SINGLE_FLIGHT_WRAPPED]) return use;
  const log = options.log ?? defaultLog;
  const disabled = options.disabled ?? Boolean(process.env.HIVE_MIND_USE_M_NO_LOCK);

  const wrapped = (specifier, ...args) => {
    const state = options.state ?? sharedState;
    const alias = aliasForSpecifier(specifier);
    // Relative imports resolve against the *caller's* directory, so neither
    // memoising nor serialising them is safe — pass them straight through.
    if (!alias) return use(specifier, ...args);

    // Issue #2113: both failing runs were started with `--verbose` and the log
    // showed only the final crash. Tracing every load (specifier, alias,
    // duration) is what makes the next incident diagnosable from the log alone.
    const call = async () => {
      const startedAt = Date.now();
      log(`use('${specifier}') loading (alias ${alias})`);
      try {
        const module = await use(specifier, ...args);
        log(`use('${specifier}') loaded in ${Date.now() - startedAt}ms`);
        return module;
      } catch (error) {
        log(`use('${specifier}') failed after ${Date.now() - startedAt}ms: ${error?.message}`);
        throw error;
      }
    };
    // Only npm-backed specifiers need the alias mutex and the file lock; a
    // built-in has no install step to protect.
    const start = installsFromNpm(specifier) ? () => runOnAliasChain(state, alias, () => withAliasLock(alias, call, { ...options, disabled, log })) : call;

    // Extra arguments select a different resolver/context, so results are not
    // interchangeable; those calls skip the memo but still take the lock.
    if (args.length > 0) return start();

    const pending = state.inflight.get(specifier);
    if (pending) {
      log(`use('${specifier}') joined an in-flight load (alias ${alias})`);
      return pending;
    }

    const promise = start();
    state.inflight.set(specifier, promise);
    // Successful loads stay memoised for the process lifetime (Node caches the
    // module anyway); failures are evicted so a later call can retry.
    promise.catch(() => {
      if (state.inflight.get(specifier) === promise) state.inflight.delete(specifier);
    });
    return promise;
  };

  Object.defineProperty(wrapped, USE_SINGLE_FLIGHT_WRAPPED, { value: true });
  // Claim the retry symbol too: `wrapUseWithRetry` is always applied first
  // (see ensureUseM), so an outer re-wrap would invert the intended order.
  Object.defineProperty(wrapped, USE_RETRY_WRAPPED, { value: true });
  return wrapped;
};
