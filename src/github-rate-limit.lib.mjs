#!/usr/bin/env node

/**
 * GitHub API rate-limit detection and retry utilities.
 *
 * Issue #1726: Hosted runners hit GitHub's 5,000/hr core API quota and bubble
 * the failure up as a generic 403/HTTP error. The wrappers in lib.mjs only
 * recognise transient TCP/TLS faults; rate-limit responses fell through and
 * crashed callers (or worse, were silently swallowed in the merge subsystem
 * making it look like "no workflows / no checks" — see
 * src/github-merge.lib.mjs:getActiveRepoWorkflows in the original log).
 *
 * The retry policy required by the issue:
 *   wait = (resetTimestamp - now) + bufferMs (10 min) + random(jitterMs) (0-5 min)
 *
 * `bufferMs` and `jitterMs` already exist in src/config.lib.mjs#limitReset
 * (added in #1236 for Claude limit waits) so we re-use them rather than
 * duplicate constants.
 */
import { promisify } from 'node:util';
import { exec as execCb } from 'node:child_process';

import { limitReset, retryLimits } from './config.lib.mjs';

const exec = promisify(execCb);

const GITHUB_RATE_LIMIT_USAGE_RESOURCES = ['core', 'graphql', 'search'];
const RATE_LIMIT_PATTERNS = ['api rate limit exceeded', 'rate limit exceeded', 'you have exceeded a secondary rate limit', 'secondary rate limit', 'abuse detection', 'was submitted too quickly'];

const githubRateLimitLogging = {
  enabled: false,
  log: null,
  fetchUsage: null,
  lastUsageByResource: null,
};

/**
 * Pull every plausible string out of a thrown error/result so pattern matches
 * survive whatever shape the upstream caller gave us (Error, exec result with
 * stdout/stderr, command-stream result, plain string, etc.).
 */
const collectErrorText = error => {
  if (!error) return '';
  if (typeof error === 'string') return error;
  const parts = [];
  if (typeof error.message === 'string') parts.push(error.message);
  if (typeof error.stderr === 'string') parts.push(error.stderr);
  else if (error.stderr && typeof error.stderr.toString === 'function') parts.push(error.stderr.toString());
  if (typeof error.stdout === 'string') parts.push(error.stdout);
  else if (error.stdout && typeof error.stdout.toString === 'function') parts.push(error.stdout.toString());
  if (error.cause) parts.push(collectErrorText(error.cause));
  return parts.join('\n');
};

/**
 * Detect whether `error` represents a GitHub rate-limit response.
 * Recognises both primary (5,000/hr) and secondary (abuse-detection) forms.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export const isRateLimitError = error => {
  const text = collectErrorText(error).toLowerCase();
  if (!text) return false;
  return RATE_LIMIT_PATTERNS.some(pattern => text.includes(pattern));
};

/**
 * Extract a `Date` for when the rate-limit window resets, in priority order:
 *   1. `X-RateLimit-Reset` header value (Unix epoch seconds) embedded in the
 *      error text — `gh` prints headers when --include is used and graphql
 *      surfaces them in the error body.
 *   2. `Retry-After` header (seconds from now).
 *   3. None — caller falls back to a polled `gh api rate_limit` lookup.
 *
 * @param {unknown} error
 * @returns {Date|null}
 */
export const parseRateLimitReset = error => {
  const text = collectErrorText(error);
  if (!text) return null;

  const resetMatch = text.match(/x-ratelimit-reset:\s*(\d+)/i);
  if (resetMatch) {
    const epochSeconds = Number(resetMatch[1]);
    if (Number.isFinite(epochSeconds) && epochSeconds > 0) {
      return new Date(epochSeconds * 1000);
    }
  }

  const retryAfterMatch = text.match(/retry-after:\s*(\d+)/i);
  if (retryAfterMatch) {
    const seconds = Number(retryAfterMatch[1]);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return new Date(Date.now() + seconds * 1000);
    }
  }

  return null;
};

/**
 * Ask `gh api rate_limit` directly when the error didn't carry a reset header.
 * Returns the most-restrictive (soonest) reset time across the resources we
 * touch (core, search, graphql) so we don't resume into a still-throttled
 * bucket.
 *
 * @returns {Promise<Date|null>}
 */
export const fetchNextRateLimitReset = async () => {
  try {
    // eslint-disable-next-line gh-rate-limit/no-direct-gh-exec -- this IS the rate-limit helper; calling itself recursively would loop.
    const { stdout } = await exec('gh api rate_limit');
    const data = JSON.parse(stdout);
    const resources = data?.resources || {};
    const candidates = [];
    for (const key of ['core', 'graphql', 'search']) {
      const r = resources[key];
      if (r && Number.isFinite(r.reset) && r.remaining === 0) {
        candidates.push(r.reset);
      }
    }
    if (candidates.length === 0) return null;
    const soonestEpoch = Math.min(...candidates);
    return new Date(soonestEpoch * 1000);
  } catch {
    return null;
  }
};

const toFiniteNumber = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizeRateLimitUsageEntry = (resource, entry) => {
  if (!resource || !entry) return null;
  const limit = toFiniteNumber(entry.limit);
  const used = toFiniteNumber(entry.used);
  const remaining = toFiniteNumber(entry.remaining);
  const reset = toFiniteNumber(entry.reset);
  if (limit === null || used === null || remaining === null) return null;
  return {
    resource,
    limit,
    used,
    remaining,
    reset,
    resetDate: reset === null ? null : new Date(reset * 1000),
  };
};

/**
 * Fetch the current GitHub API usage buckets we commonly exercise via `gh`.
 * This intentionally calls `gh api rate_limit` directly so the logging probe
 * does not recursively pass through the retry/logging wrapper it supports.
 *
 * @returns {Promise<Array<{resource: string, limit: number, used: number, remaining: number, reset: number|null, resetDate: Date|null}>>}
 */
export const fetchGitHubRateLimitUsage = async () => {
  try {
    // eslint-disable-next-line gh-rate-limit/no-direct-gh-exec -- this IS the centralized rate-limit helper; routing through itself would recurse.
    const { stdout } = await exec('gh api rate_limit');
    const data = JSON.parse(stdout);
    const resources = data?.resources || {};
    return GITHUB_RATE_LIMIT_USAGE_RESOURCES.map(resource => normalizeRateLimitUsageEntry(resource, resources[resource])).filter(Boolean);
  } catch {
    return [];
  }
};

/**
 * Enable optional debug logging of actual GitHub API quota usage after each
 * centralized `gh` wrapper attempt. Disabled by default for backward
 * compatibility and to avoid extra `gh api rate_limit` probes in normal runs.
 *
 * @param {object} [options]
 * @param {boolean} [options.enabled=false]
 * @param {(msg: string, options?: object) => Promise<void>|void} [options.log]
 * @param {() => Promise<Array<object>>} [options.fetchUsage] - injectable for tests.
 */
export const configureGitHubRateLimitLogging = ({ enabled = false, log = null, fetchUsage = null } = {}) => {
  githubRateLimitLogging.enabled = enabled === true;
  githubRateLimitLogging.log = typeof log === 'function' ? log : null;
  githubRateLimitLogging.fetchUsage = typeof fetchUsage === 'function' ? fetchUsage : fetchGitHubRateLimitUsage;
  githubRateLimitLogging.lastUsageByResource = null;
};

export const isGitHubRateLimitLoggingEnabled = () => githubRateLimitLogging.enabled;

const formatUsageReset = entry => {
  if (!(entry.resetDate instanceof Date) || Number.isNaN(entry.resetDate.getTime())) return '';
  return `, resets ${entry.resetDate.toISOString()}`;
};

const formatRateLimitUsageEntry = entry => {
  const previous = githubRateLimitLogging.lastUsageByResource?.[entry.resource];
  let deltaText = '';
  if (previous && Number.isFinite(previous.used)) {
    const delta = entry.used - previous.used;
    if (delta > 0) {
      deltaText = ` (+${delta} since last check)`;
    } else if (delta === 0) {
      deltaText = ' (no change)';
    } else {
      deltaText = ' (usage reset since last check)';
    }
  }
  return `${entry.resource}: ${entry.used}/${entry.limit} used${deltaText}, ${entry.remaining} remaining${formatUsageReset(entry)}`;
};

const safelyLogRateLimitUsage = async (logger, message, options) => {
  try {
    await Promise.resolve(logger(message, options));
  } catch {
    // Debug logging must never replace the original gh result or error.
  }
};

export const logGitHubRateLimitUsage = async ({ label = 'gh' } = {}) => {
  if (!githubRateLimitLogging.enabled) return [];
  const logger = githubRateLimitLogging.log || (msg => console.warn(msg));

  try {
    const rawUsage = await githubRateLimitLogging.fetchUsage();
    const usage = (Array.isArray(rawUsage) ? rawUsage : []).map(entry => normalizeRateLimitUsageEntry(entry.resource || entry.name, entry)).filter(Boolean);
    if (usage.length === 0) return [];

    const details = usage.map(formatRateLimitUsageEntry).join('; ');
    await safelyLogRateLimitUsage(logger, `📊 GitHub rate limits after ${label}: ${details}`);
    githubRateLimitLogging.lastUsageByResource = Object.fromEntries(usage.map(entry => [entry.resource, entry]));
    return usage;
  } catch (error) {
    if (global.verboseMode) {
      await safelyLogRateLimitUsage(logger, `⚠️ GitHub rate-limit logging failed after ${label}: ${error.message}`, { verbose: true });
    }
    return [];
  }
};

/**
 * Compute the absolute wait deadline that satisfies issue #1726:
 *   reset + bufferMs (default 10 min) + random(0..jitterMs) (default 0-5 min)
 *
 * @param {Date|null} reset
 * @returns {{ waitMs: number, deadline: Date, reset: Date|null, bufferMs: number, jitterMs: number }}
 */
export const computeRateLimitWait = (reset, now = Date.now()) => {
  const bufferMs = limitReset.bufferMs;
  const jitterMs = Math.floor(Math.random() * (limitReset.jitterMs + 1));
  const resetTime = reset instanceof Date ? reset.getTime() : null;
  const baselineWait = resetTime && resetTime > now ? resetTime - now : 0;
  const waitMs = baselineWait + bufferMs + jitterMs;
  return {
    waitMs,
    deadline: new Date(now + waitMs),
    reset: reset || null,
    bufferMs,
    jitterMs,
  };
};

/**
 * Sleep with optional periodic countdown notifications.
 *
 * @param {number} ms
 * @param {(msg: string) => Promise<void>|void} [log]
 */
const sleepWithCountdown = async (ms, log) => {
  if (ms <= 0) return;
  if (!log || ms <= 60_000) {
    await new Promise(resolve => setTimeout(resolve, ms));
    return;
  }
  let remaining = ms;
  const timer = setInterval(() => {
    remaining -= 60_000;
    if (remaining > 0) {
      const minutes = Math.round(remaining / 60_000);
      Promise.resolve(log(`⏳ Rate-limit wait: ${minutes} min remaining...`)).catch(() => {});
    }
  }, 60_000);
  try {
    await new Promise(resolve => setTimeout(resolve, ms));
  } finally {
    clearInterval(timer);
  }
};

/**
 * Patterns matched against an error's combined message/stderr/stdout to decide
 * whether the failure is a transient network/edge fault that deserves a retry.
 * Mirrors `isTransientNetworkError` in `src/lib.mjs` (issue #1536); duplicated
 * here to avoid a circular import — `lib.mjs` already imports from this file.
 *
 * Issue #1756: `gh pr create` failed with `HTTP 504: 504 Gateway Timeout
 * (https://api.github.com/graphql)`. `execGhWithRetry`/`ghWithRateLimitRetry`
 * only handled rate-limit errors before — a single 504 was fatal.
 */
const TRANSIENT_NETWORK_PATTERNS = ['i/o timeout', 'dial tcp', 'connection refused', 'connection reset', 'econnreset', 'etimedout', 'enotfound', 'ehostunreach', 'enetunreach', 'network is unreachable', 'temporary failure', 'http 502', 'http 503', 'http 504', 'bad gateway', 'service unavailable', 'gateway timeout', 'tls handshake timeout', 'ssl_error', 'socket hang up', 'unexpected eof'];

const isTransientNetworkError = error => {
  const text = collectErrorText(error).toLowerCase();
  if (!text) return false;
  return TRANSIENT_NETWORK_PATTERNS.some(pattern => text.includes(pattern));
};

/**
 * Patterns that identify a *transient* failure of GitHub's compare/diff
 * rendering endpoint (`/repos/{owner}/{repo}/compare/{base}...{head}`).
 *
 * Issue #1829: under heavy server load GitHub returns
 *   `HTTP 500: {"message":"...","errors":[{"code":"not_available",...}]}`
 * with the body "this diff is temporarily unavailable due to heavy server
 * load". This is NOT a "commits not indexed yet" condition — the branch and
 * commits are already pushed and `gh pr create` (which does not render the
 * full diff) would succeed. The readiness gate in `solve.auto-pr.lib.mjs`
 * used to treat this as fatal and abort the whole session. These patterns let
 * callers recognise the transient case and degrade gracefully instead.
 *
 * Note: HTTP 500 is deliberately matched here (and NOT in
 * `TRANSIENT_NETWORK_PATTERNS`) because a bare 500 from arbitrary endpoints is
 * too broad to retry blindly; it is only safe to treat as transient for the
 * compare endpoint, alongside the explicit "not_available" / "heavy server
 * load" markers.
 */
const TRANSIENT_COMPARE_API_PATTERNS = ['this diff is temporarily unavailable', 'temporarily unavailable due to heavy server load', 'heavy server load', 'not_available', 'http 500', 'http 502', 'http 503', 'http 504'];

/**
 * Detect whether `error` represents a transient failure of GitHub's
 * compare/diff endpoint (issue #1829). Returns true for the documented
 * "heavy server load" / `not_available` HTTP 500 response as well as the
 * standard transient gateway codes (502/503/504), so the auto-PR readiness
 * gate can fall through to PR creation rather than aborting.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
const isTransientCompareApiError = error => {
  const text = collectErrorText(error).toLowerCase();
  if (!text) return false;
  return TRANSIENT_COMPARE_API_PATTERNS.some(pattern => text.includes(pattern));
};

/**
 * Wrap `fn` so that GitHub rate-limit errors are converted into a sleep until
 * (resetTime + bufferMs + jitterMs) followed by a retry. Transient network
 * errors (504/502/503, socket hang up, TLS timeouts) get exponential backoff
 * and a separate retry budget. Other errors are rethrown immediately so we
 * don't mask programming bugs or 404s.
 *
 * Issue #1726 — rate-limit retry. Issue #1756 — transient network retry.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {object} [options]
 * @param {number} [options.maxAttempts] - hard cap on rate-limit retries (default `retryLimits.maxApiRetries`).
 * @param {number} [options.transientMaxAttempts] - hard cap on transient network retries (default `retryLimits.maxApiRetries`).
 * @param {number} [options.transientDelay] - initial transient retry delay in ms (default 1000).
 * @param {number} [options.transientBackoff] - backoff multiplier for transient retries (default 2).
 * @param {string} [options.label] - prefix for log messages.
 * @param {(msg: string) => Promise<void>|void} [options.log] - logger. Defaults to console.warn.
 * @returns {Promise<T>}
 */
export const ghWithRateLimitRetry = async (fn, options = {}) => {
  const maxAttempts = options.maxAttempts ?? retryLimits.maxApiRetries;
  const transientMaxAttempts = options.transientMaxAttempts ?? retryLimits.maxApiRetries;
  const transientDelay = options.transientDelay ?? 1000;
  const transientBackoff = options.transientBackoff ?? 2;
  const label = options.label || 'gh';
  const log = options.log || (msg => console.warn(msg));

  // Two independent retry budgets — a long string of rate-limit responses
  // shouldn't burn the transient-error retries, and vice versa.
  let rateLimitAttempts = 0;
  let transientAttempts = 0;
  let lastError;
  // Hard cap so a permanently broken endpoint can't loop forever — sum of
  // both budgets plus a safety margin.
  const hardCap = maxAttempts + transientMaxAttempts + 1;

  for (let i = 0; i < hardCap; i++) {
    try {
      const result = await fn();
      await logGitHubRateLimitUsage({ label });
      return result;
    } catch (error) {
      await logGitHubRateLimitUsage({ label });
      lastError = error;

      if (isRateLimitError(error)) {
        rateLimitAttempts++;
        if (rateLimitAttempts >= maxAttempts) {
          await Promise.resolve(log(`❌ ${label}: rate limit still active after ${rateLimitAttempts} attempts; giving up.`));
          throw error;
        }
        const reset = parseRateLimitReset(error) || (await fetchNextRateLimitReset());
        const { waitMs, deadline, bufferMs, jitterMs } = computeRateLimitWait(reset);
        const waitMinutes = Math.round(waitMs / 60_000);
        const resetSummary = reset ? `reset at ${reset.toISOString()}` : 'reset time unknown (using buffer + jitter only)';
        await Promise.resolve(log(`⏳ ${label}: GitHub API rate limit hit (attempt ${rateLimitAttempts}/${maxAttempts}). Waiting ${waitMinutes} min (${resetSummary}; buffer ${Math.round(bufferMs / 60_000)} min + jitter ${Math.round(jitterMs / 1000)}s) until ${deadline.toISOString()}.`));
        await sleepWithCountdown(waitMs, log);
        continue;
      }

      if (isTransientNetworkError(error)) {
        transientAttempts++;
        if (transientAttempts >= transientMaxAttempts) {
          await Promise.resolve(log(`❌ ${label}: transient network error persisted after ${transientAttempts} attempts; giving up.`));
          throw error;
        }
        const waitMs = transientDelay * Math.pow(transientBackoff, transientAttempts - 1);
        await Promise.resolve(log(`⚠️ ${label}: transient network error (attempt ${transientAttempts}/${transientMaxAttempts}), retrying in ${Math.round(waitMs / 1000)}s...`));
        await sleepWithCountdown(waitMs, log);
        continue;
      }

      throw error;
    }
  }
  // Unreachable — loop either returns or throws via the budgets above.
  throw lastError;
};

/**
 * Convenience wrapper around child_process.exec that retries on rate-limit
 * errors. Use it for callers that build a `gh` command string and want the
 * existing exec-based ergonomics.
 *
 * @param {string} command
 * @param {object} [options] - forwarded to ghWithRateLimitRetry, plus `execOptions`.
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
export const execGhWithRetry = async (command, options = {}) => {
  const { execOptions, ...retryOptions } = options;
  return ghWithRateLimitRetry(() => exec(command, execOptions), {
    label: retryOptions.label || `gh exec (${command.split(/\s+/).slice(0, 3).join(' ')})`,
    ...retryOptions,
  });
};

/**
 * Wrap a command-stream `$` tagged-template so every `$gh ...` it issues is
 * retried on rate-limit errors. Returns a callable that delegates to the
 * underlying `$` for non-`gh` commands and through `ghWithRateLimitRetry` for
 * `gh ...` commands.
 *
 * Usage at the top of a file:
 *   const { $: rawDollar } = await use('command-stream');
 *   const $ = wrapDollarWithGhRetry(rawDollar);
 *
 * @template T
 * @param {(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>} dollar
 * @param {object} [options] - forwarded to ghWithRateLimitRetry per call.
 * @returns {(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>}
 */
export const wrapDollarWithGhRetry = (dollar, options = {}) => {
  const wrapped = (strings, ...values) => {
    // Reconstruct the literal command for inspection (sufficient — leading
    // `gh ` is what we care about).
    let preview = '';
    for (let i = 0; i < strings.length; i++) {
      preview += strings[i];
      if (i < values.length) preview += String(values[i] ?? '');
    }
    const isGh = /^\s*gh(?:\s|$)/.test(preview);
    if (!isGh) return dollar(strings, ...values);
    return ghWithRateLimitRetry(() => dollar(strings, ...values), {
      label: `$gh (${preview.trim().split(/\s+/).slice(0, 3).join(' ')})`,
      ...options,
    });
  };
  // Preserve a reference to the underlying $ for consumers that need it.
  wrapped.raw = dollar;
  return wrapped;
};

export { isTransientNetworkError, isTransientCompareApiError };

export default {
  isRateLimitError,
  isTransientNetworkError,
  isTransientCompareApiError,
  parseRateLimitReset,
  fetchNextRateLimitReset,
  fetchGitHubRateLimitUsage,
  configureGitHubRateLimitLogging,
  isGitHubRateLimitLoggingEnabled,
  logGitHubRateLimitUsage,
  computeRateLimitWait,
  ghWithRateLimitRetry,
  execGhWithRetry,
  wrapDollarWithGhRetry,
};
