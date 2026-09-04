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
 * Three decisions here are worth stating, because they are what makes the
 * isolation hold rather than merely look tidy (all three were measured first —
 * see `experiments/issue-2164/`):
 *
 * 1. **The router serves TLS on 443.** The router terminates TLS itself
 *    (`TLS_SELF_SIGNED=1`) and prints its CA with `router tls ca`. Plain HTTP
 *    would rule out `gh` entirely, which refuses non-HTTPS hosts.
 * 2. **GitHub is intercepted by name, not by reconfiguring `gh`.** The
 *    certificate carries `api.github.com` as a SAN and the *task* container gets
 *    `<router-ip> api.github.com` in its `/etc/hosts`. Every form an agent might
 *    use — `gh api`, `gh pr view <url>`, a bare `curl` — lands on the router
 *    without the agent being asked to cooperate. The alias is deliberately NOT
 *    added to the router's own network attachment: the router has to resolve
 *    `api.github.com` to the real GitHub, and an alias would make it resolve to
 *    itself (measured: 502 on every proxied call).
 * 3. **`github.com` itself stays untouched**, so git is pointed at the router's
 *    smart-HTTP proxy explicitly with `url.<router>/git/.insteadOf`.
 * 4. **Every path is derived from a route dialect, never spelled inline**
 *    (issue #2202). Router 1.0.0 moved the whole public surface and removed the
 *    old aliases, so the shape depends on which image is running;
 *    `router-routes.lib.mjs` holds the two tables and this module asks it.
 *
 * This module is deliberately pure: it decides *what a routed task should see*
 * and nothing else, so the policy is testable without Docker. Container
 * lifecycle lives in `router-sidecar.lib.mjs`.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2164
 * @see https://github.com/link-assistant/hive-mind/issues/2202
 */

import { buildRouterGitUrlPrefix, buildRouterToolServiceUrl, resolveRouterRouteDialect, ROUTER_TOOL_SERVICE } from './router-routes.lib.mjs';

export const ROUTER_SIDECAR_CONTAINER_NAME = 'hive-mind-router';
export const ROUTER_SIDECAR_NETWORK_NAME = 'hive-mind-router';
// Tasks reach the sidecar by alias, so the endpoint stays stable across restarts.
export const ROUTER_SIDECAR_NETWORK_ALIAS = 'link-assistant-router';
// 443, because `gh` builds every endpoint as `https://<host>/…` with no port and
// no plaintext option. Serving the default HTTPS port is what lets the same
// listener answer both the agent CLIs and an unmodified `gh`.
export const ROUTER_SIDECAR_PORT = 443;
export const ROUTER_SIDECAR_LABEL = 'com.link-assistant.hive-mind.router';
// Pinned: an experimental feature that depends on `router tls ca`, the git proxy
// and per-token request logs must not silently change underneath a running fleet.
// 0.110.0 is the floor: it carries the compare-based force-push mediation
// (upstream router#273), without which a routed task can still rewrite history.
// Override with HIVE_MIND_ROUTER_IMAGE.
//
// 0.125.4 is the highest 0.x release, and the pin sits there rather than on
// 0.119.0 because 0.120.0 is where a routed Codex task stopped being told that
// new models do not exist: the ChatGPT backend gates them behind a `version`
// header the router only started sending then, and without it `POST /responses`
// answers `Model not found` (issue #2202, requirement R1).
//
// The pin deliberately stays on 0.x even though upstream is at 1.2.0. Router
// 1.0.0 moved the GitHub proxy under `/api/services/github/api/v3` and `gh`
// builds a custom host's REST base as `https://<host>/api/v3/` with no
// path-prefix setting, so no client-side configuration reaches the new prefix
// and bumping across 1.0 would silently delete the `gh` mediation this feature
// shipped (upstream link-assistant/router#415; measured in
// `docs/case-studies/issue-2202/data/measurements/
// router-route-comparison-2026-09-04.md`). Every other route is already
// supported on both dialects, so the day upstream lands a gh-reachable base
// this becomes a one-line change with the tests already in place.
export const ROUTER_SIDECAR_IMAGE = 'ghcr.io/link-assistant/router:0.125.4';

/**
 * Router image this run should use.
 *
 * Lives here rather than in `router-sidecar.lib.mjs` because the route dialect
 * is derived from it and this module is the leaf both sides import.
 */
export const resolveRouterSidecarImage = (env = process.env) => String(env?.HIVE_MIND_ROUTER_IMAGE || '').trim() || ROUTER_SIDECAR_IMAGE;

/**
 * Route dialect for this run, resolved from the image that will actually be
 * started (or from `HIVE_MIND_ROUTER_ROUTES` when an operator declares it).
 *
 * @returns {{dialect: object, source: 'env'|'image'|'default', error: string|null}}
 */
export function resolveRouterDialect({ env = process.env } = {}) {
  return resolveRouterRouteDialect({ image: resolveRouterSidecarImage(env), env });
}

/** The one GitHub name the router impersonates; see the module header. */
export const ROUTER_GITHUB_API_HOST = 'api.github.com';
/** SANs the sidecar's self-signed certificate must carry. */
export const ROUTER_TLS_DNS_NAMES = `${ROUTER_SIDECAR_NETWORK_ALIAS},${ROUTER_GITHUB_API_HOST}`;

// Where the task container is given the router's CA. Two files, because clients
// disagree about what the variable means: NODE_EXTRA_CA_CERTS *adds* to the
// system store, while SSL_CERT_FILE *replaces* it — so the latter must be handed
// a bundle that still contains the public roots, or the task loses the ability
// to verify every other site on the internet.
export const ROUTER_CA_CONTAINER_PATH = '/etc/hive-mind-router-ca.pem';
export const ROUTER_CA_BUNDLE_CONTAINER_PATH = '/etc/hive-mind-router-ca-bundle.pem';
export const CONTAINER_SYSTEM_CA_BUNDLE = '/etc/ssl/certs/ca-certificates.crt';

// Named volume, never removed by any Hive Mind code path: it holds the audit
// trail the whole feature exists to produce (issue #2164, R8).
export const ROUTER_DATA_VOLUME_NAME = 'hive-mind-router-data';
export const ROUTER_DATA_MOUNT = '/data/router';

// Vendor credential homes inside the sidecar. The router reads each from its
// matching `*_HOME` variable; mounting them here is what makes the sidecar the
// only point of contact with the subscription (R3). `~/.config/gh` is mounted
// read-only: the router only ever reads the token out of `hosts.yml`, and a
// writable mount would let a proxied call rewrite the operator's own gh state.
export const ROUTER_CREDENTIAL_MOUNTS = Object.freeze([Object.freeze({ home: '.claude', target: '/data/claude', envVar: 'CLAUDE_CODE_HOME' }), Object.freeze({ home: '.codex', target: '/data/codex', envVar: 'CODEX_HOME' }), Object.freeze({ home: '.gemini', target: '/data/gemini', envVar: 'GEMINI_HOME' }), Object.freeze({ home: '.qwen', target: '/data/qwen', envVar: 'QWEN_HOME' })]);

/** The gh credential the router presents upstream, mounted read-only (R12). */
export const ROUTER_GH_CONFIG_MOUNT = Object.freeze({ home: '.config/gh', target: '/data/gh', envVar: 'GH_CONFIG_DIR', readOnly: true });

/**
 * Tools whose CLI speaks the Anthropic Messages API. The router serves
 * `/v1/messages` at its root, so `ANTHROPIC_BASE_URL` needs no path suffix.
 */
const ANTHROPIC_TOOLS = new Set(['claude', 'agent']);

/** Provider id written into a routed task's `config.toml` (codex). */
const CODEX_PROVIDER_ID = 'hive-mind-router';

const normalizeTool = tool => String(tool || 'claude').toLowerCase();

const isFalsey = value =>
  ['0', 'false', 'no'].includes(
    String(value || '')
      .trim()
      .toLowerCase()
  );

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

/**
 * Endpoint of the sidecar Hive Mind starts itself, reachable only on the
 * internal network. The port is omitted when it is 443 so the authority matches
 * the certificate the way every client expects.
 */
export function getInternalRouterBaseUrl() {
  const port = ROUTER_SIDECAR_PORT === 443 ? '' : `:${ROUTER_SIDECAR_PORT}`;
  return `https://${ROUTER_SIDECAR_NETWORK_ALIAS}${port}`;
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
 * Resolve an explicit host for `gh`, for the external-router case only.
 *
 * The sidecar Hive Mind starts needs none of this: it answers to
 * `api.github.com` directly (see the module header). An operator-run router,
 * though, is on someone else's network with a certificate Hive Mind cannot
 * inspect, so GitHub routing there has to be declared — and `gh` builds a custom
 * host's REST base as `https://<host>/api/v3/` with no plaintext option, so the
 * value must be HTTPS.
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
 * How GitHub traffic reaches the router for this task.
 *
 * - `transparent`: our own sidecar answers to `api.github.com` (the default).
 * - `host`: an operator-supplied HTTPS endpoint, wired through `GH_HOST`.
 * - `off`: not routed — the task keeps its own gh credential and the caller
 *   warns about it.
 *
 * @returns {{mode: 'transparent'|'host'|'off', ghHost: string|null}}
 */
export function resolveRouterGitHubRouting({ env = process.env, external = false } = {}) {
  if (isFalsey(env?.HIVE_MIND_ROUTER_GITHUB)) return { mode: 'off', ghHost: null };
  const explicit = resolveRouterGhHost({ env });
  if (explicit) return { mode: 'host', ghHost: explicit };
  // An external router is not on a network we control, so there is no container
  // whose /etc/hosts we could point at it.
  if (external) return { mode: 'off', ghHost: null };
  return { mode: 'transparent', ghHost: null };
}

/**
 * Git configuration a routed task needs, as `key=value` pairs.
 *
 * `github.com` is not intercepted — only `api.github.com` is — so git is sent to
 * the router's smart-HTTP proxy by rewriting the URL. The token rides in a
 * scoped `http.<url>.extraHeader` rather than in the URL itself, so it never
 * lands in a remote URL, a reflog or an error message.
 *
 * `credential.helper` is reset to empty on purpose: the operator's `~/.gitconfig`
 * is mounted into every task and may name a helper holding a real GitHub token.
 * An empty value clears the inherited list, so the only credential the task can
 * present is the router's.
 *
 * @returns {Array<[string, string]>}
 */
export function buildRouterGitConfigEntries({ baseUrl, token, githubMode = 'transparent', dialect = null } = {}) {
  if (!baseUrl || !token || githubMode === 'off') return [];
  const routes = dialect || resolveRouterDialect().dialect;
  const gitPrefix = buildRouterGitUrlPrefix({ baseUrl, dialect: routes });
  if (!gitPrefix) return [];
  // The CA and the header stay scoped to the origin, not to the git prefix:
  // git matches these keys by URL prefix, and the origin covers every path the
  // router serves — including a future one — while the rewrite target must be
  // exact.
  const routerUrl = `${String(baseUrl).replace(/\/+$/, '')}/`;
  return [
    ['credential.helper', ''],
    ['url.' + gitPrefix + '.insteadOf', 'https://github.com/'],
    [`http.${routerUrl}.sslCAInfo`, ROUTER_CA_CONTAINER_PATH],
    [`http.${routerUrl}.extraHeader`, `Authorization: Bearer ${token}`],
  ];
}

/**
 * Environment a routed task needs so its AI CLI, `gh` and `git` reach the router
 * instead of the vendor directly.
 *
 * `ANTHROPIC_BASE_URL` is the important one: Claude Code sends *every* request
 * through it, including agentic sub-loops, so there is no path that quietly
 * escapes the proxy. The router accepts the task token as either
 * `Authorization: Bearer` or `x-api-key`, so both variables are set and the CLI
 * may use whichever it prefers.
 *
 * The CA variables are not interchangeable and each client honours a different
 * one (measured in `experiments/issue-2164/probe-clients-tls.sh`): Node and
 * Claude Code read `NODE_EXTRA_CA_CERTS`, Rust/`gh`/`codex` read `SSL_CERT_FILE`,
 * curl reads `CURL_CA_BUNDLE`.
 *
 * @returns {Record<string,string>}
 */
export function buildRouterTaskEnv({ tool = 'claude', baseUrl, token, githubMode = 'transparent', ghHost = null, homeDir = '/home/box', dialect = null } = {}) {
  if (!baseUrl || !token) return {};
  const normalizedTool = normalizeTool(tool);
  const routes = dialect || resolveRouterDialect().dialect;
  const serviceUrl = buildRouterToolServiceUrl({ baseUrl, dialect: routes, tool: normalizedTool });
  const taskEnv = {
    HIVE_MIND_USE_ROUTER: '1',
    HIVE_MIND_ROUTER_URL: baseUrl,
    HIVE_MIND_ROUTER_TOKEN: token,
    // Trust the router's CA without losing the public roots.
    NODE_EXTRA_CA_CERTS: ROUTER_CA_CONTAINER_PATH,
    SSL_CERT_FILE: ROUTER_CA_BUNDLE_CONTAINER_PATH,
    CURL_CA_BUNDLE: ROUTER_CA_BUNDLE_CONTAINER_PATH,
    REQUESTS_CA_BUNDLE: ROUTER_CA_BUNDLE_CONTAINER_PATH,
    // A routed task holds no interactive credential; prompting would hang it.
    GIT_TERMINAL_PROMPT: '0',
  };
  if (ANTHROPIC_TOOLS.has(normalizedTool)) {
    // serviceUrl is the origin itself on the legacy dialect and
    // <origin>/api/services/anthropic on the canonical one; Claude Code appends
    // /v1/messages to whichever it is given.
    if (serviceUrl) taskEnv.ANTHROPIC_BASE_URL = serviceUrl;
    taskEnv.ANTHROPIC_AUTH_TOKEN = token;
    taskEnv.ANTHROPIC_API_KEY = token;
  } else if (normalizedTool === 'gemini') {
    // gemini-cli reads neither of the two variables above. Before issue #2202 it
    // was handed OPENAI_BASE_URL and ignored it, which meant a "routed" gemini
    // task quietly called Google directly — an isolation hole, not a detail.
    // Only the canonical dialect serves Gemini at all, so a legacy pin wires
    // nothing rather than pointing the CLI at a 404.
    if (serviceUrl) {
      taskEnv.GOOGLE_GEMINI_BASE_URL = serviceUrl;
      taskEnv.GEMINI_API_KEY = token;
    }
  } else {
    // codex, opencode and qwen all speak the OpenAI-compatible surface. On the
    // canonical dialect each has its own service prefix, so they are no longer
    // interchangeable. Codex additionally ignores OPENAI_BASE_URL and needs the
    // generated provider entry written by buildRouterTaskWiringScript().
    if (serviceUrl) taskEnv.OPENAI_BASE_URL = serviceUrl;
    taskEnv.OPENAI_API_KEY = token;
    if (normalizedTool === 'codex') taskEnv.CODEX_HOME = `${homeDir}/.codex`;
  }
  if (githubMode === 'transparent') {
    // The host stays github.com: gh resolves api.github.com to the router
    // through /etc/hosts, so no gh reconfiguration is needed and every command
    // form — including `gh pr view <url>` — is covered.
    taskEnv.GH_TOKEN = token;
    taskEnv.GITHUB_TOKEN = token;
  } else if (githubMode === 'host' && ghHost) {
    taskEnv.GH_HOST = ghHost;
    taskEnv.GH_ENTERPRISE_TOKEN = token;
  }
  return taskEnv;
}

/**
 * The codex provider entry that points it at the router.
 *
 * Codex 0.147 ignores `OPENAI_BASE_URL` (measured: it kept calling
 * api.openai.com and returned 401), so the endpoint has to be declared as a
 * provider in `CODEX_HOME/config.toml`. `wire_api = "responses"` matches the
 * router's `…/responses`, which the dialect decides the prefix of.
 */
export function buildRouterCodexConfig({ baseUrl, dialect = null } = {}) {
  const routes = dialect || resolveRouterDialect().dialect;
  const codexUrl = buildRouterToolServiceUrl({ baseUrl, dialect: routes, tool: 'codex' }) || `${baseUrl}/v1`;
  return `model_provider = "${CODEX_PROVIDER_ID}"\n\n[model_providers.${CODEX_PROVIDER_ID}]\nname = "Hive Mind Router"\nbase_url = "${codexUrl}"\nenv_key = "OPENAI_API_KEY"\nwire_api = "responses"\n`;
}

/**
 * Name the Formal AI sidecar is stored under in the router's provider store, and
 * the model id it advertises (R11).
 */
export const ROUTER_FORMAL_AI_PROVIDER_NAME = 'hive-mind-formal-ai';
export const ROUTER_FORMAL_AI_MODEL = 'formal-ai';

/**
 * `router providers add` argv for an OpenAI-compatible upstream.
 *
 * The router keeps these in `<DATA_DIR>/providers.lenv` with the key encrypted
 * from `TOKEN_SECRET`, so a provider registered once survives a restart of the
 * sidecar and is never written to a task's environment.
 *
 * @returns {string[]|null} argv after the `router` binary, or null when a
 *   required field is missing.
 */
export function buildRouterProviderArgs({ name, baseUrl, model, models = null, apiKey = null } = {}) {
  if (!name || !baseUrl || !model) return null;
  const advertised = models && models.length ? models : [model];
  const args = ['providers', 'add', '--name', name, '--base-url', baseUrl, '--model', model, '--models', advertised.join(',')];
  // The Formal AI sidecar authenticates nothing, but the store requires a key;
  // an explicit placeholder is clearer than an empty string in providers.lenv.
  args.push('--api-key', apiKey || 'unused');
  return args;
}

/**
 * Register the Formal AI sidecar as a router provider (R11), so a task that asks
 * for `--model formal-ai` reaches it *through* the router rather than around it,
 * and the exchange lands in the same per-token request log and audit trail as
 * every model call.
 *
 * Measured in experiments/issue-2164/probe-formal-ai-provider.sh against router
 * 0.109.0: with the default `UPSTREAM_PROVIDER=auto` the router picks a stored
 * provider by the model id in the request, so adding this one does not pin the
 * router — Claude tasks sharing the same sidecar keep reaching Anthropic. After
 * the call, GET /v1/models advertises `{"id":"formal-ai","owned_by":
 * "hive-mind-formal-ai"}` and a chat completion for that id is answered by the
 * sidecar (HTTP 200), with `"provider":"openai-compatible","model":"formal-ai"`
 * recorded in /data/router/audit.jsonl. The pin has since moved to 0.125.4; the
 * `providers add` surface and the automatic-routing behaviour this relies on
 * (upstream router#260) are unchanged there, but the probe has not been re-run
 * against it — re-run it before treating the measurement as current.
 *
 * @param {string} baseUrl origin of the Formal AI sidecar, e.g.
 *   `http://link-assistant-formal-ai:8080`
 */
export function buildRouterFormalAiProviderArgs({ baseUrl } = {}) {
  const origin = String(baseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  if (!origin) return null;
  // The router calls `<base-url>/chat/completions`, so the version segment
  // belongs in the stored base URL.
  const versioned = /\/v1$/.test(origin) ? origin : `${origin}/v1`;
  return buildRouterProviderArgs({ name: ROUTER_FORMAL_AI_PROVIDER_NAME, baseUrl: versioned, model: ROUTER_FORMAL_AI_MODEL });
}

/**
 * The one-shot script that finishes wiring a task container from the host.
 *
 * It runs as root through `docker exec` while the start gate still holds the
 * task command, because start-command's Docker backend forwards only
 * `--privileged`, `-e`, `-v`, `--mount`, `--network` and `--network-alias` —
 * there is no `--add-host` to pass through, and the CA is not known until the
 * router has generated it.
 *
 * Every step is idempotent: an acquire that reuses a running sidecar re-runs
 * this without duplicating a hosts entry or a certificate.
 *
 * @returns {string} a `sh -c` script
 */
export function buildRouterTaskWiringScript({ routerIp = null, caCertificate = null, homeDir = '/home/box', tool = 'claude', baseUrl = getInternalRouterBaseUrl(), githubMode = 'transparent', dialect = null } = {}) {
  const lines = ['set -e'];
  if (caCertificate) {
    lines.push(`cat > ${ROUTER_CA_CONTAINER_PATH} <<'HIVE_MIND_ROUTER_CA_PEM'`, String(caCertificate).trim(), 'HIVE_MIND_ROUTER_CA_PEM', `chmod 0644 ${ROUTER_CA_CONTAINER_PATH}`);
    // SSL_CERT_FILE replaces the system store rather than adding to it, so the
    // bundle has to carry the public roots too. A missing system bundle is not
    // fatal: the task still trusts the router, which is what it cannot do without.
    lines.push(`: > ${ROUTER_CA_BUNDLE_CONTAINER_PATH}`, `if [ -f ${CONTAINER_SYSTEM_CA_BUNDLE} ]; then cat ${CONTAINER_SYSTEM_CA_BUNDLE} >> ${ROUTER_CA_BUNDLE_CONTAINER_PATH}; fi`, `cat ${ROUTER_CA_CONTAINER_PATH} >> ${ROUTER_CA_BUNDLE_CONTAINER_PATH}`, `chmod 0644 ${ROUTER_CA_BUNDLE_CONTAINER_PATH}`);
  }
  if (routerIp && githubMode === 'transparent') {
    lines.push(`if ! grep -q ' ${ROUTER_GITHUB_API_HOST}$' /etc/hosts; then printf '%s %s\\n' '${routerIp}' '${ROUTER_GITHUB_API_HOST}' >> /etc/hosts; fi`);
  }
  if (normalizeTool(tool) === 'codex') {
    const codexHome = `${homeDir}/.codex`;
    lines.push(`mkdir -p ${codexHome}`, `cat > ${codexHome}/config.toml <<'HIVE_MIND_ROUTER_CODEX_TOML'`, buildRouterCodexConfig({ baseUrl, dialect }).trimEnd(), 'HIVE_MIND_ROUTER_CODEX_TOML');
    // The exec runs as root; the task does not, and codex rewrites its own
    // config. Hand the directory to whoever owns the home directory.
    lines.push(`owner=$(stat -c '%u:%g' ${homeDir} 2>/dev/null || echo '')`, `if [ -n "$owner" ]; then chown -R "$owner" ${codexHome}; fi`);
  }
  return lines.join('\n');
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
  // otherwise the task would lose GitHub access entirely (see resolveRouterGitHubRouting).
  if (ghRouted) suppressed.push('.config/gh');
  return suppressed;
}

/**
 * Human-readable warnings for the parts of issue #2164 that are not yet covered,
 * so an experimental run states its own limits instead of implying full coverage.
 */
export function describeRouterCoverageGaps({ model = null, tool = 'claude', githubMode = 'transparent', dialect = null } = {}) {
  const gaps = [];
  const routes = dialect || resolveRouterDialect().dialect;
  // Measured in experiments/issue-2202/compare-router-routes.sh: on router >= 1.0
  // the GitHub proxy is only mounted under /api/services/github/api/*, and `gh`
  // builds a custom host's REST base as `https://<host>/api/v3/` with no
  // path-prefix setting. Nothing on the client side closes that gap, so a run on
  // the canonical dialect has to say what it lost rather than 404 in the task.
  if (githubMode !== 'off' && routes && routes.ghReachable === false) {
    gaps.push(`This router serves the GitHub proxy under ${routes.github.rest} and ${routes.github.graphql}, but gh has no path-prefix setting and always calls /api/v3/ — so \`gh api\` and GraphQL are NOT mediated on this dialect. git still is. Pin HIVE_MIND_ROUTER_IMAGE to a 0.x router to keep gh routed (upstream link-assistant/router#415).`);
  }
  // buildRouterTaskEnv wires no base URL when the dialect serves nothing for
  // this tool (Gemini on the legacy dialect is the live case). The CLI then
  // keeps its own credential and calls the vendor directly, which is the
  // opposite of what `--use-router` was asked for — so the run has to say it
  // rather than look routed.
  const service = ROUTER_TOOL_SERVICE[normalizeTool(tool)];
  if (!service || routes?.services?.[service] === null || routes?.services?.[service] === undefined) {
    gaps.push(`This router (${routes?.description ?? 'unknown dialect'}) serves no endpoint for '${normalizeTool(tool)}', so its model traffic is NOT routed: the CLI keeps its own credential and calls the vendor directly. Pin HIVE_MIND_ROUTER_IMAGE to a router that serves this tool, or run it without --use-router rather than assuming it is mediated.`);
  }
  if (githubMode === 'off') {
    gaps.push('GitHub traffic is NOT routed: the task keeps its own gh credential, and destructive API calls are not mediated. Unset HIVE_MIND_ROUTER_GITHUB, or set HIVE_MIND_ROUTER_GH_HOST for an external router.');
  }
  // Measured in experiments/issue-2164/probe-git-transport.sh against router
  // 0.109.0: the router refused `git push :ref` with 403, but a non-fast-forward
  // push succeeded, because git never announces the `force-ref-updates`
  // capability the router looked for. Reported as router#272 and fixed upstream
  // in router#273: from 0.110.0 the router asks GitHub's compare API whether the
  // proposed tip is ahead of the current one and forwards the packfile only if it
  // is, failing closed on any answer it cannot read. The pin is now 0.125.4, so
  // that layer is live and this is no longer warned about.
  //
  // What remains uncovered is the other half of R13. The router's built-in
  // GitHub policy keys on the HTTP method — any DELETE, a forced REST ref
  // update, a destructive GraphQL mutation — so destructive operations spelled
  // as PUT/PATCH/POST are still forwarded. Reported as router#329.
  gaps.push('Destructive GitHub API calls are blocked by method, not by effect: DELETE, forced ref updates and destructive GraphQL are refused, but `PUT /repos/{o}/{r}/branches/{b}/protection`, `PUT .../rulesets/{id}`, `POST .../transfer` and `PATCH /repos/{o}/{r}` with visibility/archived/default_branch are not (upstream link-assistant/router#329). Branch protection is reachable this way, so it is not a control the task cannot touch — keep the repository owner outside the token scope for anything that must not change.');
  if (!ANTHROPIC_TOOLS.has(normalizeTool(tool))) {
    gaps.push(`Routing for '${normalizeTool(tool)}' is less exercised than Claude Code: it is wired through the router's OpenAI-compatible surface and a generated provider entry, and only Claude Code has an end-to-end proof in experiments/issue-2164/.`);
  }
  const requested = String(model || '').trim();
  if (requested === 'formal-ai') {
    gaps.push("Formal AI is registered on the router as an OpenAI-compatible provider, so `--model formal-ai` is served through it and appears in the audit log. The Formal AI sidecar's own upstream calls are not routed yet: when it is run in agent mode against a vendor API, that leg still leaves the sidecar directly.");
  } else if (requested && !/\d/.test(requested)) {
    // The router ships no alias table by design (upstream router#192), and
    // declined to add tier resolution when it was raised (router#323). From
    // 0.115.0 the refusal at least names the ids the deployment does advertise,
    // so a wrong name is one run away from the right one instead of a dead end.
    gaps.push(`The router resolves exact model ids only, as advertised by GET /v1/models — an alias like '${requested}' is rejected, and the refusal lists the ids it would have accepted. Use one of those (for example claude-sonnet-4-5-20250929).`);
  }
  return gaps;
}
