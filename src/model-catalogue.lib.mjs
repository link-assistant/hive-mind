/**
 * The live model catalogue: hot load, cache, and merge (issue #2202, R2/R8/R9).
 *
 * R2 asks for "an experimental mechanism that will try to get real time data
 * about models", R8 for the technical details behind each one, and R9 for that
 * data to be "cached for at least 1 hour, so we don't request that data from bot
 * too much". This module is those three sentences:
 *
 * - **Hot load.** Every applicable source from ./model-catalogue-sources.lib.mjs
 *   is read in rank order through ./model-catalogue-fetch.lib.mjs. A source that
 *   does not apply is `skipped`, not an error — a host with no `OPENAI_API_KEY`
 *   is a normal host.
 * - **Cache.** One JSON file in the bot state directory, keyed by source *and*
 *   tool, written atomically under the same `withStateLock` primitive the other
 *   background maintainers use, so two `/models` calls cannot interleave a write.
 *   The TTL can only be raised (see `resolveModelCatalogueTtlMs`).
 * - **Merge.** The bundled catalogue and the live one are joined into three
 *   groups — in both, live only, bundled only — which is exactly what R5 asks
 *   `/models` to show: "from fully supported, to hot loaded".
 *
 * Nothing here can spend tokens: the sources module refuses to describe a
 * billable source and the fetch module refuses to open a billable URL.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2202
 */

import fs from 'node:fs';
import path from 'node:path';

import { fetchAnthropicCatalogue, fetchCodexCliCatalogue, fetchModelsDevMetadata, fetchOpenAiCatalogue, fetchRouterCatalogue } from './model-catalogue-fetch.lib.mjs';
import { listModelCatalogueSourcesForTool, resolveModelCatalogueTtlMs } from './model-catalogue-sources.lib.mjs';
import { agentModels, claudeModels, CODEX_MODEL_VARIANTS, defaultModels, geminiModels, opencodeModels, qwenModels } from './models/catalog.mjs';
import { resolveRouterBaseUrl, resolveRouterDialect } from './router-isolation.lib.mjs';
import { acquireRouterSidecar, releaseRouterSidecar } from './router-sidecar.lib.mjs';
import { resolveBotStateDir } from './session-store.lib.mjs';
import { withStateLock } from './state-lock.lib.mjs';

const CACHE_FILE_NAME = 'model-catalogue-cache.json';
const CACHE_LOCK_NAME = 'model-catalogue';
const CACHE_VERSION = 1;

/** Tools this catalogue can describe, in the order `/models --all` prints them. */
export const MODEL_CATALOGUE_TOOLS = Object.freeze(['claude', 'codex', 'agent', 'opencode', 'qwen', 'gemini']);

/** The bundled alias map for a tool — the leaf catalogue, without the mapping layer. */
export const getBundledModelMap = tool => {
  switch (String(tool || '').toLowerCase()) {
    case 'agent':
      return agentModels;
    case 'opencode':
      return opencodeModels;
    case 'codex':
      return CODEX_MODEL_VARIANTS;
    case 'qwen':
      return qwenModels;
    case 'gemini':
      return geminiModels;
    default:
      return claudeModels;
  }
};

/**
 * The distinct model ids a tool ships with.
 *
 * The alias maps are many-to-one — `opus`, `opus-5` and `claude-opus-5` all
 * resolve to one model — so the resolved values are what a live catalogue can be
 * compared against; the aliases are a presentation detail.
 */
export const listBundledModelIds = tool => [...new Set(Object.values(getBundledModelMap(tool)))].sort();

/** Aliases that resolve to one bundled model id, so `/models` can show them. */
export const listBundledAliasesFor = (tool, modelId) =>
  Object.entries(getBundledModelMap(tool))
    .filter(([alias, resolved]) => resolved === modelId && alias !== modelId)
    .map(([alias]) => alias)
    .sort();

/**
 * Whether the live sources may be contacted.
 *
 * R2 calls this "experimental", so it is switchable — but it defaults *on* for
 * an explicit `/models` call, because a user asking what models exist has asked
 * for the network call by asking the question. Setting
 * `HIVE_MIND_MODELS_HOT_LOAD=0` turns every live source into a `skipped` one and
 * leaves the bundled catalogue, which always answers.
 */
export const isModelHotLoadEnabled = (env = process.env) => !/^(0|false|off|no)$/i.test(String(env?.HIVE_MIND_MODELS_HOT_LOAD ?? '').trim());

/**
 * Whether `/models` may take a router lease.
 *
 * Separate from the hot-load switch because it is the one source that costs
 * more than an HTTP request: it can start a container. `HIVE_MIND_MODELS_ROUTER=0`
 * keeps every other live source and drops just this one.
 */
export const isRouterCatalogueEnabled = (env = process.env) => !/^(0|false|off|no)$/i.test(String(env?.HIVE_MIND_MODELS_ROUTER ?? '').trim());

export const resolveModelCatalogueCachePath = (env = process.env) => path.join(resolveBotStateDir(env), CACHE_FILE_NAME);

/** Read the cache. A missing or corrupt file is an empty cache, never a throw. */
export const readModelCatalogueCache = ({ env = process.env, fsImpl = fs } = {}) => {
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(resolveModelCatalogueCachePath(env), 'utf8'));
    if (parsed?.version !== CACHE_VERSION) return { version: CACHE_VERSION, entries: {} };
    return { version: CACHE_VERSION, entries: {}, ...parsed };
  } catch {
    return { version: CACHE_VERSION, entries: {} };
  }
};

/** Persist the cache atomically: write a sibling `.tmp`, then rename over it. */
export const writeModelCatalogueCache = (cache, { env = process.env, fsImpl = fs } = {}) => {
  const target = resolveModelCatalogueCachePath(env);
  fsImpl.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  fsImpl.writeFileSync(temporary, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  fsImpl.renameSync(temporary, target);
  return cache;
};

/** Cache key. One entry per source *and* tool: the answers differ per tool. */
export const modelCatalogueCacheKey = (sourceId, tool) => `${sourceId}:${String(tool || 'all').toLowerCase()}`;

/** Age of a cache entry in milliseconds, or null when it has no timestamp. */
export const modelCatalogueEntryAgeMs = (entry, now = Date.now()) => {
  const fetchedAt = Date.parse(entry?.fetchedAt ?? '');
  return Number.isFinite(fetchedAt) ? Math.max(0, now - fetchedAt) : null;
};

/** True when an entry is younger than the TTL. */
export const isModelCatalogueEntryFresh = (entry, { ttlMs = null, env = process.env, now = Date.now() } = {}) => {
  const age = modelCatalogueEntryAgeMs(entry, now);
  if (age === null) return false;
  return age < (ttlMs ?? resolveModelCatalogueTtlMs(env));
};

/**
 * Call one source, honouring the cache.
 *
 * Read-through with one deliberate asymmetry: a *failed* live read does not
 * overwrite a good cached answer. The router does the same thing internally
 * ("last known catalog retained"), and for the same reason — a provider blip
 * should not turn into an empty model list in front of a user.
 */
const loadOneSource = async (source, { tool, env, cache, refresh, now, fetchers, routerContext }) => {
  const key = modelCatalogueCacheKey(source.id, tool);
  const cached = cache.entries?.[key] ?? null;
  const fresh = !refresh && isModelCatalogueEntryFresh(cached, { env, now });
  if (fresh && cached?.status === 'ok') {
    return { ...cached, id: source.id, label: source.label, kind: source.kind, cached: true, ageMs: modelCatalogueEntryAgeMs(cached, now) };
  }

  const fetcher = fetchers[source.id];
  const result = fetcher ? await fetcher({ tool, env, routerContext }) : { status: 'skipped', models: [], meta: {}, error: 'no reader for this source' };

  if (result.status !== 'ok' && cached?.status === 'ok') {
    return { ...cached, id: source.id, label: source.label, kind: source.kind, cached: true, stale: true, ageMs: modelCatalogueEntryAgeMs(cached, now), error: result.error ?? null };
  }

  const entry = { fetchedAt: new Date(now).toISOString(), status: result.status, models: result.models ?? [], meta: result.meta ?? {}, error: result.error ?? null };
  if (result.status === 'ok') cache.entries[key] = entry;
  return { ...entry, id: source.id, label: source.label, kind: source.kind, cached: false, ageMs: 0 };
};

/**
 * Open a router session for a catalogue read, and hand back how to close it.
 *
 * R3 asks that the router be "initialized, mapped, and mounted with claude and
 * codex credential files/folders" before its API is used, and that is precisely
 * `acquireRouterSidecar`: it creates the network and volume, starts the pinned
 * image with every credential directory that exists on this host mounted into
 * it, waits for health, and mints a token. So `/models` takes a lease exactly
 * like a task does rather than reimplementing any of it.
 *
 * The lease is real and is released in `finally`: when another task is already
 * holding the sidecar up the acquire reuses the running container and the
 * release leaves it running; when nothing else is, `/models` starts it and
 * stops it again. Because the answer is cached for an hour (R9), that happens
 * at most once an hour rather than once per question.
 *
 * An operator-run router (`HIVE_MIND_ROUTER_URL`) is not ours to start:
 * `acquireRouterSidecar` returns the configured URL and the operator's token
 * without touching Docker, and `close()` is then a no-op.
 */
export const openRouterCatalogueSession = async ({ env = process.env, run = undefined, acquire = acquireRouterSidecar, release = releaseRouterSidecar, log = null, sessionId = null } = {}) => {
  const closed = { available: false, close: async () => {} };
  if (!isRouterCatalogueEnabled(env)) return { ...closed, reason: 'router catalogue reads are disabled (HIVE_MIND_MODELS_ROUTER=0)' };

  const endpoint = resolveRouterBaseUrl({ env });
  if (endpoint.error) return { ...closed, reason: endpoint.error };

  const id = sessionId || `models-${process.pid}-${Date.now()}`;
  let lease;
  try {
    lease = await acquire({ sessionId: id, env, log, ...(run ? { run } : {}) });
  } catch (error) {
    // Docker missing, daemon down, image unpullable: a host without a router is
    // a normal host, so this is a skipped source and not a failed command.
    return { ...closed, reason: String(error?.message ?? error) };
  }
  if (lease?.error || !lease?.token) return { ...closed, reason: lease?.error || 'router issued no token' };

  const { dialect } = resolveRouterDialect({ env });
  return {
    available: true,
    baseUrl: lease.baseUrl,
    token: lease.token,
    dialect,
    external: Boolean(lease.external),
    // The sidecar publishes no host port (see `buildRouterSidecarRunArgs`), so
    // its catalogue is read from inside the container; an external router is on
    // the network and is read over it.
    transport: lease.external ? 'http' : 'exec',
    close: async () => {
      if (lease.external) return;
      try {
        await release({ sessionId: id, env, log, ...(run ? { run } : {}) });
      } catch {
        // The lease expires with its token either way; a failed release must
        // never turn a successful catalogue read into a failed command.
      }
    },
  };
};

/** The default readers, one per source id, with their arguments already bound. */
export const buildDefaultCatalogueFetchers = ({ fetchImpl = globalThis.fetch, run = undefined } = {}) => ({
  router: async ({ tool, routerContext }) => {
    if (!routerContext?.available) return { status: 'skipped', models: [], meta: {}, error: routerContext?.reason ?? 'router unavailable' };
    return fetchRouterCatalogue({ baseUrl: routerContext.baseUrl, dialect: routerContext.dialect, token: routerContext.token, transport: routerContext.transport, tool, fetchImpl, ...(run ? { run } : {}) });
  },
  'codex-cli': async () => fetchCodexCliCatalogue(run ? { run } : {}),
  'anthropic-api': async ({ env }) => fetchAnthropicCatalogue({ env, fetchImpl }),
  'openai-api': async ({ env }) => fetchOpenAiCatalogue({ env, fetchImpl }),
  'models-dev': async () => fetchModelsDevMetadata({ fetchImpl }),
  bundled: async ({ tool }) => ({ status: 'ok', models: listBundledModelIds(tool).map(id => ({ id, label: null })), meta: { default: defaultModels[String(tool || 'claude').toLowerCase()] ?? null }, error: null }),
});

/**
 * Hot-load every source that can speak about `tool`.
 *
 * The router lease is opened lazily and only when the router source is actually
 * going to be read: with a fresh cache entry the answer is already on disk, and
 * starting a container to re-derive it would defeat the point of R9's cache.
 *
 * @returns {Promise<{tool: string, ttlMs: number, hotLoad: boolean, sources: object[], metadata: object, router: object}>}
 */
export const loadModelCatalogue = async ({ tool = 'claude', env = process.env, fsImpl = fs, refresh = false, now = Date.now(), fetchImpl = globalThis.fetch, run = undefined, fetchers = null, openRouter = openRouterCatalogueSession, log = null, lockOptions = {} } = {}) => {
  const toolName = String(tool || 'claude').toLowerCase();
  const hotLoad = isModelHotLoadEnabled(env);
  const readers = fetchers ?? buildDefaultCatalogueFetchers({ fetchImpl, run });
  const applicable = listModelCatalogueSourcesForTool(toolName).filter(source => hotLoad || source.kind === 'bundled');

  return withStateLock(
    CACHE_LOCK_NAME,
    async () => {
      const cache = readModelCatalogueCache({ env, fsImpl });
      cache.entries = cache.entries ?? {};

      let routerSession = { available: false, reason: hotLoad ? 'router was not needed' : 'hot load is disabled' };
      const routerEntry = cache.entries[modelCatalogueCacheKey('router', toolName)];
      const routerIsFresh = !refresh && routerEntry?.status === 'ok' && isModelCatalogueEntryFresh(routerEntry, { env, now });
      if (hotLoad && !routerIsFresh && applicable.some(source => source.id === 'router')) {
        routerSession = await openRouter({ env, run, log });
      }

      const sources = [];
      try {
        for (const source of applicable) {
          try {
            sources.push(await loadOneSource(source, { tool: toolName, env, cache, refresh, now, fetchers: readers, routerContext: routerSession }));
          } catch (error) {
            // A reader that throws is a bug in that reader, not a reason to
            // return nothing: the remaining sources — including `bundled`, which
            // cannot fail — still answer.
            sources.push({ id: source.id, label: source.label, kind: source.kind, status: 'error', models: [], meta: {}, error: String(error?.message ?? error), cached: false, ageMs: 0 });
          }
        }
      } finally {
        if (routerSession.available) await routerSession.close();
      }

      try {
        writeModelCatalogueCache(cache, { env, fsImpl });
      } catch {
        // A read-only state directory degrades to "no cache", not to no answer.
      }
      const metadata = sources.find(source => source.id === 'models-dev')?.meta?.metadata ?? {};
      return { tool: toolName, ttlMs: resolveModelCatalogueTtlMs(env), hotLoad, sources, metadata, router: { available: routerSession.available, reason: routerSession.reason ?? null, external: routerSession.external ?? false, transport: routerSession.transport ?? null } };
    },
    { env, ...lockOptions }
  );
};

/**
 * Join the bundled catalogue with what the live sources reported.
 *
 * The three groups are R5's "from fully supported, to hot loaded":
 *
 * - **bundledAndLive** — shipped with this installation *and* reachable now.
 *   These are the ones `--model` accepts and that will work.
 * - **liveOnly** — a provider or the router knows them, this installation does
 *   not. This is the group the issue is about: a new model appears here the day
 *   it ships, without a release.
 * - **bundledOnly** — shipped, but no live source confirmed them. Either no live
 *   source could be reached, or the model is retired.
 */
export const mergeModelCatalogue = ({ tool = 'claude', catalogue = null, metadata = null } = {}) => {
  const toolName = String(tool || 'claude').toLowerCase();
  const bundled = listBundledModelIds(toolName);
  const bundledSet = new Set(bundled);
  const specs = metadata ?? catalogue?.metadata ?? {};

  /** id -> the live sources that reported it, in rank order. */
  const liveById = new Map();
  for (const source of catalogue?.sources ?? []) {
    if (source.kind !== 'live' || source.status !== 'ok') continue;
    for (const model of source.models ?? []) {
      if (!model?.id) continue;
      const existing = liveById.get(model.id) ?? { id: model.id, label: model.label ?? null, sources: [], services: [] };
      existing.label = existing.label ?? model.label ?? null;
      if (!existing.sources.includes(source.id)) existing.sources.push(source.id);
      if (model.service && !existing.services.includes(model.service)) existing.services.push(model.service);
      liveById.set(model.id, existing);
    }
  }

  const describe = (id, live) => ({
    id,
    label: live?.label ?? null,
    aliases: bundledSet.has(id) ? listBundledAliasesFor(toolName, id) : [],
    sources: live?.sources ?? [],
    services: live?.services ?? [],
    // R8: the specification, from models.dev when no first-party source carried
    // it. Looked up bare and by last path segment, because `opencode/grok-code`
    // is one model with a routing prefix.
    spec: specs?.[id] ?? specs?.[id.includes('/') ? id.split('/').pop() : id] ?? null,
  });

  const bundledAndLive = [];
  const bundledOnly = [];
  for (const id of bundled) {
    const live = liveById.get(id);
    (live ? bundledAndLive : bundledOnly).push(describe(id, live));
  }
  const liveOnly = [...liveById.keys()]
    .filter(id => !bundledSet.has(id))
    .sort()
    .map(id => describe(id, liveById.get(id)));

  return {
    tool: toolName,
    default: defaultModels[toolName] ?? null,
    bundledAndLive,
    liveOnly,
    bundledOnly,
    counts: { bundled: bundled.length, live: liveById.size, bundledAndLive: bundledAndLive.length, liveOnly: liveOnly.length, bundledOnly: bundledOnly.length },
  };
};

/** Hot-load and merge in one call — what `/models` and `hive-models` use. */
export const getMergedModelCatalogue = async (options = {}) => {
  const catalogue = await loadModelCatalogue(options);
  return { ...mergeModelCatalogue({ tool: catalogue.tool, catalogue }), catalogue };
};

export default {
  MODEL_CATALOGUE_TOOLS,
  buildDefaultCatalogueFetchers,
  getBundledModelMap,
  getMergedModelCatalogue,
  isModelCatalogueEntryFresh,
  isModelHotLoadEnabled,
  listBundledAliasesFor,
  listBundledModelIds,
  loadModelCatalogue,
  mergeModelCatalogue,
  modelCatalogueCacheKey,
  modelCatalogueEntryAgeMs,
  readModelCatalogueCache,
  resolveModelCatalogueCachePath,
  openRouterCatalogueSession,
  writeModelCatalogueCache,
};
