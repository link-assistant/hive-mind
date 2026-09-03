#!/usr/bin/env node

/**
 * Authenticated git HTTPS transport for github.com (issue #2192).
 *
 * A `solve` run died with `Reason: Repository setup failed` after three clone
 * attempts, each rejected by GitHub with:
 *
 *   fatal: remote error: GitHub is temporarily limiting some unauthenticated
 *   downloads to protect the stability of the platform. Please retry later or
 *   authenticate.
 *
 * The container *was* authenticated: every `gh` API call in the same run
 * succeeded, and `gh auth setup-git` had installed
 * `credential.https://github.com.helper = !gh auth git-credential`.
 *
 * A credential helper does not help here. git only asks the helper for
 * credentials **after** the server answers `401`, and github.com answers `200`
 * for a public repository — so a public clone is performed anonymously even
 * when a token is sitting right there. Verified with `GIT_TRACE_CURL=1`:
 * `git clone` and `gh repo clone` of a public repository send zero
 * `Authorization` headers with the helper configured (see
 * `experiments/issue-2192-anonymous-clone-auth.mjs`). Anonymous traffic is what
 * GitHub throttles, so the run hit the limit and no amount of retrying or
 * credential-helper repair could have fixed it.
 *
 * The remedy is the one GitHub's own `actions/checkout` uses: send the token
 * preemptively via `http.<host>.extraheader`. Two properties matter here:
 *
 *   1. The header is injected through `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` /
 *      `GIT_CONFIG_VALUE_n` environment variables (git >= 2.31) rather than
 *      written into `.git/config` or passed as `-c` arguments. The token never
 *      lands in a file the AI session can read back, never appears in a
 *      process command line visible to `ps`, and is inherited by every git
 *      child process — `gh repo clone`, `git fetch`, `git pull`, `git push` —
 *      without touching those ~36 call sites.
 *   2. Existing `GIT_CONFIG_*` entries are preserved: the new keys are appended
 *      after whatever the operator (or an outer container) already configured.
 *
 * The token value is protected in logs by the existing sanitizer: base64 forms
 * of known local tokens are masked by `findEncodedKnownTokenRuns`
 * (issue #2156), and the header is never logged by this module in any case.
 *
 * @see docs/case-studies/issue-2192/README.md
 * @module git-auth-transport
 */

import { ANONYMOUS_DOWNLOAD_LIMIT_PATTERNS, isAnonymousDownloadLimit } from './transient-errors.lib.mjs';

/** Hosts whose HTTPS git traffic is authenticated by default. */
export const DEFAULT_AUTHENTICATED_HOSTS = Object.freeze(['github.com']);

/** Env var used as the idempotency marker / diagnostic breadcrumb. */
export const GIT_AUTH_TRANSPORT_MARKER = 'HIVE_MIND_GIT_AUTH_TRANSPORT';

/** Env var an operator can set to opt out of forced authentication. */
export const GIT_AUTH_TRANSPORT_DISABLE = 'HIVE_MIND_DISABLE_GIT_AUTH_TRANSPORT';

// GitHub's wording when it refuses an *anonymous* git download lives in the
// shared transient vocabulary (`transient-errors.lib.mjs`) so classification
// and repair can never drift apart; re-exported for callers that only import
// this module.
export { ANONYMOUS_DOWNLOAD_LIMIT_PATTERNS, isAnonymousDownloadLimit };

/**
 * Build the `Authorization` header value git should send to github.com.
 *
 * GitHub accepts the token as the *password* of HTTP Basic auth with any
 * username; `x-access-token` is the username `actions/checkout` uses.
 *
 * @param {string} token
 * @returns {string} e.g. `Authorization: Basic eC1hY2Nlc3M...`
 */
export const buildAuthorizationHeader = token => `Authorization: Basic ${Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')}`;

/**
 * Read the number of `GIT_CONFIG_*` pairs already present in `env`.
 *
 * Anything unparseable is treated as zero rather than throwing: a malformed
 * outer environment must not stop the solver from cloning.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {number}
 */
export const readGitConfigCount = env => {
  const parsed = Number.parseInt(String(env?.GIT_CONFIG_COUNT ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
};

/**
 * True when `env` already carries an `extraheader` entry for every host.
 *
 * Recognises entries installed by this module *and* by an outer environment
 * (a CI runner, a parent container), so authentication configured upstream is
 * never duplicated.
 *
 * @param {Record<string, string|undefined>} env
 * @param {string[]} [hosts]
 * @returns {boolean}
 */
export const hasGitAuthConfig = (env, hosts = DEFAULT_AUTHENTICATED_HOSTS) => {
  const count = readGitConfigCount(env);
  const configuredKeys = new Set();
  for (let index = 0; index < count; index++) {
    const key = env?.[`GIT_CONFIG_KEY_${index}`];
    const value = env?.[`GIT_CONFIG_VALUE_${index}`];
    if (typeof key === 'string' && typeof value === 'string' && value.trim()) configuredKeys.add(key.toLowerCase());
  }
  return hosts.every(host => configuredKeys.has(gitAuthConfigKey(host).toLowerCase()));
};

/**
 * git config key that carries the preemptive `Authorization` header for `host`.
 *
 * The trailing slash matters: git matches `http.<url>.*` by URL prefix, so
 * `https://github.com/` covers every repository on the host and nothing else.
 *
 * @param {string} host
 * @returns {string}
 */
export const gitAuthConfigKey = host => `http.https://${host}/.extraheader`;

/**
 * Compute the `GIT_CONFIG_*` variables that add preemptive authentication for
 * `hosts`, preserving any entries already present in `env`.
 *
 * Pure: returns a patch, mutates nothing.
 *
 * @param {object} params
 * @param {string} params.token - GitHub token
 * @param {string[]} [params.hosts]
 * @param {Record<string, string|undefined>} [params.env] - environment to extend
 * @returns {Record<string, string>} variables to merge into the environment
 */
export const buildGitAuthConfigEnv = ({ token, hosts = DEFAULT_AUTHENTICATED_HOSTS, env = {} }) => {
  if (!token) throw new TypeError('buildGitAuthConfigEnv requires a GitHub token');
  const header = buildAuthorizationHeader(token);
  const patch = {};
  let index = readGitConfigCount(env);
  for (const host of hosts) {
    patch[`GIT_CONFIG_KEY_${index}`] = gitAuthConfigKey(host);
    patch[`GIT_CONFIG_VALUE_${index}`] = header;
    index++;
  }
  patch.GIT_CONFIG_COUNT = String(index);
  patch[GIT_AUTH_TRANSPORT_MARKER] = hosts.join(',');
  return patch;
};

/**
 * True when the operator disabled forced authentication.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {boolean}
 */
export const isGitAuthTransportDisabled = (env = process.env) => {
  const raw = String(env?.[GIT_AUTH_TRANSPORT_DISABLE] ?? '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
};

/**
 * Resolve a GitHub token without ever printing it.
 *
 * Order: explicit env vars first (an operator override beats stored state),
 * then `gh auth token`. Returns `{ token, source }` or `{ token: null }`.
 *
 * @param {object} params
 * @param {Function} params.$ - command-stream `$` tag
 * @param {Record<string, string|undefined>} [params.env]
 * @returns {Promise<{token: string|null, source: string|null, error: string|null}>}
 */
/**
 * Return the caller's `$` or load command-stream's on demand.
 *
 * @param {Function|undefined} provided
 * @returns {Promise<Function>} command-stream `$` tag
 */
export const resolveDollar = async provided => {
  if (typeof provided === 'function') return provided;
  // Call sites deep in the retry helpers do not carry a `$` of their own; fall
  // back to the same command-stream instance the rest of the codebase loads.
  const { ensureUseM } = await import('./use-m-bootstrap.lib.mjs');
  const use = globalThis.use || (await ensureUseM());
  return (await use('command-stream')).$;
};

export const resolveGitHubToken = async ({ $, env = process.env }) => {
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN']) {
    const value = env?.[name];
    if (typeof value === 'string' && value.trim()) return { token: value.trim(), source: name, error: null };
  }
  try {
    // `quietProbe` keeps the token out of the mirrored output that becomes the
    // attached log (issue #2130); the value is only ever used in memory.
    const { quietProbe } = await import('./quiet-probe.lib.mjs');
    const result = await quietProbe(await resolveDollar($))`gh auth token`;
    const token = (result?.stdout?.toString() || '').trim();
    if (result?.code === 0 && token) return { token, source: 'gh auth token', error: null };
    return { token: null, source: null, error: (result?.stderr?.toString() || '').trim() || `gh auth token exited ${result?.code}` };
  } catch (error) {
    return { token: null, source: null, error: error?.message || String(error) };
  }
};

/**
 * Ensure git sends credentials to github.com preemptively.
 *
 * Idempotent, never throws, and safe to call from any entry point: the worst
 * case (no token, gh not installed, operator opt-out) leaves the environment
 * exactly as it was and reports why.
 *
 * @param {object} params
 * @param {Function} [params.$] - command-stream `$` tag (loaded on demand when omitted)
 * @param {Function} [params.log] - logger; called with human-readable lines
 * @param {Record<string, string|undefined>} [params.env] - environment to mutate (default `process.env`)
 * @param {string[]} [params.hosts]
 * @param {string} [params.reason] - short phrase explaining why it was invoked
 * @param {boolean} [params.repair] - when true, try `gh-setup-git-identity --repair` if no token is found
 * @returns {Promise<{status: 'applied'|'already-configured'|'disabled'|'no-token', hosts: string[], source?: string|null, error?: string|null}>}
 */
export const ensureAuthenticatedGitTransport = async ({ $, log = async () => {}, env = process.env, hosts = DEFAULT_AUTHENTICATED_HOSTS, reason = '', repair = false } = {}) => {
  if (isGitAuthTransportDisabled(env)) {
    await log(`ℹ️  Authenticated git transport disabled via ${GIT_AUTH_TRANSPORT_DISABLE}; git will download from github.com anonymously`, { verbose: true });
    return { status: 'disabled', hosts };
  }

  if (hasGitAuthConfig(env, hosts)) return { status: 'already-configured', hosts };

  let { token, source, error } = await resolveGitHubToken({ $, env });

  if (!token && repair) {
    // Issue #2192 asks for auto-recovery of the git/gh state when it is
    // repairable without interactive credentials. `gh-setup-git-identity`
    // derives the identity and the credential helper from the authenticated
    // gh account; it cannot invent a token, so this only helps when gh state
    // is broken rather than logged out.
    const { repairGitIdentity } = await import('./git.lib.mjs');
    const repaired = await repairGitIdentity();
    await log(repaired.success ? '🔧 Repaired git/gh configuration with gh-setup-git-identity --repair' : `ℹ️  gh-setup-git-identity repair unavailable: ${repaired.error}`, { verbose: !repaired.success });
    if (repaired.success) ({ token, source, error } = await resolveGitHubToken({ $, env }));
  }

  if (!token) {
    await log(`⚠️  No GitHub token available for git transport${error ? ` (${error.split('\n')[0]})` : ''} - downloads from ${hosts.join(', ')} stay anonymous and can be throttled`, { level: 'warning' });
    return { status: 'no-token', hosts, error };
  }

  Object.assign(env, buildGitAuthConfigEnv({ token, hosts, env }));
  await log(`🔐 Authenticated git transport enabled for ${hosts.join(', ')} (token source: ${source})${reason ? ` - ${reason}` : ''}`, { verbose: true });
  return { status: 'applied', hosts, source };
};

/**
 * Point git at `gh` for credentials when nothing is configured yet.
 *
 * This is the *401* half of authentication (private repositories, pushes); the
 * `extraheader` above is the *200* half (public downloads). Both are needed:
 * neither can replace the other.
 *
 * @param {object} params
 * @param {Function} params.$ - command-stream `$` tag
 * @param {Function} [params.log]
 * @param {string} [params.host]
 * @returns {Promise<{status: 'present'|'configured'|'failed', error?: string}>}
 */
export const ensureGlobalCredentialHelper = async ({ $, log = async () => {}, host = 'github.com' }) => {
  const { quietProbe } = await import('./quiet-probe.lib.mjs');
  const dollar = await resolveDollar($);
  const existing = await quietProbe(dollar)`git config --get-all ${`credential.https://${host}.helper`}`;
  const configured = (existing?.stdout?.toString() || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  if (configured.length > 0) return { status: 'present' };

  const setup = await quietProbe(dollar)`gh auth setup-git 2>&1`;
  if (setup?.code === 0) {
    await log(`🔑 Configured the gh credential helper for ${host}`, { verbose: true });
    return { status: 'configured' };
  }
  const reason = (setup?.stdout?.toString() || setup?.stderr?.toString() || '').trim().split('\n')[0];
  await log(`ℹ️  Could not configure a global git credential helper for ${host}${reason ? `: ${reason}` : ''}`, { verbose: true });
  return { status: 'failed', error: reason };
};

export default {
  ANONYMOUS_DOWNLOAD_LIMIT_PATTERNS,
  DEFAULT_AUTHENTICATED_HOSTS,
  GIT_AUTH_TRANSPORT_DISABLE,
  GIT_AUTH_TRANSPORT_MARKER,
  buildAuthorizationHeader,
  buildGitAuthConfigEnv,
  ensureAuthenticatedGitTransport,
  ensureGlobalCredentialHelper,
  gitAuthConfigKey,
  hasGitAuthConfig,
  resolveDollar,
  isAnonymousDownloadLimit,
  isGitAuthTransportDisabled,
  readGitConfigCount,
  resolveGitHubToken,
};
