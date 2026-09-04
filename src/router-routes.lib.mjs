/**
 * Router route dialects (issue #2202).
 *
 * Router 1.0.0 replaced every public route with one classified namespace —
 * `/api/health`, `/api/management/*`, `/api/services/*` — and removed all the
 * legacy root, `/v1/*` and overlapping `/api/*` aliases (upstream router#391).
 * The two surfaces are **disjoint**: probing `0.119.0` and `1.2.0` side by side
 * with Hive Mind's own `serve` arguments, every path that answers on one is a
 * 404 on the other (`docs/case-studies/issue-2202/data/measurements/
 * router-route-comparison-2026-09-04.md`, reproducible with
 * `experiments/issue-2202/compare-router-routes.sh`).
 *
 * So `--use-router` cannot hard-code either shape. It has to know which router
 * it is talking to and spell the paths accordingly, which is what this module
 * is: two frozen tables plus the resolution rule, and nothing else. Keeping it
 * a leaf module means `router-isolation.lib.mjs`, `router-sidecar.lib.mjs` and
 * the model catalogue can all derive their URLs from one place, and a future
 * dialect is a table entry rather than a grep.
 *
 * Why both are supported rather than just the newest: on `1.x` the GitHub proxy
 * moved under `/api/services/github/api/v3`, and `gh` builds a custom host's
 * REST base as `https://<host>/api/v3/` with no path-prefix setting — a
 * limitation the router's own release notes state twice. There is therefore no
 * client-side configuration that lets an unmodified `gh` reach the new prefix,
 * and moving the pin unconditionally would delete the `gh` mediation issue
 * #2164 shipped. Until upstream lands a `gh`-reachable base, the default pin
 * stays on the legacy dialect and `1.x` is opt-in via `HIVE_MIND_ROUTER_IMAGE`,
 * with the trade-off reported rather than discovered.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2202
 * @see https://github.com/link-assistant/hive-mind/issues/2164
 */

/**
 * Pre-1.0 routes. Everything hangs off the origin: Anthropic at `/v1/messages`,
 * the OpenAI-compatible surface at `/v1`, GitHub at `/api/v3` and `/api/graphql`,
 * git at `/git`. One `/v1/models` serves every provider the router has adopted,
 * so there is a single catalogue endpoint rather than one per service.
 */
const LEGACY_DIALECT = Object.freeze({
  id: 'legacy',
  description: 'router < 1.0 (root, /v1/*, /api/v3)',
  health: '/health',
  // Pre-1.0 has no management namespace: token commands are CLI-only.
  management: null,
  services: Object.freeze({
    anthropic: '',
    openai: '/v1',
    codex: '/v1',
    qwen: '/v1',
    // Never served on this dialect; callers must treat null as "not wired".
    gemini: null,
  }),
  github: Object.freeze({
    rest: '/api/v3',
    graphql: '/api/graphql',
    git: '/git',
  }),
  catalogues: Object.freeze([Object.freeze({ service: 'openai', path: '/v1/models', shape: 'openai' })]),
  // An unmodified `gh` reaches the REST proxy, because its own base — /api/v3/ — is where the router serves it.
  ghReachable: true,
});

/**
 * Router >= 1.0. Three namespaces, one per route class, and one catalogue per
 * adopted service. `/api/services/models` does not exist yet — the merged
 * envelope is asked for upstream in link-assistant/router#417, but until it
 * lands a client fans out.
 *
 * The catalogue routes answer a *superset* of the OpenAI envelope: `data` and
 * `object` sit where OpenAI puts them, alongside `using_fallback`,
 * `degraded_providers`, `degraded_reasons` and `catalog_conflicts`. The router
 * keeps its own per-provider catalogue and retains the last known one when a
 * refresh fails, so those fields are the difference between "this is live" and
 * "this is what we last saw" — a reader that takes only `data[].id` discards
 * the one signal that distinguishes them. Measured in
 * `docs/case-studies/issue-2202/data/measurements/router-credentials-and-tokens-2026-09-04.md`.
 */
const CANONICAL_DIALECT = Object.freeze({
  id: 'canonical',
  description: 'router >= 1.0 (/api/health, /api/management/*, /api/services/*)',
  health: '/api/health',
  management: '/api/management',
  services: Object.freeze({
    anthropic: '/api/services/anthropic',
    openai: '/api/services/openai/v1',
    codex: '/api/services/codex/v1',
    qwen: '/api/services/qwen/v1',
    gemini: '/api/services/gemini',
  }),
  github: Object.freeze({
    rest: '/api/services/github/api/v3',
    graphql: '/api/services/github/api/graphql',
    git: '/api/services/github/git',
  }),
  catalogues: Object.freeze([Object.freeze({ service: 'anthropic', path: '/api/services/anthropic/v1/models', shape: 'anthropic' }), Object.freeze({ service: 'openai', path: '/api/services/openai/v1/models', shape: 'openai' }), Object.freeze({ service: 'codex', path: '/api/services/codex/v1/models', shape: 'openai' }), Object.freeze({ service: 'qwen', path: '/api/services/qwen/v1/models', shape: 'openai' }), Object.freeze({ service: 'gemini', path: '/api/services/gemini/v1beta/models', shape: 'gemini' })]),
  // `gh` has no path-prefix setting, so it cannot prepend /api/services/github.
  ghReachable: false,
});

export const ROUTER_ROUTE_DIALECTS = Object.freeze({
  legacy: LEGACY_DIALECT,
  canonical: CANONICAL_DIALECT,
});

/** The dialect assumed when the router's version cannot be determined. */
export const ROUTER_DEFAULT_UNKNOWN_DIALECT = 'canonical';

/**
 * Which router service each tool speaks to.
 *
 * `agent` is grouped with Claude because it is Anthropic-shaped, and `opencode`
 * with plain OpenAI because it uses chat completions rather than the Codex
 * `responses` wire API.
 */
export const ROUTER_TOOL_SERVICE = Object.freeze({
  claude: 'anthropic',
  agent: 'anthropic',
  codex: 'codex',
  opencode: 'openai',
  qwen: 'qwen',
  gemini: 'gemini',
});

/**
 * Major version of a pinned router image reference.
 *
 * Handles `repo:1.2.0`, `repo:v1.2.0-rc.1` and a bare `1.2.0`. Returns null for
 * a digest pin, a moving tag like `latest`, or anything else without a leading
 * numeric component — the caller decides what an unknown version means.
 *
 * @param {string} image e.g. `ghcr.io/link-assistant/router:1.2.0`
 * @returns {number|null}
 */
export function parseRouterImageMajor(image) {
  const raw = String(image || '').trim();
  if (!raw) return null;
  // Strip a digest pin first: it carries no version information at all.
  const withoutDigest = raw.split('@')[0];
  const lastColon = withoutDigest.lastIndexOf(':');
  const lastSlash = withoutDigest.lastIndexOf('/');
  // A colon before the last slash is a registry port, not a tag separator.
  const tag = lastColon > lastSlash ? withoutDigest.slice(lastColon + 1) : withoutDigest;
  const match = /^v?(\d+)\./.exec(tag.trim());
  if (!match) return null;
  return Number(match[1]);
}

/**
 * Decide which route dialect a router speaks.
 *
 * Resolution order, most explicit first:
 *
 * 1. `HIVE_MIND_ROUTER_ROUTES` — an escape hatch for an operator running a
 *    build whose tag does not describe it (a fork, a digest pin, `latest`).
 * 2. The pinned image tag, which is what Hive Mind itself starts.
 * 3. {@link ROUTER_DEFAULT_UNKNOWN_DIALECT}, because an untagged or moving
 *    reference is far more likely to be a recent build than a pre-1.0 one.
 *
 * @returns {{dialect: object, source: 'env'|'image'|'default', error: string|null}}
 */
export function resolveRouterRouteDialect({ image = null, env = process.env } = {}) {
  const explicit = String(env?.HIVE_MIND_ROUTER_ROUTES || '')
    .trim()
    .toLowerCase();
  if (explicit) {
    const chosen = ROUTER_ROUTE_DIALECTS[explicit];
    if (chosen) return { dialect: chosen, source: 'env', error: null };
    return {
      dialect: ROUTER_ROUTE_DIALECTS[ROUTER_DEFAULT_UNKNOWN_DIALECT],
      source: 'default',
      error: `HIVE_MIND_ROUTER_ROUTES must be one of ${Object.keys(ROUTER_ROUTE_DIALECTS).join(', ')}: ${explicit}`,
    };
  }
  const major = parseRouterImageMajor(image);
  if (major === null) {
    return { dialect: ROUTER_ROUTE_DIALECTS[ROUTER_DEFAULT_UNKNOWN_DIALECT], source: 'default', error: null };
  }
  return { dialect: major >= 1 ? CANONICAL_DIALECT : LEGACY_DIALECT, source: 'image', error: null };
}

const trimOrigin = baseUrl => String(baseUrl || '').replace(/\/+$/, '');

/**
 * Join an origin and a dialect path into a base URL a client can be handed.
 *
 * @returns {string|null} null when either side is missing, so "not served on
 *   this dialect" stays distinguishable from "served at the origin" (the
 *   Anthropic case on the legacy dialect, where the path is an empty string).
 */
export function buildRouterRouteUrl(baseUrl, path) {
  const origin = trimOrigin(baseUrl);
  if (!origin || path === null || path === undefined) return null;
  return `${origin}${path}`;
}

/**
 * Base URL for one router service, e.g. `anthropic` or `codex`.
 *
 * @returns {string|null} null when the dialect does not serve it.
 */
export function buildRouterServiceUrl({ baseUrl, dialect, service } = {}) {
  if (!dialect || !service) return null;
  const path = dialect.services?.[service];
  if (path === null || path === undefined) return null;
  return buildRouterRouteUrl(baseUrl, path);
}

/**
 * Base URL for the service a given tool talks to.
 *
 * @returns {string|null}
 */
export function buildRouterToolServiceUrl({ baseUrl, dialect, tool } = {}) {
  const service = ROUTER_TOOL_SERVICE[String(tool || '').toLowerCase()];
  if (!service) return null;
  return buildRouterServiceUrl({ baseUrl, dialect, service });
}

/** Absolute URL of the router's unauthenticated health endpoint. */
export function buildRouterHealthUrl({ baseUrl, dialect } = {}) {
  return buildRouterRouteUrl(baseUrl, dialect?.health);
}

/**
 * Absolute model-catalogue endpoints for a dialect, with the response shape each
 * one returns so a caller can normalise without sniffing.
 *
 * @returns {Array<{service: string, url: string, shape: 'anthropic'|'openai'|'gemini'}>}
 */
export function buildRouterCatalogueEndpoints({ baseUrl, dialect } = {}) {
  if (!dialect) return [];
  const endpoints = [];
  for (const entry of dialect.catalogues || []) {
    const url = buildRouterRouteUrl(baseUrl, entry.path);
    if (url) endpoints.push({ service: entry.service, url, shape: entry.shape });
  }
  return endpoints;
}

/**
 * Git URL prefix that replaces `https://github.com/`.
 *
 * Always trailing-slashed: git matches `url.<prefix>.insteadOf` textually, and a
 * missing slash silently produces `…/gitowner/repo`.
 */
export function buildRouterGitUrlPrefix({ baseUrl, dialect } = {}) {
  const url = buildRouterRouteUrl(baseUrl, dialect?.github?.git);
  return url ? `${url}/` : null;
}
