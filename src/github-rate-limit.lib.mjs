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

import { limitReset, retryLimits, timeouts } from './config.lib.mjs';

const exec = promisify(execCb);

/**
 * Issue #1811: typed error raised when a `gh` shell call exceeds its
 * per-call timeoutMs. Carries `timeoutMs` and `command` for diagnostics and
 * is recognised as transient by `isTransientNetworkError` so callers' retry
 * budgets apply (unless `retryOnTimeout: false`).
 */
export class GhTimeoutError extends Error {
  constructor(message, { timeoutMs, command } = {}) {
    super(message);
    this.name = 'GhTimeoutError';
    this.code = 'GH_TIMEOUT';
    this.timeoutMs = timeoutMs;
    this.command = command;
  }
}

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
  // Issue #1811: GhTimeoutError is transient by construction — let the
  // caller's retry budget apply unless they opted out with retryOnTimeout.
  if (error instanceof GhTimeoutError) return true;
  const text = collectErrorText(error).toLowerCase();
  if (!text) return false;
  return TRANSIENT_NETWORK_PATTERNS.some(pattern => text.includes(pattern));
};

/**
 * Issue #1811: wrap a Promise-returning `fn` so that if it does not resolve
 * within `timeoutMs`, the returned promise rejects with a `GhTimeoutError`.
 * The wrapper also passes an `AbortSignal` to `fn`, allowing callers (e.g. a
 * `command-stream` `$({ signal })`-wrapped tagged template) to actually kill
 * the spawned child instead of just abandoning the Promise.
 *
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} fn
 * @param {object} [options]
 * @param {number} [options.timeoutMs] - 0/undefined disables the timeout.
 * @param {string} [options.commandPreview] - short string for the error message.
 * @returns {Promise<T>}
 */
export const callWithTimeout = (fn, { timeoutMs = 0, commandPreview = '' } = {}) => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    // Pass a never-aborting signal so `fn` can rely on a stable signature.
    return Promise.resolve(fn(new AbortController().signal));
  }
  const controller = new AbortController();
  let timer = null;
  const timeoutPromise = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new GhTimeoutError(`gh call exceeded ${timeoutMs}ms${commandPreview ? `: ${commandPreview}` : ''}`, { timeoutMs, command: commandPreview }));
    }, timeoutMs);
    // NB: we deliberately do NOT `timer.unref()` here. The timer is always
    // cleared in `fnPromise.finally()` so there is no leak, and an unref'd
    // timer would let Node exit before firing whenever nothing else keeps the
    // event loop alive (e.g. in unit tests with a synthetic never-resolving fn
    // and no other pending I/O).
  });
  const fnPromise = Promise.resolve()
    .then(() => fn(controller.signal))
    .finally(() => {
      if (timer) clearTimeout(timer);
    });
  // Silence whichever promise loses the race so its rejection does not surface
  // as an unhandled rejection. The winner is still observed by the caller.
  fnPromise.catch(() => {});
  timeoutPromise.catch(() => {});
  return Promise.race([fnPromise, timeoutPromise]);
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
 * @param {number} [options.timeoutMs] - issue #1811: per-call timeout in ms. If
 *        the wrapped `fn` accepts an `AbortSignal` (as the wrapper produced by
 *        `wrapDollarWithGhRetry` does), the spawned `gh` child is sent
 *        SIGTERM via that signal on timeout. 0/undefined disables.
 * @param {boolean} [options.retryOnTimeout=true] - whether a `GhTimeoutError`
 *        should be retried (using the transient-error budget) or rethrown
 *        immediately. Default true to match other transient errors.
 * @param {string} [options.commandPreview] - short string included in timeout
 *        errors and verbose logs (e.g. "gh api user").
 * @returns {Promise<T>}
 */
export const ghWithRateLimitRetry = async (fn, options = {}) => {
  const maxAttempts = options.maxAttempts ?? retryLimits.maxApiRetries;
  const transientMaxAttempts = options.transientMaxAttempts ?? retryLimits.maxApiRetries;
  const transientDelay = options.transientDelay ?? 1000;
  const transientBackoff = options.transientBackoff ?? 2;
  const label = options.label || 'gh';
  const log = options.log || (msg => console.warn(msg));
  const timeoutMs = options.timeoutMs ?? 0;
  const retryOnTimeout = options.retryOnTimeout !== false;
  const commandPreview = options.commandPreview || label;

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
      // Issue #1811: route every attempt through callWithTimeout so the
      // spawned `gh` child is killed (via AbortSignal) when it hangs.
      const result = await callWithTimeout(signal => fn(signal), { timeoutMs, commandPreview });
      await logGitHubRateLimitUsage({ label });
      return result;
    } catch (error) {
      await logGitHubRateLimitUsage({ label });
      lastError = error;

      // Issue #1811: surface timeouts explicitly and (by default) feed them
      // back into the transient-error retry bucket.
      if (error instanceof GhTimeoutError) {
        if (!retryOnTimeout) {
          await Promise.resolve(log(`❌ ${label}: timed out after ${error.timeoutMs}ms (retryOnTimeout=false); giving up.`));
          throw error;
        }
        transientAttempts++;
        if (transientAttempts >= transientMaxAttempts) {
          await Promise.resolve(log(`❌ ${label}: timed out after ${error.timeoutMs}ms and exhausted ${transientAttempts} retries; giving up.`));
          throw error;
        }
        const waitMs = transientDelay * Math.pow(transientBackoff, transientAttempts - 1);
        await Promise.resolve(log(`⚠️ ${label}: timed out after ${error.timeoutMs}ms (attempt ${transientAttempts}/${transientMaxAttempts}), retrying in ${Math.round(waitMs / 1000)}s...`));
        await sleepWithCountdown(waitMs, log);
        continue;
      }

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
 * Issue #1811: the returned wrapper is callable in two forms:
 *   $`gh api user`                      // legacy tagged-template form
 *   $({ timeoutMs: 15000 })`gh api ...` // options form, sets per-call timeout
 * Options-form usage returns a tagged-template function that inherits the
 * wrapper's `defaultTimeoutMs` and merges any caller-provided overrides
 * (timeoutMs, retryOnTimeout, log, verbose, label). The wrapper also accepts
 * a top-level `defaultTimeoutMs` (defaults to `timeouts.ghApiMs` from
 * config.lib.mjs — 15s by default) so every `gh` call gets a bounded wait
 * without each call site having to pass it.
 *
 * @template T
 * @param {(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>} dollar
 * @param {object} [options] - forwarded to ghWithRateLimitRetry per call.
 * @param {number} [options.defaultTimeoutMs] - per-call timeout applied to
 *        every `gh` invocation unless the caller overrides it via the options
 *        form. Pass 0 to disable. Default: `timeouts.ghApiMs`.
 * @param {(msg: string) => Promise<void>|void} [options.verboseLog] - if set,
 *        called once per `gh` call with the resolved preview + timeoutMs.
 * @param {boolean} [options.supportsOptionsForm] - if true, the wrapper will
 *        invoke `dollar({ signal })` to obtain a configured tagged-template
 *        that propagates AbortSignal-driven cancellation to the spawned `gh`
 *        child process. This is supported by `command-stream` ≥0.7 but not by
 *        every `$` implementation, so it is opt-in. solve.results.lib.mjs sets
 *        this to true; tests with naive `$` fakes leave it unset.
 * @returns {((strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>) & {raw: typeof dollar, gh: Function}}
 */
// Issue #1811: keys the wrapper consumes itself for retry / timeout behavior.
// Any other keys in a `$({ ... })` options-form invocation belong to the
// underlying `dollar` (e.g. `cwd`, `env`, `stdin`, `signal`) and must be
// forwarded so callers like `$({ cwd: tempDir })\`git ...\`` keep working.
const WRAPPER_OWNED_OPTION_KEYS = new Set(['maxAttempts', 'transientMaxAttempts', 'transientDelay', 'transientBackoff', 'label', 'log', 'timeoutMs', 'retryOnTimeout', 'commandPreview', 'verboseLog', 'defaultTimeoutMs', 'supportsOptionsForm']);

const splitWrapperOptions = perCallOptions => {
  const wrapper = {};
  const dollar = {};
  for (const [key, value] of Object.entries(perCallOptions || {})) {
    if (WRAPPER_OWNED_OPTION_KEYS.has(key)) wrapper[key] = value;
    else dollar[key] = value;
  }
  return { wrapper, dollar };
};

export const wrapDollarWithGhRetry = (dollar, options = {}) => {
  const baseOptions = { ...options };
  const baseDefaultTimeoutMs = baseOptions.defaultTimeoutMs ?? timeouts.ghApiMs;
  delete baseOptions.defaultTimeoutMs;
  const baseVerboseLog = typeof baseOptions.verboseLog === 'function' ? baseOptions.verboseLog : null;
  delete baseOptions.verboseLog;
  const supportsOptionsForm = baseOptions.supportsOptionsForm === true;
  delete baseOptions.supportsOptionsForm;

  // Invoke the underlying dollar with any `dollar`-owned options
  // (cwd/env/stdin/signal/...) merged in. When there are no such options we
  // call dollar as a plain tagged template so we don't disturb implementations
  // that do not support the options form.
  const invokeDollar = (dollarOptions, strings, values) => {
    const hasOptions = dollarOptions && Object.keys(dollarOptions).length > 0;
    if (!hasOptions) return dollar(strings, ...values);
    let configured;
    try {
      configured = dollar(dollarOptions);
    } catch {
      configured = null;
    }
    if (typeof configured === 'function') return configured(strings, ...values);
    // dollar didn't accept the options form. Silence any unhandled rejection
    // and fall back to the bare tagged-template invocation.
    if (configured && typeof configured.then === 'function' && typeof configured.catch === 'function') {
      configured.catch(() => {});
    }
    return dollar(strings, ...values);
  };

  const buildCaller = perCallOptions => {
    const { wrapper: wrapperOpts, dollar: dollarOpts } = splitWrapperOptions(perCallOptions);
    const merged = { ...baseOptions, ...wrapperOpts };
    const timeoutMs = merged.timeoutMs ?? baseDefaultTimeoutMs;
    const verboseLog = typeof merged.verboseLog === 'function' ? merged.verboseLog : baseVerboseLog;
    delete merged.verboseLog;

    return (strings, ...values) => {
      // Reconstruct the literal command for inspection (sufficient — leading
      // `gh ` is what we care about).
      let preview = '';
      for (let i = 0; i < strings.length; i++) {
        preview += strings[i];
        if (i < values.length) preview += String(values[i] ?? '');
      }
      const isGh = /^\s*gh(?:\s|$)/.test(preview);
      if (!isGh) return invokeDollar(dollarOpts, strings, values);
      const trimmedPreview = preview.trim();
      const shortPreview = trimmedPreview.split(/\s+/).slice(0, 3).join(' ');
      if (verboseLog) {
        const tag = timeoutMs > 0 ? ` (timeoutMs=${timeoutMs})` : '';
        Promise.resolve(verboseLog(`   $ ${trimmedPreview}${tag}`)).catch(() => {});
      }
      return ghWithRateLimitRetry(
        signal => {
          // Issue #1811: if the caller opted in via `supportsOptionsForm: true`
          // and command-stream's `$` accepts the options-form invocation
          // (`$({ signal })`), use it so the spawned `gh` child is SIGTERMed
          // when the timeout fires. We avoid the probe for arbitrary `$`
          // implementations (and naive test fakes) so they aren't invoked
          // twice per logical call.
          if (supportsOptionsForm && timeoutMs > 0 && signal && typeof dollar === 'function') {
            return invokeDollar({ ...dollarOpts, signal }, strings, values);
          }
          return invokeDollar(dollarOpts, strings, values);
        },
        {
          label: `$gh (${shortPreview})`,
          commandPreview: trimmedPreview,
          ...merged,
          timeoutMs,
        }
      );
    };
  };

  const tagged = buildCaller({});
  const wrapped = function (firstArg, ...rest) {
    // Tagged-template usage: first arg is a TemplateStringsArray.
    if (firstArg && Array.isArray(firstArg) && Object.prototype.hasOwnProperty.call(firstArg, 'raw')) {
      return tagged(firstArg, ...rest);
    }
    // Options-form: $({ timeoutMs }) returns a tagged-template function.
    if (firstArg && typeof firstArg === 'object' && !Array.isArray(firstArg)) {
      return buildCaller(firstArg);
    }
    // Fallback — let the underlying $ raise its own error.
    return dollar(firstArg, ...rest);
  };
  // Preserve a reference to the underlying $ for consumers that need it.
  wrapped.raw = dollar;
  // Convenience: $.gh({ timeoutMs }) is identical to $({ timeoutMs }).
  wrapped.gh = perCallOptions => buildCaller(perCallOptions || {});
  return wrapped;
};

export { isTransientNetworkError };

export default {
  isRateLimitError,
  isTransientNetworkError,
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
  GhTimeoutError,
  callWithTimeout,
};
