#!/usr/bin/env node

/**
 * Retry wrapper for network-facing *git* commands.
 *
 * Issue #2168 asked for retry on "any git/github operation". The `gh` half was
 * already covered by src/github-rate-limit.lib.mjs (`wrapDollarWithGhRetry`),
 * but the ~36 `git push` / `git fetch` / `git pull` call sites scattered across
 * src/*.mjs had no retry at all: a single `fatal: unable to access ...` or
 * `RPC failed; curl 56 ... connection reset` aborted the whole session.
 *
 * Wrapping every call site by hand would have to be repeated for every new call
 * site, so the retry is installed on command-stream's `$` tag instead - exactly
 * the shape already used for `gh`. Anything that runs through a wrapped `$`
 * gets the retry for free, and the existing ESLint rules that push code towards
 * the wrapped `$` keep new call sites covered.
 *
 * Only *network* subcommands are retried. Local plumbing (`git commit`,
 * `git checkout`, ...) is deterministic: re-running it cannot turn a failure
 * into a success, and a blind second attempt could mask the real error.
 *
 * `git clone` is intentionally NOT in the list: a partially-written destination
 * directory makes the second attempt fail with "already exists and is not an
 * empty directory", which would replace the real (transient) diagnosis with a
 * confusing one. Repository cloning in this codebase goes through
 * `gh repo clone`, which is already covered by the gh retry wrapper.
 */

import { GITHUB_RETRY_WRAPPED, classifyGitHubCommand, isGitHubRetryWrapped, matchGitNetworkCommand } from './github-operation-retry.lib.mjs';

// The matcher lives in the dependency-free retry module; re-exported for existing importers.
export { matchGitNetworkCommand };

/**
 * Wrap command-stream's `$` so that GitHub operations - network git commands
 * *and* `gh` API calls - are retried on transient failures. Local commands are
 * passed straight through (the synchronous ProcessRunner is returned
 * untouched), so the wrapper is safe to install globally.
 *
 * Issue #3552: this used to be a second, git-only loop. The lint rules accept
 * it as a retry wrapper, so a `$\`gh ...\`` through it passed lint yet ran
 * once. It is now the same wrapper as `wrapDollarWithGhRetry` (loaded lazily,
 * keeping this module free of github-rate-limit's config.lib dependency), and
 * shares its idempotency marker so re-wrapping never nests two loops.
 *
 * @template T
 * @param {(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>} dollar
 * @param {object} [options] - forwarded to the retry loop per call.
 * @returns {(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>}
 */
export const wrapDollarWithGitRetry = (dollar, options = {}) => {
  if (typeof dollar !== 'function') {
    throw new TypeError(`Expected command-stream's $ export to be a function, received ${typeof dollar}.`);
  }
  if (isGitHubRetryWrapped(dollar)) return dollar;
  const wrapped = (strings, ...values) => {
    // Options-call form: `$({ cwd })` returns a new tag bound to those options.
    if (strings && !Array.isArray(strings) && typeof strings === 'object') {
      // A stub `$` (tests) may return something else; it is passed through as before.
      const bound = dollar(strings);
      return typeof bound === 'function' ? wrapDollarWithGitRetry(bound, options) : bound;
    }
    let preview = '';
    for (let i = 0; i < strings.length; i++) {
      preview += strings[i];
      if (i < values.length) preview += String(values[i] ?? '');
    }
    if (!classifyGitHubCommand(preview)) return dollar(strings, ...values);
    return (async () => {
      const { wrapDollarWithGhRetry } = await import('./github-rate-limit.lib.mjs');
      return wrapDollarWithGhRetry(dollar, options)(strings, ...values);
    })();
  };
  wrapped.raw = typeof dollar.raw === 'function' ? dollar.raw : dollar;
  wrapped[GITHUB_RETRY_WRAPPED] = true;
  return wrapped;
};

export default { matchGitNetworkCommand, wrapDollarWithGitRetry };
