/**
 * Shared rate limit, cache and request de-duplication for status probes.
 *
 * Issue #3614: the Telegram bot asked Docker and start-command for the state of
 * the same container or session up to about 95 times a minute. Every caller
 * (the session monitor, the queue's processing count, /limits, /queue, /log,
 * /terminal_watch and the CPU penalty) ran its own `$ --status`, `docker
 * inspect`, `pgrep` or `which` process, and callers that asked at the same
 * moment each started their own. This module gives all of them one place to
 * ask:
 *
 * - a result is reused for `minIntervalMs` (default 5 s, so at most 12 checks
 *   per minute per checked resource), counted from when the check finished;
 * - callers that ask while a check is running await that same check instead
 *   of starting another one;
 * - a state change the bot causes itself (launching or stopping a task) can
 *   invalidate an entry so the next caller sees it immediately.
 *
 * The interval is configured with `HIVE_MIND_DOCKER_STATUS_MIN_INTERVAL_MS` or
 * the bot's `--docker-status-min-interval-ms` option. `0` turns the time-based
 * reuse off but keeps the de-duplication of concurrent callers.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3614
 */
import { clampEnvValue, parseIntegerEnv } from './env-config.lib.mjs';

export const DOCKER_STATUS_MIN_INTERVAL_ENV = 'HIVE_MIND_DOCKER_STATUS_MIN_INTERVAL_MS';
export const DEFAULT_DOCKER_STATUS_MIN_INTERVAL_MS = 5000;

/**
 * Read the minimum interval between two checks of the same resource from the
 * environment. Negative values are raised to 0 (no time-based reuse).
 *
 * @returns {number}
 */
export function resolveDockerStatusMinIntervalMs() {
  const value = parseIntegerEnv(DOCKER_STATUS_MIN_INTERVAL_ENV, DEFAULT_DOCKER_STATUS_MIN_INTERVAL_MS, { scope: 'status-check-cache' });
  return clampEnvValue(DOCKER_STATUS_MIN_INTERVAL_ENV, value, { minimum: 0, scope: 'status-check-cache' });
}

/**
 * Normalize an interval given on the command line or by a caller.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function normalizeMinIntervalMs(value, fallback = DEFAULT_DOCKER_STATUS_MIN_INTERVAL_MS) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}

const SWEEP_THRESHOLD = 500;

/**
 * Create a keyed cache whose loaders run at most once per `minIntervalMs` and
 * never twice at the same time.
 *
 * @param {object} [options]
 * @param {number|(() => number)} [options.minIntervalMs] - Interval, or a getter read on every lookup
 * @param {() => number} [options.now] - Clock (injectable for tests)
 * @param {(value: any) => any} [options.clone] - Copy applied to every returned value so callers cannot change the shared one
 */
export function createStatusCheckCache({ minIntervalMs = DEFAULT_DOCKER_STATUS_MIN_INTERVAL_MS, now = Date.now, clone = value => value } = {}) {
  let intervalSource = minIntervalMs;
  const entries = new Map(); // key -> { value, at }
  const inflight = new Map(); // key -> { promise, generation }
  const generations = new Map(); // key -> number, bumped by invalidate()
  const running = new Map(); // key -> loaders still running, including ones invalidate() detached
  let clearGeneration = 0;
  const stats = { hits: 0, misses: 0, inflightJoins: 0, invalidations: 0 };

  const intervalMs = () => normalizeMinIntervalMs(typeof intervalSource === 'function' ? intervalSource() : intervalSource);
  const generationOf = key => `${clearGeneration}:${generations.get(key) || 0}`;

  /**
   * Return the cached value for `key`, join a running check, or run `loader`.
   * A loader that throws is not cached: the error reaches every joined caller
   * and the next lookup tries again.
   *
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} loader
   * @returns {Promise<T>}
   */
  async function get(key, loader) {
    const entry = entries.get(key);
    const interval = intervalMs();
    if (entry && interval > 0 && now() - entry.at < interval) {
      stats.hits += 1;
      return clone(entry.value);
    }
    const joined = inflight.get(key);
    if (joined) {
      stats.inflightJoins += 1;
      return clone(await joined.promise);
    }
    stats.misses += 1;
    if (entries.size + generations.size > SWEEP_THRESHOLD) sweep(interval);
    const generation = generationOf(key);
    const promise = (async () => loader())();
    const record = { promise, generation };
    inflight.set(key, record);
    running.set(key, (running.get(key) || 0) + 1);
    try {
      const value = await promise;
      // A check that started before invalidate()/clear() may describe the old
      // state; it still answers the callers that waited for it, but it must not
      // be served to anyone who asks after the invalidation.
      if (generationOf(key) === generation) entries.set(key, { value, at: now() });
      return clone(value);
    } finally {
      if (inflight.get(key) === record) inflight.delete(key);
      if (running.get(key) > 1) running.set(key, running.get(key) - 1);
      else running.delete(key);
    }
  }

  // Sessions come and go for the bot's whole lifetime: drop expired entries,
  // and generation counters with no check running, once there are many.
  function sweep(interval) {
    const cutoff = now() - interval;
    for (const [key, entry] of entries) if (!(entry.at > cutoff)) entries.delete(key);
    for (const key of generations.keys()) if (!running.has(key)) generations.delete(key);
  }

  /** Forget `key` so the next lookup runs a fresh check. */
  function invalidate(key) {
    stats.invalidations += 1;
    entries.delete(key);
    inflight.delete(key);
    generations.set(key, (generations.get(key) || 0) + 1);
  }

  /** Forget every key whose name starts with `prefix`. */
  function invalidatePrefix(prefix) {
    const keys = new Set([...entries.keys(), ...inflight.keys()]);
    for (const key of keys) if (key.startsWith(prefix)) invalidate(key);
  }

  /** Forget everything. */
  function clear() {
    entries.clear();
    inflight.clear();
    generations.clear();
    clearGeneration += 1;
  }

  return {
    get,
    invalidate,
    invalidatePrefix,
    clear,
    setMinIntervalMs(value) {
      intervalSource = value;
    },
    getMinIntervalMs: intervalMs,
    getStats: () => ({ ...stats, entries: entries.size, inflight: inflight.size }),
    resetStats() {
      for (const name of Object.keys(stats)) stats[name] = 0;
    },
  };
}

// The configured interval for the bot process. `null` means "not set by the
// CLI": the environment is read instead, so tests and child scripts that only
// set the env var behave the same as the bot.
let configuredMinIntervalMs = null;

/**
 * Set the interval for every shared status check in this process (the bot's
 * `--docker-status-min-interval-ms` option). Pass `null` to fall back to the
 * environment again.
 *
 * @param {number|string|null} value
 * @returns {number} The interval now in effect
 */
export function configureDockerStatusMinIntervalMs(value) {
  configuredMinIntervalMs = value === null || value === undefined ? null : normalizeMinIntervalMs(value, resolveDockerStatusMinIntervalMs());
  return getDockerStatusMinIntervalMs();
}

/** The interval in effect for shared status checks in this process. */
export function getDockerStatusMinIntervalMs() {
  return configuredMinIntervalMs ?? resolveDockerStatusMinIntervalMs();
}

/**
 * The cache shared by every status probe in the bot process. Keys are
 * namespaced by probe, e.g. `status:<session>`, `docker-ps`, `pgrep`.
 */
export const statusCheckCache = createStatusCheckCache({ minIntervalMs: getDockerStatusMinIntervalMs });

/**
 * Forget every cached probe that may describe `sessionId` (and the listings
 * that include it). Call after the bot launches, stops or kills a session.
 *
 * @param {string|null|undefined} sessionId
 */
export function invalidateSessionStatus(sessionId) {
  if (sessionId) {
    statusCheckCache.invalidate(`status:${sessionId}`);
    statusCheckCache.invalidate(`tmux:${sessionId}`);
    statusCheckCache.invalidate(`docker-state:${sessionId}`);
    statusCheckCache.invalidate(`docker-id:${String(sessionId).replace(/^\//, '')}`);
  }
  statusCheckCache.invalidate('list');
  statusCheckCache.invalidate('docker-ps');
  statusCheckCache.invalidate('screen-ls');
  statusCheckCache.invalidate('pgrep');
}

/** Test helper: forget all cached probes and counters. */
export function resetStatusCheckCacheForTests() {
  statusCheckCache.clear();
  statusCheckCache.resetStats();
}
