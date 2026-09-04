#!/usr/bin/env node
/**
 * Regression test for issue #2202 — the live model catalogue.
 *
 * Four requirements meet in this suite:
 *
 * - **R2** — a mechanism that gets real-time data about models. Exercised end to
 *   end with injected readers, so the merge and the cache are tested without a
 *   network or a Docker daemon.
 * - **R7** — "models extraction should never trigger any tokens expense,
 *   otherwise such methods must be excluded from our codebase". This is the part
 *   that cannot be tested by observing a passing run: an expensive call succeeds
 *   too. So it is tested structurally — every declared source is non-billable,
 *   every completion-shaped URL is refused before a socket opens, and the two
 *   TUI-driven approaches are recorded as rejected with their reason.
 * - **R9** — "cached for at least 1 hour". The TTL floor is a floor: an operator
 *   can raise it, and an attempt to lower it is ignored rather than honoured.
 * - **R5** — the three groups `/models` prints: bundled and live, live only,
 *   bundled only.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2202
 */

import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import { assertTokenFreeSource, assertTokenFreeUrl, BILLABLE_PATH_PATTERNS, isBillableCatalogueUrl, listModelCatalogueSourcesForTool, MODEL_CATALOGUE_SOURCES, MODEL_CATALOGUE_TTL_MS, REJECTED_EXTRACTION_METHODS, resolveModelCatalogueTtlMs } from '../src/model-catalogue-sources.lib.mjs';
import { fetchCodexCliCatalogue, fetchJsonCatalogue, fetchModelsDevMetadata, fetchRouterCatalogue, normalizeCataloguePayload } from '../src/model-catalogue-fetch.lib.mjs';
import { getMergedModelCatalogue, isModelCatalogueEntryFresh, isModelHotLoadEnabled, isRouterCatalogueEnabled, listBundledModelIds, loadModelCatalogue, mergeModelCatalogue, modelCatalogueCacheKey, readModelCatalogueCache } from '../src/model-catalogue.lib.mjs';
import { ROUTER_ROUTE_DIALECTS } from '../src/router-routes.lib.mjs';

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`  PASS: ${label}`);
    passed++;
  } catch (error) {
    console.error(`  FAIL: ${label}`);
    console.error(`     ${error?.message ?? error}`);
    failed++;
  }
}

async function checkAsync(label, fn) {
  try {
    await fn();
    console.log(`  PASS: ${label}`);
    passed++;
  } catch (error) {
    console.error(`  FAIL: ${label}`);
    console.error(`     ${error?.message ?? error}`);
    failed++;
  }
}

/** A scratch state directory, so the cache under test is never the real one. */
const makeEnv = extra => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-models-'));
  return { HOME: dir, HIVE_MIND_STATE_DIR: path.join(dir, 'state'), ...extra };
};

console.log('\n--- R7: no catalogue source can spend tokens ---');

check('every declared source is marked non-billable, and the assertion is what enforces it', () => {
  for (const source of MODEL_CATALOGUE_SOURCES) {
    assert.equal(source.billable, false, `${source.id} must declare billable:false`);
    assertTokenFreeSource(source);
  }
  assert.throws(() => assertTokenFreeSource({ id: 'invented', billable: true }), /billable/i);
});

check('completion-shaped URLs are refused before any request is made', () => {
  const billable = ['https://api.anthropic.com/v1/messages', 'https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1/responses', 'https://api.openai.com/v1/embeddings', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:generateContent', 'https://api.anthropic.com/v1/messages/batches'];
  for (const url of billable) {
    assert.equal(isBillableCatalogueUrl(url), true, `${url} should read as billable`);
    assert.throws(() => assertTokenFreeUrl(url, 'test'), /billable endpoint/i, `${url} should be refused`);
  }
});

check('listing URLs are allowed — including the ones whose path merely contains a billable word', () => {
  const free = ['https://api.anthropic.com/v1/models', 'https://api.openai.com/v1/models', 'https://generativelanguage.googleapis.com/v1beta/models', 'https://link-assistant-router/v1/models', 'https://link-assistant-router/api/services/openai/v1/models', 'https://models.dev/api.json'];
  for (const url of free) {
    assert.equal(isBillableCatalogueUrl(url), false, `${url} should read as free`);
    assert.doesNotThrow(() => assertTokenFreeUrl(url, 'test'));
  }
});

check('the guard matches the terminal path segment, not a substring anywhere in the URL', () => {
  // A listing endpoint that merely mentions a billable word in a query string
  // or a model id must not be blocked, or the guard would block the very calls
  // it exists to permit.
  assert.equal(isBillableCatalogueUrl('https://api.openai.com/v1/models?after=gpt-4-completions'), false);
  assert.equal(isBillableCatalogueUrl('https://api.anthropic.com/v1/models/claude-opus-5'), false);
  assert.equal(BILLABLE_PATH_PATTERNS.length > 0, true);
});

check('the fetch layer refuses a billable URL even when a caller passes one directly', async () => {
  // Not `await`ed on purpose: the throw happens synchronously inside the async
  // function, before `fetchImpl` is reached, and the rejection is asserted below.
  const never = () => {
    throw new Error('fetch must not be called');
  };
  return assert.rejects(fetchJsonCatalogue('https://api.anthropic.com/v1/messages', { fetchImpl: never }), /billable endpoint/i);
});

check('the TUI extraction methods are recorded as rejected, with a reason', () => {
  const ids = REJECTED_EXTRACTION_METHODS.map(method => method.id);
  for (const id of ['claude-tui-model-picker', 'codex-tui-model-picker', 'probe-completion-endpoint']) {
    assert.ok(ids.includes(id), `${id} should be listed as rejected`);
  }
  for (const method of REJECTED_EXTRACTION_METHODS) {
    assert.equal(typeof method.reason, 'string');
    assert.ok(method.reason.length > 0, `${method.id} must say why it was rejected`);
  }
});

console.log('\n--- R9: the catalogue is cached for at least an hour ---');

check('the default TTL is one hour', () => {
  assert.equal(MODEL_CATALOGUE_TTL_MS, 60 * 60 * 1000);
  assert.equal(resolveModelCatalogueTtlMs({}), 60 * 60 * 1000);
});

check('an operator can raise the TTL but not lower it below the floor', () => {
  assert.equal(resolveModelCatalogueTtlMs({ HIVE_MIND_MODEL_CATALOGUE_TTL_MINUTES: '360' }), 6 * 60 * 60 * 1000);
  assert.equal(resolveModelCatalogueTtlMs({ HIVE_MIND_MODEL_CATALOGUE_TTL_MINUTES: '5' }), MODEL_CATALOGUE_TTL_MS, 'five minutes would ask the providers far more often than the issue allows');
  assert.equal(resolveModelCatalogueTtlMs({ HIVE_MIND_MODEL_CATALOGUE_TTL_MINUTES: 'nonsense' }), MODEL_CATALOGUE_TTL_MS);
});

check('freshness is measured against that TTL', () => {
  const now = Date.parse('2026-09-04T12:00:00.000Z');
  const at = offsetMs => ({ fetchedAt: new Date(now - offsetMs).toISOString() });
  assert.equal(isModelCatalogueEntryFresh(at(59 * 60 * 1000), { env: {}, now }), true);
  assert.equal(isModelCatalogueEntryFresh(at(61 * 60 * 1000), { env: {}, now }), false);
  assert.equal(isModelCatalogueEntryFresh(null, { env: {}, now }), false);
  assert.equal(isModelCatalogueEntryFresh({ fetchedAt: 'not a date' }, { env: {}, now }), false);
});

console.log('\n--- Payload shapes from each provider normalise to one model list ---');

check('the Anthropic and OpenAI listing shapes', () => {
  const [anthropic] = normalizeCataloguePayload({ shape: 'anthropic', payload: { data: [{ id: 'claude-opus-5', display_name: 'Claude Opus 5', created_at: '2026-01-01T00:00:00Z' }], has_more: false } });
  assert.equal(anthropic.id, 'claude-opus-5');
  assert.equal(anthropic.label, 'Claude Opus 5');
  assert.equal(anthropic.createdAt, '2026-01-01T00:00:00Z');
  const [openai] = normalizeCataloguePayload({ shape: 'openai', payload: { object: 'list', data: [{ id: 'gpt-6-astra', owned_by: 'openai' }] } });
  assert.equal(openai.id, 'gpt-6-astra');
  assert.equal(openai.label, null, 'the OpenAI listing carries no display name');
  assert.equal(openai.ownedBy, 'openai');
});

check('the Gemini shape strips the `models/` prefix', () => {
  const [gemini] = normalizeCataloguePayload({ shape: 'gemini', payload: { models: [{ name: 'models/gemini-3-pro', displayName: 'Gemini 3 Pro', inputTokenLimit: 1000000 }] } });
  assert.equal(gemini.id, 'gemini-3-pro', 'the `models/` prefix is a resource name, not part of the id');
  assert.equal(gemini.label, 'Gemini 3 Pro');
  assert.equal(gemini.contextWindow, 1000000, 'R8: Gemini reports its own context window in the listing');
});

check('the codex CLI shape', () => {
  const [codex] = normalizeCataloguePayload({ shape: 'codex-cli', payload: { models: [{ slug: 'gpt-5.6-sol', display_name: 'GPT-5.6 Sol', visibility: 'public', supported_in_api: true }] } });
  assert.equal(codex.id, 'gpt-5.6-sol');
  assert.equal(codex.label, 'GPT-5.6 Sol');
  assert.equal(codex.supportedInApi, true);
});

check('an unrecognised payload is an empty list rather than a throw', () => {
  assert.deepEqual(normalizeCataloguePayload({ shape: 'openai', payload: null }), []);
  assert.deepEqual(normalizeCataloguePayload({}), []);
});

console.log('\n--- The router reader ---');

await checkAsync('it reads the legacy dialect through one root catalogue and keeps the degradation fields', async () => {
  const calls = [];
  const result = await fetchRouterCatalogue({
    baseUrl: 'https://link-assistant-router',
    dialect: ROUTER_ROUTE_DIALECTS.legacy,
    token: 'la_sk_test',
    tool: 'claude',
    transport: 'http',
    fetchImpl: async url => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({ object: 'list', data: [{ id: 'claude-opus-5' }, { id: 'gpt-6-astra' }], using_fallback: true, degraded_providers: ['openai'], healthy_providers: ['anthropic'] }) };
    },
  });
  assert.deepEqual(calls, ['https://link-assistant-router/v1/models']);
  assert.equal(result.status, 'ok');
  assert.deepEqual(
    result.models.map(model => model.id),
    ['claude-opus-5', 'gpt-6-astra']
  );
  assert.equal(result.meta.usingFallback, true);
  assert.deepEqual(result.meta.degradedProviders, ['openai']);
});

await checkAsync('on the canonical dialect it asks only the service that serves the tool', async () => {
  const calls = [];
  await fetchRouterCatalogue({
    baseUrl: 'https://router.example',
    dialect: ROUTER_ROUTE_DIALECTS.canonical,
    token: 'la_sk_test',
    tool: 'codex',
    transport: 'http',
    fetchImpl: async url => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    },
  });
  assert.equal(calls.length, 1, `expected one service catalogue, got ${JSON.stringify(calls)}`);
  assert.ok(calls[0].includes('/codex/'), calls[0]);
});

await checkAsync('with no token it is skipped rather than attempted', async () => {
  const result = await fetchRouterCatalogue({
    baseUrl: 'https://link-assistant-router',
    dialect: ROUTER_ROUTE_DIALECTS.legacy,
    token: null,
    fetchImpl: () => {
      throw new Error('must not fetch');
    },
  });
  assert.equal(result.status, 'skipped');
});

await checkAsync('an uninstalled codex CLI is a skipped source, not a failure', async () => {
  const result = await fetchCodexCliCatalogue({
    run: async () => {
      const error = new Error('spawn codex ENOENT');
      error.code = 'ENOENT';
      throw error;
    },
  });
  assert.equal(result.status, 'skipped');
});

await checkAsync('models.dev contributes metadata and never availability', async () => {
  const result = await fetchModelsDevMetadata({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ anthropic: { models: { 'claude-opus-5': { limit: { context: 200000 }, cost: { input: 5 } } } } }) }),
  });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.models, [], 'a metadata source must not add models to the available list');
  assert.equal(result.meta.metadata['claude-opus-5'].limit.context, 200000);
});

console.log('\n--- R5: the merge produces the three groups /models prints ---');

check('bundled and live, live only, bundled only', () => {
  const bundled = listBundledModelIds('claude');
  const [firstBundled] = bundled;
  const merged = mergeModelCatalogue({
    tool: 'claude',
    catalogue: {
      sources: [
        { id: 'router', kind: 'live', status: 'ok', models: [{ id: firstBundled, label: null }, { id: 'claude-fable-5.1' }] },
        { id: 'bundled', kind: 'bundled', status: 'ok', models: bundled.map(id => ({ id })) },
      ],
      metadata: { 'claude-fable-5.1': { limit: { context: 400000 } } },
    },
  });
  assert.ok(
    merged.bundledAndLive.some(model => model.id === firstBundled),
    'a model that is both shipped and live belongs in the first group'
  );
  assert.ok(
    merged.liveOnly.some(model => model.id === 'claude-fable-5.1'),
    'a model only the router knows is the hot-loaded group — this is what the issue asks for'
  );
  assert.equal(
    merged.bundledOnly.some(model => model.id === firstBundled),
    false
  );
  assert.equal(merged.counts.bundled, bundled.length);
  assert.equal(merged.liveOnly.find(model => model.id === 'claude-fable-5.1').spec.limit.context, 400000, 'R8: the metadata source annotates a hot-loaded model');
});

check('with no live source every bundled model lands in the bundled-only group', () => {
  const merged = mergeModelCatalogue({ tool: 'codex', catalogue: { sources: [] } });
  assert.equal(merged.liveOnly.length, 0);
  assert.equal(merged.bundledAndLive.length, 0);
  assert.equal(merged.bundledOnly.length, listBundledModelIds('codex').length);
});

check('aliases travel with the bundled model they resolve to', () => {
  const merged = mergeModelCatalogue({ tool: 'claude', catalogue: { sources: [] } });
  const withAliases = merged.bundledOnly.filter(model => model.aliases.length > 0);
  assert.ok(withAliases.length > 0, 'the bundled claude catalogue has aliases, so some model must carry them');
  for (const model of withAliases) assert.equal(model.aliases.includes(model.id), false, 'a model id is not its own alias');
});

console.log('\n--- The orchestrator: cache, degradation, and no surprise Docker ---');

await checkAsync('a live read is written to the cache and served from it on the next call', async () => {
  const env = makeEnv();
  let reads = 0;
  const fetchers = {
    router: async () => {
      reads += 1;
      return { status: 'ok', models: [{ id: 'gpt-6-astra' }], meta: {}, error: null };
    },
  };
  const openRouter = async () => ({ available: true, baseUrl: 'https://link-assistant-router', token: 'la_sk_test', transport: 'exec', close: async () => {} });
  const first = await loadModelCatalogue({ tool: 'claude', env, fetchers, openRouter });
  assert.equal(first.sources.find(source => source.id === 'router').status, 'ok');
  assert.equal(reads, 1);

  const cache = readModelCatalogueCache({ env });
  assert.ok(cache.entries[modelCatalogueCacheKey('router', 'claude')], 'the router entry should be on disk');

  const second = await loadModelCatalogue({ tool: 'claude', env, fetchers, openRouter });
  assert.equal(reads, 1, 'the second call within the TTL must not touch the network');
  assert.equal(second.sources.find(source => source.id === 'router').cached, true);
});

await checkAsync('--refresh bypasses the cache', async () => {
  const env = makeEnv();
  let reads = 0;
  const fetchers = {
    router: async () => {
      reads += 1;
      return { status: 'ok', models: [{ id: 'gpt-6-astra' }], meta: {}, error: null };
    },
  };
  const openRouter = async () => ({ available: true, close: async () => {} });
  await loadModelCatalogue({ tool: 'claude', env, fetchers, openRouter });
  await loadModelCatalogue({ tool: 'claude', env, fetchers, openRouter, refresh: true });
  assert.equal(reads, 2);
});

await checkAsync('a failed live read keeps the last good answer instead of emptying the list', async () => {
  const env = makeEnv();
  let attempt = 0;
  const fetchers = {
    router: async () => {
      attempt += 1;
      return attempt === 1 ? { status: 'ok', models: [{ id: 'gpt-6-astra' }], meta: {}, error: null } : { status: 'error', models: [], meta: {}, error: 'router unreachable' };
    },
  };
  const openRouter = async () => ({ available: true, close: async () => {} });
  await loadModelCatalogue({ tool: 'claude', env, fetchers, openRouter });
  const second = await loadModelCatalogue({ tool: 'claude', env, fetchers, openRouter, refresh: true });
  const router = second.sources.find(source => source.id === 'router');
  assert.equal(router.status, 'ok');
  assert.equal(router.stale, true, 'the answer is served but flagged as stale');
  assert.deepEqual(
    router.models.map(model => model.id),
    ['gpt-6-astra']
  );
  assert.equal(router.error, 'router unreachable', 'and the reason it could not be refreshed is kept');
});

await checkAsync('a reader that throws does not take the rest of the catalogue down', async () => {
  const env = makeEnv();
  const merged = await getMergedModelCatalogue({
    tool: 'claude',
    env,
    openRouter: async () => ({ available: true, close: async () => {} }),
    fetchers: {
      router: async () => {
        throw new Error('docker daemon is not running');
      },
    },
  });
  assert.equal(merged.catalogue.sources.find(source => source.id === 'router').status, 'error');
  assert.ok(merged.bundledOnly.length > 0, 'the bundled catalogue still answers');
});

await checkAsync('the router lease is not opened when the cached answer is still fresh', async () => {
  const env = makeEnv();
  let opened = 0;
  let released = 0;
  const openRouter = async () => {
    opened += 1;
    return {
      available: true,
      close: async () => {
        released += 1;
      },
    };
  };
  const fetchers = { router: async () => ({ status: 'ok', models: [{ id: 'gpt-6-astra' }], meta: {}, error: null }) };
  await loadModelCatalogue({ tool: 'claude', env, fetchers, openRouter });
  assert.equal(opened, 1);
  assert.equal(released, 1, 'the lease taken for a catalogue read is always released');
  await loadModelCatalogue({ tool: 'claude', env, fetchers, openRouter });
  assert.equal(opened, 1, 'a fresh cache must not start a container');
});

await checkAsync('the lease is released even when a reader throws', async () => {
  const env = makeEnv();
  let released = 0;
  await loadModelCatalogue({
    tool: 'claude',
    env,
    openRouter: async () => ({
      available: true,
      close: async () => {
        released += 1;
      },
    }),
    fetchers: {
      router: async () => {
        throw new Error('boom');
      },
    },
  });
  assert.equal(released, 1);
});

await checkAsync('hot load can be switched off, and then only the bundled source is consulted', async () => {
  const env = makeEnv({ HIVE_MIND_MODELS_HOT_LOAD: '0' });
  const catalogue = await loadModelCatalogue({
    tool: 'claude',
    env,
    openRouter: async () => {
      throw new Error('must not open a router session');
    },
    fetchers: {
      router: async () => {
        throw new Error('must not read the router');
      },
    },
  });
  assert.equal(catalogue.hotLoad, false);
  assert.deepEqual(
    catalogue.sources.map(source => source.id),
    ['bundled']
  );
});

check('the two switches are independent', () => {
  assert.equal(isModelHotLoadEnabled({}), true);
  assert.equal(isModelHotLoadEnabled({ HIVE_MIND_MODELS_HOT_LOAD: 'off' }), false);
  assert.equal(isRouterCatalogueEnabled({}), true);
  assert.equal(isRouterCatalogueEnabled({ HIVE_MIND_MODELS_ROUTER: '0' }), false);
});

check('each tool is offered only the sources that can speak about it', () => {
  assert.deepEqual(
    listModelCatalogueSourcesForTool('codex').map(source => source.id),
    ['router', 'codex-cli', 'openai-api', 'models-dev', 'bundled']
  );
  assert.deepEqual(
    listModelCatalogueSourcesForTool('claude').map(source => source.id),
    ['router', 'anthropic-api', 'models-dev', 'bundled']
  );
});

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
