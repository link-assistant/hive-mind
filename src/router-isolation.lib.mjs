/**
 * Router isolation policy (issue #2164, EXPERIMENTAL).
 *
 * By default a Docker-isolated task receives the operator's real subscription:
 * `~/.claude`, `~/.claude.json`, `~/.codex`, `~/.agents` and `~/.config/gh` are
 * bind-mounted into the container by `getDockerIsolationAuthMounts()`. The agent
 * inside therefore holds the raw vendor OAuth credential and the raw GitHub
 * token, can spend the subscription without limit, and leaves no record beyond
 * whatever it chose to write itself.
 *
 * With `--use-router` those mounts are withheld. The credentials stay in one
 * `hive-mind-router` sidecar, each task gets its own short-lived `la_sk_…`
 * token, and every request lands in that token's own redacted JSONL log inside
 * a preserved data volume.
 *
 * This module is deliberately pure: it decides *what a routed task should see*
 * and nothing else, so the policy is testable without Docker. Container
 * lifecycle lives in `router-sidecar.lib.mjs`.
 */

export const ROUTER_SIDECAR_CONTAINER_NAME = 'hive-mind-router';
export const ROUTER_SIDECAR_NETWORK_NAME = 'hive-mind-router';
// Tasks reach the sidecar by alias, so the endpoint stays stable across restarts.
export const ROUTER_SIDECAR_NETWORK_ALIAS = 'link-assistant-router';
export const ROUTER_SIDECAR_PORT = 8080;
export const ROUTER_SIDECAR_LABEL = 'com.link-assistant.hive-mind.router';
export const ROUTER_SIDECAR_IMAGE = 'ghcr.io/link-assistant/router:latest';

// Named volume, never removed by any Hive Mind code path: it holds the audit
// trail the whole feature exists to produce (issue #2164, R8).
export const ROUTER_DATA_VOLUME_NAME = 'hive-mind-router-data';
export const ROUTER_DATA_MOUNT = '/data/router';

// Vendor credential homes inside the sidecar. The router reads each from its
// matching `*_HOME` variable; mounting them here is what makes the sidecar the
// only point of contact with the subscription (R3).
export const ROUTER_CREDENTIAL_MOUNTS = Object.freeze([Object.freeze({ home: '.claude', target: '/data/claude', envVar: 'CLAUDE_CODE_HOME' }), Object.freeze({ home: '.codex', target: '/data/codex', envVar: 'CODEX_HOME' }), Object.freeze({ home: '.gemini', target: '/data/gemini', envVar: 'GEMINI_HOME' }), Object.freeze({ home: '.qwen', target: '/data/qwen', envVar: 'QWEN_HOME' })]);

/**
 * Tools whose CLI speaks the Anthropic Messages API. The router serves
 * `/v1/messages` at its root, so `ANTHROPIC_BASE_URL` needs no path suffix.
 */
const ANTHROPIC_TOOLS = new Set(['claude', 'agent']);

const normalizeTool = tool => String(tool || 'claude').toLowerCase();

/**
 * Is router isolation requested for this run?
 *
 * The flag is the primary switch; `HIVE_MIND_USE_ROUTER` exists so the Telegram
 * bot and nested `solve` invocations inherit the decision without every layer
 * having to thread an argument through.
 */
export function isRouterEnabled({ useRouter = false, env = process.env } = {}) {
  if (useRouter === true) return true;
  const fromEnv = String(env?.HIVE_MIND_USE_ROUTER || '')
    .trim()
    .toLowerCase();
  return fromEnv === '1' || fromEnv === 'true' || fromEnv === 'yes';
}

/**
 * Read `--use-router` out of a raw argument vector.
 *
 * The host has to know before it launches anything, because the sidecar must be
 * running and the token minted by the time the task container is created — but
 * the flag is also a real `solve`/`hive`/`task` option, so it is read from the
 * args rather than being stripped out of them the way `--isolation` is.
 *
 * @param {string[]} args
 * @returns {boolean}
 */
export function hasUseRouterFlag(args) {
  const list = Array.isArray(args) ? args : [];
  return list.some(arg => {
    const value = String(arg ?? '');
    return value === '--use-router' || value === '--use-router=true';
  });
}

/**
 * Validate a router endpoint.
 *
 * Mirrors `normalizeFormalAiBaseUrl`: an origin only. A path, query, fragment
 * or embedded credential is rejected rather than silently dropped, because a
 * base URL that is *almost* right produces 404s that look like router bugs.
 *
 * @returns {string|null} normalized `scheme://host[:port]`, or null when invalid
 */
export function normalizeRouterBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.search || parsed.hash) return null;
  if (parsed.pathname && parsed.pathname !== '/') return null;
  if (!parsed.hostname) return null;
  return `${parsed.protocol}//${parsed.host}`;
}

/** Endpoint of the sidecar Hive Mind starts itself, reachable only on the internal network. */
export function getInternalRouterBaseUrl() {
  return `http://${ROUTER_SIDECAR_NETWORK_ALIAS}:${ROUTER_SIDECAR_PORT}`;
}

/**
 * Resolve which router a task should talk to.
 *
 * An operator who already runs a router elsewhere sets `HIVE_MIND_ROUTER_URL`
 * and Hive Mind skips starting its own sidecar; this mirrors the router's own
 * `LINK_ASSISTANT_ROUTER_URL` resolution order.
 *
 * @returns {{baseUrl: string, external: boolean, error: string|null}}
 */
export function resolveRouterBaseUrl({ env = process.env } = {}) {
  const explicit = String(env?.HIVE_MIND_ROUTER_URL || '').trim();
  if (!explicit) {
    return { baseUrl: getInternalRouterBaseUrl(), external: false, error: null };
  }
  const normalized = normalizeRouterBaseUrl(explicit);
  if (!normalized) {
    return {
      baseUrl: null,
      external: true,
      error: `HIVE_MIND_ROUTER_URL is not a bare http(s) origin: ${explicit}`,
    };
  }
  return { baseUrl: normalized, external: true, error: null };
}

/**
 * Resolve the host `gh` should treat as its GitHub endpoint.
 *
 * `gh` builds a custom host's REST base as `https://<host>/api/v3/` and offers
 * no plaintext option, while the router listens on plain HTTP and ships no TLS
 * listener of its own (reported upstream as link-assistant/router#263). So GitHub
 * routing is only wired when the operator supplies an HTTPS-terminated endpoint
 * via `HIVE_MIND_ROUTER_GH_HOST`; otherwise the task keeps its own gh credential
 * and the caller warns that GitHub traffic is not router-mediated.
 *
 * @returns {string|null} bare hostname (no scheme, no path), or null when unset
 */
export function resolveRouterGhHost({ env = process.env } = {}) {
  const raw = String(env?.HIVE_MIND_ROUTER_GH_HOST || '').trim();
  if (!raw) return null;
  const candidate = raw.includes('://') ? raw : `https://${raw}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  // Plain HTTP would silently fail inside gh, so refuse it here where we can explain why.
  if (parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;
  return parsed.host;
}

/**
 * Environment a routed task needs so its AI CLI and `gh` reach the router
 * instead of the vendor directly.
 *
 * `ANTHROPIC_BASE_URL` is the important one: Claude Code sends *every* request
 * through it, including agentic sub-loops, so there is no path that quietly
 * escapes the proxy. The router accepts the task token as either
 * `Authorization: Bearer` or `x-api-key`, so both variables are set and the CLI
 * may use whichever it prefers.
 *
 * @returns {Record<string,string>}
 */
export function buildRouterTaskEnv({ tool = 'claude', baseUrl, token, ghHost = null } = {}) {
  if (!baseUrl || !token) return {};
  const normalizedTool = normalizeTool(tool);
  const taskEnv = {
    HIVE_MIND_USE_ROUTER: '1',
    HIVE_MIND_ROUTER_URL: baseUrl,
    HIVE_MIND_ROUTER_TOKEN: token,
  };
  if (ANTHROPIC_TOOLS.has(normalizedTool)) {
    taskEnv.ANTHROPIC_BASE_URL = baseUrl;
    taskEnv.ANTHROPIC_AUTH_TOKEN = token;
    taskEnv.ANTHROPIC_API_KEY = token;
  } else {
    // codex, opencode, gemini and qwen all speak the OpenAI-compatible surface,
    // which the router serves under /v1.
    taskEnv.OPENAI_BASE_URL = `${baseUrl}/v1`;
    taskEnv.OPENAI_API_KEY = token;
  }
  if (ghHost) {
    taskEnv.GH_HOST = ghHost;
    taskEnv.GH_ENTERPRISE_TOKEN = token;
  }
  return taskEnv;
}

/**
 * Vendor credential paths that must NOT be mounted into a routed task.
 *
 * Exported so the suppression can be asserted directly in tests: the security
 * property of this feature is a negative one, and a negative is only trustworthy
 * when it is checked explicitly rather than inferred from a mount list.
 */
export function getRouterSuppressedCredentialPaths({ tool = 'claude', ghRouted = false } = {}) {
  const normalizedTool = normalizeTool(tool);
  const suppressed = [];
  if (normalizedTool === 'codex') {
    suppressed.push('.codex', '.agents');
  } else if (normalizedTool === 'claude') {
    suppressed.push('.claude', '.claude.json');
  }
  // gh config is only withheld when gh actually has somewhere else to go;
  // otherwise the task would lose GitHub access entirely (see resolveRouterGhHost).
  if (ghRouted) suppressed.push('.config/gh');
  return suppressed;
}

/**
 * Human-readable warnings for the parts of issue #2164 that are not yet covered,
 * so an experimental run states its own limits instead of implying full coverage.
 */
export function describeRouterCoverageGaps({ model = null, ghRouted = false } = {}) {
  const gaps = [];
  if (!ghRouted) {
    gaps.push('GitHub traffic is NOT routed: set HIVE_MIND_ROUTER_GH_HOST to an HTTPS-terminated router endpoint to enable it (gh refuses plaintext custom hosts; upstream link-assistant/router#263).');
  }
  if (String(model || '').toLowerCase() === 'formal-ai') {
    gaps.push('Formal AI model traffic is NOT routed: it still goes straight to the Formal AI sidecar, because automatic routing ignores stored OpenAI-compatible providers (upstream link-assistant/router#260).');
  }
  gaps.push('Destructive git operations are blocked by a pre-push hook inside the task, which `git push --no-verify` can bypass; branch protection is the only unbypassable control until the router gains a git transport (upstream link-assistant/router#261).');
  return gaps;
}
