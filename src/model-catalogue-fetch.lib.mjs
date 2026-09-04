/**
 * The token-free readers behind the live model catalogue (issue #2202, R2/R7/R8).
 *
 * One function per source in `MODEL_CATALOGUE_SOURCES`, each returning the same
 * envelope so the orchestrator in ./model-catalogue.lib.mjs never has to know
 * which one it called:
 *
 *   { status, models: [{ id, label, … }], meta: {}, error: string|null }
 *
 * `status` is `ok`, `skipped` (the source does not apply here — no credential,
 * no router, no binary) or `error` (it applied and failed). The distinction
 * matters to the caller: `skipped` is normal, `error` is worth showing.
 *
 * Every network call goes through `assertTokenFreeUrl`, so a URL that would run
 * a model throws before a socket is opened rather than after a bill is incurred.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2202
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { assertTokenFreeUrl } from './model-catalogue-sources.lib.mjs';
import { ROUTER_SIDECAR_CONTAINER_NAME, ROUTER_SIDECAR_PORT } from './router-isolation.lib.mjs';
import { buildRouterCatalogueEndpoints, ROUTER_TOOL_SERVICE } from './router-routes.lib.mjs';

const execFileAsync = promisify(execFile);

export const DEFAULT_CATALOGUE_TIMEOUT_MS = 20_000;

const ok = (models, meta = {}) => ({ status: 'ok', models, meta, error: null });
const skipped = reason => ({ status: 'skipped', models: [], meta: {}, error: reason });
const failed = error => ({ status: 'error', models: [], meta: {}, error: String(error?.message ?? error) });

/**
 * Reduce a provider's listing response to `{ id, label, … }` records.
 *
 * The shapes differ enough that sniffing them at the merge would be guesswork,
 * so the shape is declared by the caller — for the router it comes from the
 * route table, which already records one per catalogue endpoint.
 */
export const normalizeCataloguePayload = ({ shape, payload } = {}) => {
  if (!payload || typeof payload !== 'object') return [];
  if (shape === 'gemini') {
    const entries = Array.isArray(payload.models) ? payload.models : [];
    return entries
      .map(entry => ({
        id: String(entry?.name ?? '').replace(/^models\//, ''),
        label: entry?.displayName ?? null,
        contextWindow: entry?.inputTokenLimit ?? null,
        maxOutput: entry?.outputTokenLimit ?? null,
      }))
      .filter(entry => entry.id);
  }
  if (shape === 'codex-cli') {
    const entries = Array.isArray(payload.models) ? payload.models : [];
    return entries
      .map(entry => ({
        id: String(entry?.slug ?? ''),
        label: entry?.display_name ?? null,
        visibility: entry?.visibility ?? null,
        supportedInApi: entry?.supported_in_api ?? null,
      }))
      .filter(entry => entry.id);
  }
  // `anthropic` and `openai` both answer `{ data: [ { id, … } ] }`; they differ
  // only in the optional fields, which are carried through as-is.
  const entries = Array.isArray(payload.data) ? payload.data : [];
  return entries
    .map(entry => ({
      id: String(entry?.id ?? ''),
      label: entry?.display_name ?? null,
      createdAt: entry?.created_at ?? (typeof entry?.created === 'number' ? new Date(entry.created * 1000).toISOString() : null),
      ownedBy: entry?.owned_by ?? null,
    }))
    .filter(entry => entry.id);
};

/**
 * The router's own health signal, carried alongside the models.
 *
 * The router's listing response is a superset of OpenAI's: it adds
 * `using_fallback`, `degraded_providers`, `degraded_reasons` and
 * `healthy_providers`. That is exactly what R5 asks `/models` to surface — "we
 * should see which models are loaded live" — so it is preserved rather than
 * normalised away.
 */
export const extractRouterCatalogueMeta = payload => ({
  usingFallback: payload?.using_fallback ?? null,
  degradedProviders: Array.isArray(payload?.degraded_providers) ? payload.degraded_providers : [],
  degradedReasons: payload?.degraded_reasons ?? null,
  healthyProviders: Array.isArray(payload?.healthy_providers) ? payload.healthy_providers : [],
});

/**
 * Fetch a JSON document with the billable-URL guard in front of it.
 *
 * `fetchImpl` is injected rather than closed over so tests can drive every
 * branch without a network, following the pattern the rest of the repository
 * already uses.
 */
export const fetchJsonCatalogue = async (url, { sourceId = 'unknown', headers = {}, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_CATALOGUE_TIMEOUT_MS } = {}) => {
  assertTokenFreeUrl(url, sourceId);
  if (typeof fetchImpl !== 'function') throw new Error('No fetch implementation available');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(url, { headers, signal: controller?.signal });
    if (!response?.ok) throw new Error(`HTTP ${response?.status ?? '?'} from ${url}`);
    return await response.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * Read the router's live catalogue.
 *
 * Two paths, because the sidecar Hive Mind starts publishes no port (see the
 * `No -p` note in src/router-sidecar.lib.mjs): an operator-run router is fetched
 * over the network, while the local sidecar is read from *inside* the container
 * with `bun`, the same client `checkRouterSidecarHealth` uses for the same
 * reason — the router's image ships no curl.
 *
 * A token is required either way. For the sidecar the caller supplies one it
 * already leased, so `/models` mints nothing on its own.
 */
export const fetchRouterCatalogue = async ({ baseUrl, dialect, token = null, tool = null, containerName = ROUTER_SIDECAR_CONTAINER_NAME, transport = 'exec', fetchImpl = globalThis.fetch, run = execFileAsync, timeoutMs = DEFAULT_CATALOGUE_TIMEOUT_MS } = {}) => {
  if (!baseUrl || !dialect) return skipped('router is not configured');
  const endpoints = buildRouterCatalogueEndpoints({ baseUrl, dialect });
  if (endpoints.length === 0) return skipped('this router dialect exposes no catalogue route');
  if (!token) return skipped('no router token available');

  // On the canonical dialect there is one catalogue per service, so asking about
  // one tool should not fan out across all five. On the legacy dialect the single
  // `/v1/models` already answers for every adopted provider, and the filter falls
  // through to it because no entry matches the tool's service name.
  const service = tool ? ROUTER_TOOL_SERVICE[String(tool).toLowerCase()] : null;
  const wanted = service ? endpoints.filter(endpoint => endpoint.service === service) : [];
  const selected = wanted.length > 0 ? wanted : endpoints;

  const models = [];
  const meta = { endpoints: [], usingFallback: null, degradedProviders: [], healthyProviders: [] };
  const errors = [];
  for (const endpoint of selected) {
    assertTokenFreeUrl(endpoint.url, 'router');
    try {
      const payload = transport === 'http' ? await fetchJsonCatalogue(endpoint.url, { sourceId: 'router', headers: { Authorization: `Bearer ${token}` }, fetchImpl, timeoutMs }) : await fetchRouterCatalogueViaExec({ url: endpoint.url, token, containerName, run, timeoutMs });
      const entries = normalizeCataloguePayload({ shape: endpoint.shape, payload });
      for (const entry of entries) models.push({ ...entry, service: endpoint.service });
      const endpointMeta = extractRouterCatalogueMeta(payload);
      meta.endpoints.push({ service: endpoint.service, url: endpoint.url, count: entries.length, ...endpointMeta });
      if (endpointMeta.usingFallback) meta.usingFallback = true;
      meta.degradedProviders.push(...endpointMeta.degradedProviders);
      meta.healthyProviders.push(...endpointMeta.healthyProviders);
    } catch (error) {
      errors.push(`${endpoint.service}: ${error?.message ?? error}`);
    }
  }

  if (models.length === 0 && errors.length > 0) return failed(errors.join('; '));
  meta.degradedProviders = [...new Set(meta.degradedProviders)];
  meta.healthyProviders = [...new Set(meta.healthyProviders)];
  if (errors.length > 0) meta.partialErrors = errors;
  return ok(models, meta);
};

/**
 * Read one catalogue endpoint from inside the sidecar.
 *
 * TLS verification is disabled for this call for the same reason the health
 * probe disables it: the certificate names the network alias, the request is a
 * loopback socket inside the container, and there is no network for anyone to
 * sit in the middle of. The alternative — shipping the CA back into an image
 * Hive Mind does not own — buys nothing here.
 */
export const fetchRouterCatalogueViaExec = async ({ url, token, containerName = ROUTER_SIDECAR_CONTAINER_NAME, run = execFileAsync, timeoutMs = DEFAULT_CATALOGUE_TIMEOUT_MS } = {}) => {
  assertTokenFreeUrl(url, 'router');
  // The container reaches itself on loopback; the authority in `url` is the
  // alias, which does not resolve from inside.
  const loopback = String(url).replace(/^https?:\/\/[^/]+/, `https://127.0.0.1:${ROUTER_SIDECAR_PORT}`);
  assertTokenFreeUrl(loopback, 'router');
  const script = `fetch(${JSON.stringify(loopback)},{headers:{Authorization:"Bearer "+process.env.ROUTER_CATALOGUE_TOKEN}}).then(r=>r.ok?r.text():Promise.reject(new Error("HTTP "+r.status))).then(t=>{process.stdout.write(t)}).catch(e=>{process.stderr.write(String(e&&e.message||e));process.exit(1)})`;
  const { stdout } = await run('docker', ['exec', '--env', 'NODE_TLS_REJECT_UNAUTHORIZED=0', '--env', `ROUTER_CATALOGUE_TOKEN=${token}`, containerName, 'bun', '-e', script], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout);
};

/**
 * Read the installed Codex CLI's compiled catalogue.
 *
 * No network, no account, no cost — the binary answers from what it was built
 * with, which is also precisely the set it will accept as `--model`.
 */
export const fetchCodexCliCatalogue = async ({ run = execFileAsync, timeoutMs = DEFAULT_CATALOGUE_TIMEOUT_MS, binary = 'codex' } = {}) => {
  try {
    const { stdout } = await run(binary, ['debug', 'models'], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 });
    const payload = JSON.parse(stdout);
    return ok(normalizeCataloguePayload({ shape: 'codex-cli', payload }), { binary });
  } catch (error) {
    if (error?.code === 'ENOENT') return skipped('codex CLI is not installed');
    return failed(error);
  }
};

/** Anthropic's listing endpoint, paginated with `after_id` and never metered. */
export const fetchAnthropicCatalogue = async ({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_CATALOGUE_TIMEOUT_MS, baseUrl = 'https://api.anthropic.com', maxPages = 5 } = {}) => {
  const apiKey = String(env?.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) return skipped('ANTHROPIC_API_KEY is not set');
  const headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
  const models = [];
  let afterId = null;
  try {
    for (let page = 0; page < maxPages; page += 1) {
      const url = `${baseUrl.replace(/\/$/, '')}/v1/models?limit=100${afterId ? `&after_id=${encodeURIComponent(afterId)}` : ''}`;
      const payload = await fetchJsonCatalogue(url, { sourceId: 'anthropic-api', headers, fetchImpl, timeoutMs });
      models.push(...normalizeCataloguePayload({ shape: 'anthropic', payload }));
      if (!payload?.has_more || !payload?.last_id) break;
      afterId = payload.last_id;
    }
    return ok(models, { baseUrl });
  } catch (error) {
    return failed(error);
  }
};

/** OpenAI's listing endpoint. Same reasoning as Anthropic's, single page. */
export const fetchOpenAiCatalogue = async ({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_CATALOGUE_TIMEOUT_MS, baseUrl = 'https://api.openai.com' } = {}) => {
  const apiKey = String(env?.OPENAI_API_KEY || '').trim();
  if (!apiKey) return skipped('OPENAI_API_KEY is not set');
  try {
    const payload = await fetchJsonCatalogue(`${baseUrl.replace(/\/$/, '')}/v1/models`, { sourceId: 'openai-api', headers: { Authorization: `Bearer ${apiKey}` }, fetchImpl, timeoutMs });
    return ok(normalizeCataloguePayload({ shape: 'openai', payload }), { baseUrl });
  } catch (error) {
    return failed(error);
  }
};

/**
 * models.dev, the R8 fallback — metadata only.
 *
 * Returned as a flat map from bare model id to specification, so the merge can
 * annotate a model without models.dev ever being able to claim one is available:
 * it aggregates published specifications and knows nothing about this account.
 */
export const fetchModelsDevMetadata = async ({ fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_CATALOGUE_TIMEOUT_MS, url = 'https://models.dev/api.json' } = {}) => {
  try {
    const payload = await fetchJsonCatalogue(url, { sourceId: 'models-dev', fetchImpl, timeoutMs });
    const metadata = {};
    for (const provider of Object.values(payload ?? {})) {
      for (const [modelId, model] of Object.entries(provider?.models ?? {})) {
        // First provider wins: the same id under two providers describes the
        // same model, and the extra copies only differ in pricing presentation.
        if (!metadata[modelId]) metadata[modelId] = { ...model, provider: provider?.name ?? provider?.id ?? null };
      }
    }
    return ok([], { metadata, providerCount: Object.keys(payload ?? {}).length });
  } catch (error) {
    return failed(error);
  }
};

export default {
  DEFAULT_CATALOGUE_TIMEOUT_MS,
  extractRouterCatalogueMeta,
  fetchAnthropicCatalogue,
  fetchCodexCliCatalogue,
  fetchJsonCatalogue,
  fetchModelsDevMetadata,
  fetchOpenAiCatalogue,
  fetchRouterCatalogue,
  fetchRouterCatalogueViaExec,
  normalizeCataloguePayload,
};
