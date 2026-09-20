#!/usr/bin/env node
/**
 * Read-only probes that must not be mirrored into the attached log.
 *
 * Issue #2130 — the solver mirrors every child process's output to stdout, and
 * `src/lib.mjs` copies stdout into the log file that is later attached to the
 * pull request. That is the right default for the AI tool's own output, but it
 * also dumped the raw answers of the solver's internal probes between its own
 * sentences, where they read as unexplained output or as errors:
 *
 *   - `gh api repos/OWNER/REPO/pulls/N` — a ~33 KB JSON object, once per watch
 *     iteration (12 copies in the log captured for this issue);
 *   - `gh api .../comments --paginate` — up to 46 KB per restart;
 *   - `gh auth status --show-token` — a live credential in clear text;
 *   - bare one-word answers such as a login, `public`, `I_kwDO...`, or a commit
 *     SHA, with nothing around them to say what asked the question.
 *
 * Every one of those call sites already reports what it learned in words, so
 * the raw output is captured for the caller but never mirrored.
 *
 * @module quiet-probe
 */

/**
 * command-stream options for a probe whose raw output stays out of the log.
 * `capture: true` keeps `result.stdout` available to the caller.
 *
 *   const result = await $(QUIET_PROBE)`gh api user --jq .login`;
 */
export const QUIET_PROBE = Object.freeze({ mirror: false, capture: true });

const quietProbeCache = new WeakMap();

/**
 * Bind {@link QUIET_PROBE} to a `$` that arrived as a function argument,
 * degrading to the tag itself when that `$` does not implement command-stream's
 * options-call form.
 *
 * Many helpers take `$` as an injected parameter, and the doubles supplied by
 * callers (tests, in particular) are plain tagged templates that throw on
 * `$({ ... })`. Suppressing mirrored output is a readability improvement, never
 * a correctness requirement, so a `$` that cannot be configured is used as-is
 * rather than turned into a crash.
 *
 *   const result = await quietProbe($)`gh api user --jq .login`;
 *
 * @param {Function} dollar - a command-stream `$` or a tagged-template double.
 * @returns {Function} `dollar` bound to the quiet options, or `dollar` itself.
 */
export const quietProbe = dollar => {
  if (typeof dollar !== 'function') return dollar;
  const cached = quietProbeCache.get(dollar);
  if (cached) return cached;
  let bound = dollar;
  try {
    const candidate = dollar(QUIET_PROBE);
    // A tag that ignores the options call may return a promise for a command it
    // never should have run; swallow it so it cannot surface as an unhandled
    // rejection, and keep the original tag.
    if (typeof candidate?.catch === 'function') candidate.catch(() => {});
    if (typeof candidate === 'function') bound = candidate;
  } catch {
    /* not option-callable - use the tag unchanged */
  }
  quietProbeCache.set(dollar, bound);
  return bound;
};

export default {
  QUIET_PROBE,
  quietProbe,
};
