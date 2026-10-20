#!/usr/bin/env node

/**
 * The one retry loop behind every GitHub operation (`gh ...` and network git).
 *
 * Issue #3552 follow-up: "all GitHub operations must be retry-able, handled by
 * deduplicated universal code". Before this module the codebase had five
 * hand-written retry loops (`ghWithRateLimitRetry`, `ghRetry`, `ghCmdRetry`,
 * `gitCmdRetry`, plus two in the release scripts), and they disagreed about
 * what a failure *is*:
 *
 *   - `ghWithRateLimitRetry` only retried when `fn` *rejected*. command-stream's
 *     `$` never rejects on a non-zero exit - it resolves `{ code, stdout,
 *     stderr }` - so every `$\`gh ...\`` issued through `wrapDollarWithGhRetry`
 *     ran exactly once, even on `HTTP 502` or `API rate limit exceeded`.
 *     (experiments/wrapped-dollar-gh-retry-real.mjs reproduces it.)
 *   - `ghCmdRetry` / `gitCmdRetry` only handled resolved results, so a runner
 *     that throws (`execFile`, `promisify(exec)`) was never retried by them.
 *
 * `retryGitHubOperation` accepts both shapes: a rejection, or a resolved
 * command result with a non-zero `code`. Whatever the last attempt produced is
 * handed back in the same shape, so wrapping a call never changes how the
 * caller sees success or failure - only how many times it was tried.
 *
 * This file is a dependency-free leaf (Node built-ins and other leaf modules
 * only), because the release scripts import it in CI jobs that never run
 * `npm install` (helm-release).
 */

import { describeTransientError, formatTransientDiagnostics } from './transient-errors.lib.mjs';
import { matchGitNetworkCommand } from './git-retry.lib.mjs';

/**
 * Marks an executor that already retries GitHub operations, so wrapping it a
 * second time returns it unchanged instead of nesting two retry loops (which
 * would multiply the attempts). Wrapping at the point of use is therefore
 * always safe, even when the caller may already have wrapped the executor.
 */
export const GITHUB_RETRY_WRAPPED = Symbol.for('hive-mind.github-retry-wrapped');

/** True when `fn` was returned by one of the GitHub retry wrap factories. */
export const isGitHubRetryWrapped = fn => typeof fn === 'function' && fn[GITHUB_RETRY_WRAPPED] === true;

/** Defaults used when the caller passes nothing (scripts have no config.lib.mjs). */
export const DEFAULT_GITHUB_RETRY = Object.freeze({ maxAttempts: 5, delayMs: 2000, backoff: 2 });

/**
 * `gh` subcommands that never reach the network (or are interactive), so a
 * retry could not change their outcome. Everything else `gh` does is an API
 * call and must be retried.
 */
const LOCAL_GH_COMMANDS = Object.freeze(['--version', '-v', 'version', '--help', '-h', 'help', 'completion', 'config', 'alias', 'environment', 'auth token', 'auth setup-git', 'auth switch', 'auth logout', 'auth login', 'auth refresh']);

const commandBaseName = command =>
  String(command ?? '')
    .split(/[\\/]/)
    .pop();

const isLocalGhCommand = tokens => {
  const two = tokens.slice(0, 2).join(' ');
  return tokens.length === 0 || LOCAL_GH_COMMANDS.includes(tokens[0]) || LOCAL_GH_COMMANDS.includes(two);
};

/**
 * Decide whether a command is a GitHub operation that must be retried.
 *
 * Accepts either a whole command line (`'gh api user'`, `'git -C dir push'`) or
 * the `spawn`/`execFile` form (`'gh', ['api', 'user']`).
 *
 * @param {string} command - a command line, or the executable when `args` is given.
 * @param {string[]} [args] - argv after the executable.
 * @returns {{ tool: 'gh'|'git', subcommand: string, label: string }|null}
 */
export const classifyGitHubCommand = (command, args) => {
  const tokens = Array.isArray(args)
    ? [commandBaseName(command), ...args.map(String)]
    : String(command ?? '')
        .trim()
        .split(/\s+/);
  const [tool, ...rest] = tokens;
  if (tool === 'gh') {
    if (isLocalGhCommand(rest)) return null;
    const subcommand = rest.slice(0, 2).join(' ');
    return { tool: 'gh', subcommand, label: `gh ${subcommand}` };
  }
  if (tool === 'git') {
    const subcommand = matchGitNetworkCommand(tokens.join(' '));
    return subcommand ? { tool: 'git', subcommand, label: `git ${subcommand}` } : null;
  }
  return null;
};

/**
 * True for a *resolved* command result that reports failure: command-stream's
 * `{ code, stdout, stderr }`, or the same shape from a `spawn`-based runner.
 * The stdout/stderr requirement keeps API payloads that merely contain a
 * `code` field from being mistaken for a failed process.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export const isFailedCommandResult = value => Boolean(value) && typeof value === 'object' && typeof value.code === 'number' && value.code !== 0 && ('stdout' in value || 'stderr' in value);

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const defaultLog = (message, { level } = {}) => {
  if (level === 'verbose') return;
  console.warn(message);
};

/**
 * Run `fn` and retry it while its failure is a transient GitHub/network fault.
 *
 * @template T
 * @param {() => Promise<T>} fn - the operation; may reject or resolve a failed command result.
 * @param {object} [options]
 * @param {string} [options.label] - prefix for log lines.
 * @param {string} [options.noun] - word used in the log line ("network", "git", or '' for none).
 * @param {number} [options.maxAttempts] - total attempts allowed for transient faults.
 * @param {number} [options.delayMs] - first back-off delay.
 * @param {number} [options.backoff] - back-off multiplier.
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {(message: string, meta: {level: 'warn'|'error'|'verbose', kind: string, threw: boolean}) => unknown} [options.log]
 * @param {{ isRateLimited: (failure: unknown) => boolean, maxAttempts: number, wait: (failure: unknown, attempt: number) => Promise<void> }} [options.rateLimit]
 *   - optional rate-limit policy with its own budget (see github-rate-limit.lib.mjs).
 * @param {(value: unknown) => boolean} [options.isFailedResult] - which resolved values count as a
 *   failure (default `isFailedCommandResult`).
 * @param {boolean} [options.sharedBudget] - count rate-limit waits against `maxAttempts`
 *   instead of a separate `rateLimit.maxAttempts` budget (the historical `ghRetry` contract).
 * @param {(info: {description: object, attempt: number, failure: unknown}) => Promise<void>} [options.beforeRetry]
 *   - hook run before a transient retry (git uses it to repair auth, issue #2192).
 * @param {(info: {outcome: unknown, error: unknown, threw: boolean, failed: boolean, attempt: number}) => Promise<void>} [options.afterAttempt]
 *   - hook run after every attempt (usage logging, stderr mirroring).
 * @returns {Promise<T>}
 */
export const retryGitHubOperation = async (fn, options = {}) => {
  const { label = 'GitHub operation', noun = 'network', maxAttempts = DEFAULT_GITHUB_RETRY.maxAttempts, delayMs = DEFAULT_GITHUB_RETRY.delayMs, backoff = DEFAULT_GITHUB_RETRY.backoff, sleep = defaultSleep, log = defaultLog, rateLimit = null, isFailedResult = isFailedCommandResult, sharedBudget = false, beforeRetry = null, afterAttempt = null } = options;
  const emit = (message, meta) => Promise.resolve(log(message, meta));
  const faultName = noun ? `transient ${noun} error` : 'transient error';

  let attempt = 0;
  let transientAttempts = 0;
  let rateLimitAttempts = 0;
  for (;;) {
    attempt++;
    let outcome;
    let error;
    let threw = false;
    try {
      outcome = await fn();
    } catch (caught) {
      threw = true;
      error = caught;
    }
    const failed = threw || isFailedResult(outcome);
    if (afterAttempt) await afterAttempt({ outcome, error, threw, failed, attempt });
    if (!failed) return outcome;

    const failure = threw ? error : outcome;
    // Hand the last attempt back exactly as the caller would have seen it.
    const settle = () => {
      if (threw) throw error;
      return outcome;
    };
    const budgetLeft = used => (sharedBudget ? attempt < maxAttempts : used < maxAttempts);

    if (rateLimit?.isRateLimited(failure)) {
      rateLimitAttempts++;
      const limit = sharedBudget ? maxAttempts : rateLimit.maxAttempts;
      const used = sharedBudget ? attempt : rateLimitAttempts;
      if (used < limit) {
        await rateLimit.wait(failure, used, limit);
        continue;
      }
      if (!sharedBudget) {
        await emit(`❌ ${label}: rate limit still active after ${rateLimitAttempts} attempts; giving up.`, { level: 'error', kind: 'rate-limit-exhausted', threw });
        return settle();
      }
    }

    // Classify once and log the verdict on every path, including "not
    // retrying", so the next unknown failure is diagnosable from the log.
    const description = describeTransientError(failure);
    const diagnostics = formatTransientDiagnostics(description);
    const position = sharedBudget ? attempt : transientAttempts + 1;
    if (description.transient) transientAttempts++;
    if (!description.transient || !budgetLeft(transientAttempts)) {
      if (description.transient && !sharedBudget) {
        await emit(`❌ ${label}: ${faultName} persisted after ${transientAttempts} attempts; giving up. [${diagnostics}]`, { level: 'error', kind: 'transient-exhausted', threw, diagnostics });
      } else {
        const exit = threw ? '' : ` exit=${outcome?.code}`;
        await emit(`   ${label}: not retrying [${diagnostics}] attempt=${position}/${maxAttempts}${exit}`, { level: 'verbose', kind: 'not-retrying', threw, diagnostics });
      }
      return settle();
    }
    if (beforeRetry) await beforeRetry({ description, attempt: position, failure });
    const retryIndex = sharedBudget ? attempt : transientAttempts;
    const waitMs = delayMs * Math.pow(backoff, retryIndex - 1);
    await emit(`⚠️ ${label}: ${faultName} (attempt ${position}/${maxAttempts}), retrying in ${Math.round(waitMs / 1000)}s... [${diagnostics}]`, { level: 'warn', kind: 'retrying', threw, diagnostics, waitMs });
    await sleep(waitMs);
  }
};

/**
 * Wrap a `(command, args, options) => result` runner so the GitHub operations
 * it starts are retried, and everything else passes straight through.
 *
 * `retryGh` / `retryGit` let a caller plug in a richer policy (the rate-limit
 * aware `ghWithRateLimitRetry` in src/); the defaults use the plain transient
 * loop above, which is what the dependency-free release scripts need.
 *
 * @template R
 * @param {(command: string, args: string[], options?: object) => Promise<R>} run
 * @param {object} [options] - forwarded to the retry function.
 * @param {(fn: () => Promise<R>, options: object) => Promise<R>} [options.retryGh]
 * @param {(fn: () => Promise<R>, options: object) => Promise<R>} [options.retryGit]
 * @returns {(command: string, args: string[], options?: object) => Promise<R>}
 */
export const wrapRunnerWithTransientRetry = (run, options = {}) => {
  if (typeof run !== 'function') throw new TypeError(`Expected a command runner function, received ${typeof run}.`);
  if (isGitHubRetryWrapped(run)) return run;
  const { retryGh = retryGitHubOperation, retryGit = retryGitHubOperation, ...retryOptions } = options;
  const wrapped = (command, args = [], runOptions) => {
    const operation = classifyGitHubCommand(command, args);
    if (!operation) return run(command, args, runOptions);
    const retry = operation.tool === 'gh' ? retryGh : retryGit;
    return retry(() => run(command, args, runOptions), { label: operation.label, noun: operation.tool === 'git' ? 'git' : 'network', ...retryOptions });
  };
  wrapped.raw = run;
  wrapped[GITHUB_RETRY_WRAPPED] = true;
  return wrapped;
};

export default { DEFAULT_GITHUB_RETRY, GITHUB_RETRY_WRAPPED, classifyGitHubCommand, isGitHubRetryWrapped, isFailedCommandResult, retryGitHubOperation, wrapRunnerWithTransientRetry };
