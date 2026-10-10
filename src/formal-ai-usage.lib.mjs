/**
 * "Is Formal AI actually used on this host?" (issue #2305).
 *
 * Until issue #2305 the maintenance tick treated every host as a Formal AI
 * host: it pulled `ghcr.io/link-assistant/formal-ai:latest` every five minutes,
 * booted the sidecar to verify each new release, and never removed the
 * superseded ~24 GB image — on hosts that had never run a single
 * `--model formal-ai` task.
 *
 * This module answers the one question every idle-time decision now depends
 * on, from the durable sidecar record alone:
 *
 *   - `lastUsedAt` is written whenever a lease is acquired or released, and
 *     whenever a reconcile still sees a lease (a long task is "in use" for its
 *     whole duration, not only at its start).
 *   - Records written before issue #2305 have no `lastUsedAt`; the `serving`
 *     provenance of the last acquire (issue #2208) is the same fact under an
 *     older name, so it is used as the fallback.
 *   - A record with neither has never served a task on this host.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2305
 */

/** Default idle time after which the Formal AI image is removed from the host. */
export const DEFAULT_FORMAL_AI_UNLOAD_AFTER_MS = 5 * 60 * 60 * 1000;

/** Default gap between two registry checks for a newer Formal AI image. */
export const DEFAULT_FORMAL_AI_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

const DURATION_UNITS_MS = { ms: 1, s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000, w: 7 * 24 * 60 * 60 * 1000 };
const OFF_VALUES = ['0', 'false', 'no', 'off', 'never', 'disabled'];

/**
 * Parse a duration such as `5h`, `90m`, `1h30m`, `3600s` or `250ms`.
 *
 * A bare number is seconds. `0` and `off`-like words mean "disabled" and parse
 * to `0`; anything unparseable is `null` so the caller can fall back to its
 * default instead of silently disabling a safety feature.
 *
 * @param {string|number|null|undefined} spec
 * @returns {number|null} Milliseconds, `0` for disabled, or `null` when invalid.
 */
export const parseFormalAiDurationMs = spec => {
  const raw = String(spec ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (OFF_VALUES.includes(raw)) return 0;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.round(Number(raw) * 1000);
  const compact = raw.replace(/\s+/g, '');
  if (!/^(?:\d+(?:\.\d+)?(?:ms|s|m|h|d|w))+$/.test(compact)) return null;
  let total = 0;
  for (const [, value, unit] of compact.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d|w)/g)) total += Number(value) * DURATION_UNITS_MS[unit];
  return Math.round(total);
};

const resolveDurationMs = (raw, fallback) => {
  const parsed = parseFormalAiDurationMs(raw);
  return parsed === null ? fallback : parsed;
};

/**
 * `HIVE_MIND_FORMAL_AI_UNLOAD_AFTER`: idle time before the image is removed.
 *
 * @returns {number} Milliseconds; `0` means unloading is disabled.
 */
export const resolveFormalAiUnloadAfterMs = (env = process.env) => resolveDurationMs(env.HIVE_MIND_FORMAL_AI_UNLOAD_AFTER, DEFAULT_FORMAL_AI_UNLOAD_AFTER_MS);

/** `HIVE_MIND_FORMAL_AI_UPDATE_CHECK_INTERVAL`: minimum gap between registry checks. */
export const resolveFormalAiUpdateCheckIntervalMs = (env = process.env) => resolveDurationMs(env.HIVE_MIND_FORMAL_AI_UPDATE_CHECK_INTERVAL, DEFAULT_FORMAL_AI_UPDATE_CHECK_INTERVAL_MS);

/**
 * `HIVE_MIND_FORMAL_AI_PREFETCH=true` restores the pre-#2305 behaviour: keep
 * the image on the host and follow new releases whether or not Formal AI is
 * used here. Off by default.
 */
export const isFormalAiPrefetchEnabled = (env = process.env) => {
  const raw = String(env.HIVE_MIND_FORMAL_AI_PREFETCH ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return false;
  return !OFF_VALUES.includes(raw);
};

const latestTimestamp = values => {
  let best = null;
  for (const value of values) {
    const ms = Date.parse(value ?? '');
    if (Number.isFinite(ms) && (best === null || ms > best)) best = ms;
  }
  return best;
};

/**
 * When Formal AI last served a task on this host, or `null` if it never has.
 *
 * @param {object|null} state - A `formal-ai-sidecar.json` record.
 * @returns {number|null} Epoch milliseconds.
 */
export const resolveFormalAiLastUsedMs = state => latestTimestamp([state?.lastUsedAt, state?.serving?.observedAt, ...(Array.isArray(state?.leases) ? state.leases.map(lease => lease?.acquiredAt) : [])]);

/**
 * Describe how recently Formal AI was used, relative to the unload window.
 *
 * `recent` is what gates auto-updates (issue #2305 requirement 1): an update is
 * only worth a pull and a verification boot while the host still uses Formal
 * AI. With unloading disabled, "recent" degrades to "ever used".
 *
 * @returns {{lastUsedMs: number|null, idleMs: number|null, unloadAfterMs: number, used: boolean, recent: boolean}}
 */
export const describeFormalAiUsage = ({ state, env = process.env, now = () => new Date() } = {}) => {
  const lastUsedMs = resolveFormalAiLastUsedMs(state);
  const unloadAfterMs = resolveFormalAiUnloadAfterMs(env);
  const idleMs = lastUsedMs === null ? null : Math.max(0, now().getTime() - lastUsedMs);
  const used = lastUsedMs !== null;
  const recent = used && (unloadAfterMs === 0 || idleMs <= unloadAfterMs);
  return { lastUsedMs, idleMs, unloadAfterMs, used, recent };
};

/** Render milliseconds the way operators write them in the environment (`5h`, `1h30m`, `45s`). */
export const formatFormalAiDuration = ms => {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const parts = [];
  let rest = Math.round(ms / 1000);
  for (const [unit, seconds] of [
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ]) {
    if (rest >= seconds) {
      parts.push(`${Math.floor(rest / seconds)}${unit}`);
      rest %= seconds;
    }
  }
  return parts.slice(0, 2).join('') || '0s';
};

export default {
  DEFAULT_FORMAL_AI_UNLOAD_AFTER_MS,
  DEFAULT_FORMAL_AI_UPDATE_CHECK_INTERVAL_MS,
  describeFormalAiUsage,
  formatFormalAiDuration,
  isFormalAiPrefetchEnabled,
  parseFormalAiDurationMs,
  resolveFormalAiLastUsedMs,
  resolveFormalAiUnloadAfterMs,
  resolveFormalAiUpdateCheckIntervalMs,
};
