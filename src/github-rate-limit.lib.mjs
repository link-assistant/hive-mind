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

const RATE_LIMIT_PATTERNS = ['api rate limit exceeded', 'rate limit exceeded', 'you have exceeded a secondary rate limit', 'secondary rate limit', 'abuse detection', 'was submitted too quickly'];

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
 * Wrap `fn` so that GitHub rate-limit errors are converted into a sleep until
 * (resetTime + bufferMs + jitterMs) followed by a retry. Non-rate-limit errors
 * are rethrown immediately so we don't mask programming bugs or 404s.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {object} [options]
 * @param {number} [options.maxAttempts] - hard cap on rate-limit retries (default `retryLimits.maxApiRetries`).
 * @param {string} [options.label] - prefix for log messages.
 * @param {(msg: string) => Promise<void>|void} [options.log] - logger. Defaults to console.warn.
 * @returns {Promise<T>}
 */
export const ghWithRateLimitRetry = async (fn, options = {}) => {
  const maxAttempts = options.maxAttempts ?? retryLimits.maxApiRetries;
  const label = options.label || 'gh';
  const log = options.log || (msg => console.warn(msg));

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error)) throw error;

      if (attempt === maxAttempts) {
        await Promise.resolve(log(`❌ ${label}: rate limit still active after ${attempt} attempts; giving up.`));
        throw error;
      }

      const reset = parseRateLimitReset(error) || (await fetchNextRateLimitReset());
      const { waitMs, deadline, bufferMs, jitterMs } = computeRateLimitWait(reset);
      const waitMinutes = Math.round(waitMs / 60_000);
      const resetSummary = reset ? `reset at ${reset.toISOString()}` : 'reset time unknown (using buffer + jitter only)';
      await Promise.resolve(log(`⏳ ${label}: GitHub API rate limit hit (attempt ${attempt}/${maxAttempts}). Waiting ${waitMinutes} min (${resetSummary}; buffer ${Math.round(bufferMs / 60_000)} min + jitter ${Math.round(jitterMs / 1000)}s) until ${deadline.toISOString()}.`));
      await sleepWithCountdown(waitMs, log);
    }
  }
  // Unreachable — loop either returns or throws.
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

export default {
  isRateLimitError,
  parseRateLimitReset,
  fetchNextRateLimitReset,
  computeRateLimitWait,
  ghWithRateLimitRetry,
  execGhWithRetry,
  wrapDollarWithGhRetry,
};
