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

// Subcommands that talk to the remote and are safe to re-run verbatim.
const GIT_NETWORK_SUBCOMMANDS = Object.freeze(['push', 'fetch', 'pull', 'ls-remote']);

/**
 * Decide whether `command` is a git command that reaches the network.
 *
 * Handles the `git -C <dir> push ...` and `git --no-pager fetch ...` forms by
 * skipping leading option tokens (and their argument, for the options that take
 * one) before looking at the subcommand.
 *
 * @param {string} command - the reconstructed shell command line.
 * @returns {string|null} the matched subcommand, or null when not a git network command.
 */
export const matchGitNetworkCommand = command => {
  const text = String(command ?? '').trim();
  if (!/^git(?:\s|$)/.test(text)) return null;
  const tokens = text.split(/\s+/).slice(1);
  const optionsWithValue = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.startsWith('-')) {
      // `git clone` is excluded on purpose - see the module header.
      return GIT_NETWORK_SUBCOMMANDS.includes(token) ? token : null;
    }
    if (optionsWithValue.has(token)) i++;
  }
  return null;
};

/**
 * Wrap command-stream's `$` so that git network commands are retried on
 * transient failures. Non-git commands (and local git plumbing) are passed
 * straight through, so the wrapper is safe to install globally.
 *
 * @template T
 * @param {(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>} dollar
 * @param {object} [options] - forwarded to gitCmdRetry per call.
 * @returns {(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>}
 */
export const wrapDollarWithGitRetry = (dollar, options = {}) => {
  if (typeof dollar !== 'function') {
    throw new TypeError(`Expected command-stream's $ export to be a function, received ${typeof dollar}.`);
  }
  const wrapped = (strings, ...values) => {
    // Options-call form: `$({ cwd })` returns a new tag bound to those options.
    if (strings && !Array.isArray(strings) && typeof strings === 'object') {
      return wrapDollarWithGitRetry(dollar(strings), options);
    }
    let preview = '';
    for (let i = 0; i < strings.length; i++) {
      preview += strings[i];
      if (i < values.length) preview += String(values[i] ?? '');
    }
    const subcommand = matchGitNetworkCommand(preview);
    if (!subcommand) return dollar(strings, ...values);
    // Lazy import keeps this module free of a static cycle with lib.mjs.
    return (async () => {
      const { gitCmdRetry } = await import('./lib.mjs');
      return gitCmdRetry(() => dollar(strings, ...values), {
        label: `git ${subcommand}`,
        ...options,
      });
    })();
  };
  wrapped.raw = typeof dollar.raw === 'function' ? dollar.raw : dollar;
  return wrapped;
};

export default { matchGitNetworkCommand, wrapDollarWithGitRetry };
