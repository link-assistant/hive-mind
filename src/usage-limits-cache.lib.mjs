/**
 * Caching for the Claude and Codex usage APIs (issue #2571).
 */
import { lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/**
 * Parse an HTTP Retry-After header (delta seconds or HTTP-date) into milliseconds.
 *
 * @param {string|null|undefined} retryAfter - Raw header value
 * @param {number} [now] - Current time in ms (for tests)
 * @returns {number|null} Milliseconds to wait, or null when absent/unparseable
 * @see https://github.com/link-assistant/hive-mind/issues/2571
 */
export function parseRetryAfterMs(retryAfter, now = Date.now()) {
  if (retryAfter === null || retryAfter === undefined || retryAfter === '') return null;
  const seconds = Number(retryAfter);
  if (!Number.isNaN(seconds)) return seconds > 0 ? Math.round(seconds * 1000) : null;
  const at = Date.parse(retryAfter);
  return Number.isNaN(at) || at <= now ? null : at - now;
}

/**
 * File identity plus a bounded content digest: same-size rewrites can share
 * mtime/ctime even with nanosecond stats on a coarse container filesystem.
 * The digest is only an internal equality key; never log it or file bytes.
 */
async function credentialsVersion(path) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat({ bigint: true });
    const limit = 1024 * 1024;
    if (!before.isFile() || before.size > BigInt(limit)) return null;
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(16 * 1024);
    let total = 0;
    while (total <= limit) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, limit + 1 - total));
      if (!bytesRead) break;
      total += bytesRead;
      if (total > limit) return null;
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat({ bigint: true });
    const identity = info => `${info.dev}:${info.ino}:${info.mtimeNs}:${info.ctimeNs}:${info.size}`;
    if (identity(before) !== identity(after) || identity(after) !== identity(await lstat(path, { bigint: true }))) return null;
    return `${identity(after)}:${hash.digest('hex')}`;
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

// Explicit cache resets must also separate pending work: an old consumer may
// still be completing after stop(). Keep coalescing within its cache instance.
const usageLimitsInFlightByCache = new WeakMap();

export const changedLimitsAuthentication = () => ({ success: false, failureKind: 'auth', error: 'Authentication changed while reading limits. Please retry.' });

// Take this snapshot before reading the bearer credential, then check it before
// dispatch and after the complete response. Digests stay internal to this module.
export async function captureLimitsAuthentication(credentialsPath, validateCredentials) {
  const version = await credentialsVersion(credentialsPath);
  return async () => version !== null && (!validateCredentials || (await validateCredentials())) && version === (await credentialsVersion(credentialsPath));
}

/**
 * Shared cache for the Claude and Codex usage APIs.
 *
 * Issue #2571: the production log has 564 Codex 401s (one every ~64s while a
 * Codex task waited) and 131 Claude 429s, often in pairs two seconds apart.
 * Before, only Claude errors containing "Rate limited" were cached — but the
 * 429 message says "has reached rate limit", so nothing was — and 401s were
 * never cached at all. Now:
 * - a 429 is cached for the longer of the usage TTL and Retry-After, unless
 *   the credentials change;
 * - an auth failure is cached until the TTL ends or the credentials file
 *   changes (the CLI refreshed the token), whichever comes first;
 * - concurrent callers share one in-flight request.
 *
 * @param {Object} params
 * @param {string} params.key - Cache key ('claude' or 'codex')
 * @param {Function} params.fetchLimits - () => Promise<result>
 * @param {string} params.credentialsPath - File identity used to version cached results
 * @param {boolean} params.verbose
 * @param {{get: Function, set: Function, delete: Function}} params.cache - The /limits cache
 * @param {number} params.ttlMs - TTL of a successful result
 * @param {Function} [params.validateCredentials] - Revalidate selected storage before using or publishing a result
 */
export async function getCachedUsageLimits({ key, fetchLimits, credentialsPath, verbose, cache, ttlMs: usageTtlMs, validateCredentials }) {
  if (validateCredentials && !(await validateCredentials())) return { success: false, failureKind: 'auth', error: 'Authentication storage is unavailable or unsafe.' };
  let usageLimitsInFlight = usageLimitsInFlightByCache.get(cache);
  if (!usageLimitsInFlight) {
    usageLimitsInFlight = new Map();
    usageLimitsInFlightByCache.set(cache, usageLimitsInFlight);
  }
  // Never reuse another home/account's result, including in-flight requests.
  key = `${key}:${resolve(credentialsPath)}`;
  const version = await credentialsVersion(credentialsPath);
  const minutes = Math.round(usageTtlMs / 60000);
  const cached = cache.get(key, usageTtlMs);
  if (cached && version !== null && cached.credentialsVersion === version) {
    if (verbose) console.log(`[VERBOSE] /limits-cache: Using cached ${key} limits (TTL: ${minutes} minutes)`);
    return cached.result;
  }
  const failure = cache.get(`${key}-failure`);
  if (failure) {
    if (version === failure.credentialsVersion) {
      if (verbose) console.log(`[VERBOSE] /limits-cache: Using cached ${key} ${failure.result.failureKind} failure (not calling the usage API again until ${new Date(failure.until).toISOString()})`);
      return failure.result;
    }
    if (verbose) console.log(`[VERBOSE] /limits-cache: ${credentialsPath} changed since the ${key} failure, fetching again`);
    cache.delete(`${key}-failure`);
  }
  const requestKey = `${key}:${version}`;
  if (usageLimitsInFlight.has(requestKey)) {
    if (verbose) console.log(`[VERBOSE] /limits-cache: Joining in-flight ${key} limits request`);
    const result = await usageLimitsInFlight.get(requestKey);
    return validateCredentials && !(await validateCredentials()) ? changedLimitsAuthentication() : result;
  }
  if (verbose) console.log(`[VERBOSE] /limits-cache: Cache miss for ${key} limits, fetching from API...`);
  const request = (async () => {
    // A retired request must neither reach the caller nor overwrite a newer
    // generation's cache entry, even when its HTTP response was successful.
    const result = await fetchLimits();
    if ((validateCredentials && !(await validateCredentials())) || version !== (await credentialsVersion(credentialsPath))) return changedLimitsAuthentication();
    if (result.success) {
      cache.set(key, { result, credentialsVersion: version }, usageTtlMs);
    } else if (result.failureKind === 'rate_limited' || result.failureKind === 'auth') {
      const ttlMs = Math.max(usageTtlMs, result.retryAfterMs || 0);
      cache.set(`${key}-failure`, { result, credentialsVersion: version, until: Date.now() + ttlMs }, ttlMs);
      if (verbose) console.log(`[VERBOSE] /limits-cache: Cached ${key} ${result.failureKind} failure for ${Math.round(ttlMs / 60000)} minutes${result.failureKind === 'auth' ? ' or until the credentials file changes' : ''}`);
    }
    return result;
  })();
  usageLimitsInFlight.set(requestKey, request);
  try {
    return await request;
  } finally {
    usageLimitsInFlight.delete(requestKey);
  }
}
