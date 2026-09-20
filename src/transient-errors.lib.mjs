#!/usr/bin/env node

/**
 * Single source of truth for "is this failure worth retrying?" classification
 * of git and GitHub (`gh`) operations.
 *
 * Issue #2168: `gh pr create` aborted a whole solve run with
 *
 *   GraphQL: Something went wrong while executing your query on
 *   2026-08-21T19:28:14Z. Please include `811E:19A5B0:3A5AA9:37C97F:6A88A6CC`
 *   when reporting this issue.
 *
 * That is GitHub's generic *server-side* GraphQL failure (the GraphQL analogue
 * of an HTTP 500 — GitHub's own docs tell you to retry it and, if it persists,
 * report the reference id). The call site already went through
 * `execGhWithRetry` (added for issue #1756), but the retry wrapper only
 * recognised TCP/TLS faults and `HTTP 502/503/504`, so this error fell through
 * the `isTransientNetworkError` check and was rethrown on the first attempt.
 *
 * Before this module the pattern list lived in two places — `src/lib.mjs`
 * (`isTransientNetworkError`, superset with git-transport patterns) and
 * `src/github-rate-limit.lib.mjs` (a deliberate copy, to avoid a circular
 * import). Two lists meant a pattern added to one silently did not apply to
 * the other. This module is a leaf (it imports nothing from the project) so
 * both files can depend on it without a cycle.
 *
 * @see docs/case-studies/issue-2168/README.md
 */

/**
 * Transport-level faults: the request never reached GitHub, or the connection
 * died mid-flight. Safe to retry for both git and gh.
 */
export const NETWORK_TRANSIENT_PATTERNS = Object.freeze(['i/o timeout', 'dial tcp', 'connection refused', 'connection reset', 'econnreset', 'econnaborted', 'epipe', 'etimedout', 'enotfound', 'eai_again', 'ehostunreach', 'enetunreach', 'network is unreachable', 'temporary failure', 'tls handshake timeout', 'ssl_error', 'socket hang up', 'unexpected eof', 'client.timeout exceeded', 'context deadline exceeded', 'request timed out', 'timeout awaiting response headers']);

/**
 * GitHub-side faults: the request reached GitHub and GitHub failed to serve
 * it. These are 5xx-class conditions — retrying is the documented remedy.
 *
 * Issue #2168 added the GraphQL variants. GitHub's GraphQL API answers with
 * HTTP 200 and an `errors[]` payload for internal failures, so no HTTP status
 * pattern can catch them; the message text is the only signal `gh` surfaces.
 */
export const GITHUB_SERVER_TRANSIENT_PATTERNS = Object.freeze([
  'http 500',
  'http 502',
  'http 503',
  'http 504',
  'bad gateway',
  'service unavailable',
  'gateway timeout',
  'internal server error',
  // GraphQL internal errors (HTTP 200 + errors[]), issue #2168.
  'something went wrong while executing your query',
  'this may be the result of a timeout',
  'or it could be a github bug',
  'graphql: server error',
  'graphql: timedout',
  'graphql: internal error',
  // REST/GraphQL "try again later" phrasings.
  'please try again later',
  'try again in a few',
  'this diff is temporarily unavailable',
  'temporarily unavailable due to heavy server load',
  'heavy server load',
  'not_available',
]);

/**
 * git transport faults specific to the pack protocol. `git push`/`git fetch`
 * report a broken transfer through these strings rather than an HTTP status.
 *
 * Issue #1957 introduced them for clone recovery; issue #2168 makes them part
 * of the shared vocabulary so `git push` retries recognise them too.
 */
export const GIT_TRANSIENT_PATTERNS = Object.freeze(['unexpected disconnect', 'sideband', 'early eof', 'the remote end hung up', 'remote end hung up unexpectedly', 'rpc failed', 'fetch-pack', 'index-pack failed', 'transfer closed', 'unable to access', 'could not read from remote repository', 'failed to connect to github.com', 'operation timed out after', 'gnutls_handshake() failed', 'the requested url returned error: 5']);

/**
 * GitHub throttling *anonymous* git downloads (issue #2192):
 *
 *   fatal: remote error: GitHub is temporarily limiting some unauthenticated
 *   downloads to protect the stability of the platform. Please retry later or
 *   authenticate.
 *
 * Retryable — GitHub itself says "retry later" — but the *real* fix is to
 * authenticate, which `src/git-auth-transport.lib.mjs` does before retrying.
 * Kept as its own category so a run that hits this is never diagnosed as a
 * generic network fault (the failing run reported "Unknown error" three times).
 */
export const ANONYMOUS_DOWNLOAD_LIMIT_PATTERNS = Object.freeze(['temporarily limiting some unauthenticated downloads', 'limiting some unauthenticated downloads', 'please retry later or authenticate', 'retry later or authenticate']);

/**
 * Union used by the general-purpose `isTransientNetworkError` helpers. Kept as
 * a single flat list so a caller cannot accidentally miss a category.
 */
export const ALL_TRANSIENT_PATTERNS = Object.freeze([...NETWORK_TRANSIENT_PATTERNS, ...GITHUB_SERVER_TRANSIENT_PATTERNS, ...GIT_TRANSIENT_PATTERNS, ...ANONYMOUS_DOWNLOAD_LIMIT_PATTERNS]);

/**
 * Pull every plausible string out of an error-ish value so pattern matches
 * survive whatever shape the caller produced: `Error`, a plain string, a
 * `child_process.exec` rejection (`stdout`/`stderr`), a command-stream result
 * object (`code`/`stdout`/`stderr`), or a wrapper carrying `cause`.
 *
 * @param {unknown} error
 * @param {number} [depth] - internal recursion guard for `cause` chains.
 * @returns {string}
 */
export const collectErrorText = (error, depth = 0) => {
  if (!error || depth > 5) return '';
  if (typeof error === 'string') return error;
  const parts = [];
  const push = value => {
    if (typeof value === 'string') parts.push(value);
    else if (value && typeof value.toString === 'function') parts.push(value.toString());
  };
  if (typeof error.message === 'string') parts.push(error.message);
  push(error.stderr);
  push(error.stdout);
  if (error.cause) parts.push(collectErrorText(error.cause, depth + 1));
  // Last resort: an error-ish object whose text only lives in a custom
  // `toString`. Raw byte payloads are deliberately excluded — issue #1829 pins
  // that a bare Buffer carries no classifiable text (its bytes may be an
  // arbitrary command payload rather than a failure description).
  if (parts.length === 0 && !ArrayBuffer.isView(error) && typeof error.toString === 'function') push(error);
  return parts.join('\n');
};

const matchPattern = (error, patterns) => {
  const text = collectErrorText(error).toLowerCase();
  if (!text) return null;
  return patterns.find(pattern => text.includes(pattern)) || null;
};

/**
 * True when `error` is a transient transport/server fault that a retry can fix.
 * Superset covering network, GitHub 5xx/GraphQL-internal, and git-pack faults.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export const isTransientNetworkError = error => matchPattern(error, ALL_TRANSIENT_PATTERNS) !== null;

/**
 * True when `error` is GitHub refusing an *unauthenticated* git download.
 * The remedy is to authenticate the transport, not merely to wait.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export const isAnonymousDownloadLimit = error => matchPattern(error, ANONYMOUS_DOWNLOAD_LIMIT_PATTERNS) !== null;

/**
 * True when `error` is a GitHub server-side fault (5xx or GraphQL internal).
 * Narrower than `isTransientNetworkError` — used for logging/classification.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export const isGitHubServerError = error => matchPattern(error, GITHUB_SERVER_TRANSIENT_PATTERNS) !== null;

/**
 * Return the first transient pattern that matched, or `null` when the error is
 * not classified as transient. Exposed so retry wrappers can log *why* they
 * retried (or, in verbose mode, why they refused to).
 *
 * @param {unknown} error
 * @returns {string|null}
 */
export const matchTransientPattern = error => matchPattern(error, ALL_TRANSIENT_PATTERNS);

/**
 * Extract GitHub's support reference id from an error.
 *
 * Two shapes are recognised:
 *   - the `X-GitHub-Request-Id: AAAA:BBBB:...` response header, and
 *   - the GraphQL prose form: ``Please include `811E:19A5B0:...` when
 *     reporting this issue.``
 *
 * Issue #2168: without this id a GitHub support report (or an upstream bug
 * report) is unactionable, and the id was previously only visible by reading
 * the raw failure text by hand.
 *
 * @param {unknown} error
 * @returns {string|null}
 */
export const parseGitHubRequestId = error => {
  const text = collectErrorText(error);
  if (!text) return null;
  const headerMatch = text.match(/x-github-request-id:\s*([0-9A-Fa-f]{4,}(?::[0-9A-Fa-f]{4,})+)/i);
  if (headerMatch) return headerMatch[1];
  const proseMatch = text.match(/please include\s+`?([0-9A-Fa-f]{4,}(?::[0-9A-Fa-f]{4,})+)`?/i);
  if (proseMatch) return proseMatch[1];
  return null;
};

/**
 * Full classification of a failure, for retry decisions *and* for diagnostics.
 *
 * @param {unknown} error
 * @returns {{transient: boolean, category: 'network'|'github-server'|'git-transport'|'github-anonymous-rate-limit'|null, matchedPattern: string|null, requestId: string|null, text: string}}
 */
export const describeTransientError = error => {
  const text = collectErrorText(error);
  const lowered = text.toLowerCase();
  const find = patterns => patterns.find(pattern => lowered.includes(pattern)) || null;

  const networkPattern = find(NETWORK_TRANSIENT_PATTERNS);
  const serverPattern = find(GITHUB_SERVER_TRANSIENT_PATTERNS);
  const gitPattern = find(GIT_TRANSIENT_PATTERNS);
  const anonymousPattern = find(ANONYMOUS_DOWNLOAD_LIMIT_PATTERNS);

  let category = null;
  let matchedPattern = null;
  if (anonymousPattern) {
    // Checked first: this failure has a specific remedy (authenticate) and its
    // text also mentions timeouts/retries that the other lists could match.
    category = 'github-anonymous-rate-limit';
    matchedPattern = anonymousPattern;
  } else if (networkPattern) {
    category = 'network';
    matchedPattern = networkPattern;
  } else if (serverPattern) {
    category = 'github-server';
    matchedPattern = serverPattern;
  } else if (gitPattern) {
    category = 'git-transport';
    matchedPattern = gitPattern;
  }

  return {
    transient: category !== null,
    category,
    matchedPattern,
    requestId: parseGitHubRequestId(error),
    text,
  };
};

/**
 * One-line, log-friendly summary of a classification. Used by the retry
 * wrappers so every retry decision (and every give-up) is traceable in the
 * solve log without turning on verbose mode.
 *
 * @param {ReturnType<typeof describeTransientError>} description
 * @returns {string}
 */
export const formatTransientDiagnostics = description => {
  if (!description) return '';
  const bits = [];
  bits.push(description.transient ? `transient=yes category=${description.category} pattern="${description.matchedPattern}"` : 'transient=no');
  if (description.requestId) bits.push(`github-request-id=${description.requestId}`);
  return bits.join(' ');
};

export default {
  ANONYMOUS_DOWNLOAD_LIMIT_PATTERNS,
  NETWORK_TRANSIENT_PATTERNS,
  GITHUB_SERVER_TRANSIENT_PATTERNS,
  GIT_TRANSIENT_PATTERNS,
  ALL_TRANSIENT_PATTERNS,
  collectErrorText,
  isAnonymousDownloadLimit,
  isTransientNetworkError,
  isGitHubServerError,
  matchTransientPattern,
  parseGitHubRequestId,
  describeTransientError,
  formatTransientDiagnostics,
};
