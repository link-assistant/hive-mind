/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeCataloguePayload } from '../src/model-catalogue-fetch.lib.mjs';
import { loadModelCatalogue, mergeModelCatalogue, readModelCatalogueCache, writeModelCatalogueCache } from '../src/model-catalogue.lib.mjs';
import { getModelReasoningCapabilities } from '../src/model-reasoning.lib.mjs';
import { resolveRuntimeCodexReasoningEffort } from '../src/codex.reasoning.lib.mjs';
import { formatModelSpec } from '../src/model-catalogue-render.lib.mjs';

const payload = { models: [{ slug: 'future-coder', display_name: 'Future', default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }], context_window: 200000 }] };
const models = normalizeCataloguePayload({ shape: 'codex-cli', payload });
assert.deepEqual(models[0].supportedReasoningEfforts, ['low', 'medium']);
assert.equal(models[0].defaultReasoningEffort, 'medium');
assert.equal(models[0].contextWindow, 200000);
const documentedNone = normalizeCataloguePayload({ shape: 'codex-cli', payload: { models: [{ slug: 'gpt-6-sol', supported_reasoning_levels: [{ effort: 'low' }] }] } });
assert.deepEqual(documentedNone[0].supportedReasoningEfforts, ['none', 'low'], 'picker omissions must not disable documented API capabilities');
assert.deepEqual(normalizeCataloguePayload({ shape: 'openai', payload: { data: [{ id: 'future', supported_reasoning_efforts: ['auto', 'low'] }] } })[0].supportedReasoningEfforts, ['auto', 'low']);

const catalogue = { sources: [{ id: 'codex-cli', kind: 'live', status: 'ok', models }] };
const future = mergeModelCatalogue({ tool: 'codex', catalogue }).liveOnly.find(model => model.id === 'future-coder');
assert.deepEqual(future.supportedReasoningEfforts, ['low', 'medium']);
assert.match(formatModelSpec(future), /effort: low\/medium/);
assert.equal(getModelReasoningCapabilities('future-coder', catalogue).source, 'codex-cli');
const liveOverridesBundled = { sources: [{ id: 'router', status: 'ok', models: [{ id: 'gpt-6.1-sol', supportedReasoningEfforts: ['none', 'high'] }] }] };
assert.deepEqual(getModelReasoningCapabilities('gpt-6.1-sol', liveOverridesBundled).supportedReasoningEfforts, ['none', 'high']);
liveOverridesBundled.sources[0].stale = true;
assert.equal(getModelReasoningCapabilities('gpt-6.1-sol', liveOverridesBundled).source, 'bundled');

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-effort-2526-'));
const env = { HIVE_MIND_STATE_DIR: stateDir };
let reads = 0;
const fetchers = {
  'codex-cli': async () => {
    reads++;
    return { status: 'ok', models, meta: { binary: 'codex' } };
  },
};
const forbiddenRouter = async () => {
  throw new Error('Runtime must not start a router');
};
const now = Date.UTC(2026, 9, 5);
try {
  const settings = await resolveRuntimeCodexReasoningEffort({ model: 'future-coder', think: 'off' }, { env, fetchers, now, openRouter: forbiddenRouter });
  assert.equal(settings.reasoningEffort, 'low');
  assert.match(settings.source, /codex-cli/);
  assert.equal(reads, 1);
  const cached = await resolveRuntimeCodexReasoningEffort({ model: 'future-coder', think: 'max' }, { env, fetchers, now: now + 1000, openRouter: forbiddenRouter });
  assert.equal(cached.reasoningEffort, 'medium');
  assert.equal(reads, 1, 'fresh capabilities should be served from the shared cache');
  const stored = readModelCatalogueCache({ env });
  stored.entries['router:codex'] = { fetchedAt: new Date(now).toISOString(), status: 'ok', models: [{ id: 'future-coder', supportedReasoningEfforts: ['auto', 'high'] }] };
  writeModelCatalogueCache(stored, { env });
  const routed = await resolveRuntimeCodexReasoningEffort({ model: 'future-coder', think: 'off', useRouter: true }, { env, fetchers, now, openRouter: forbiddenRouter });
  assert.equal(routed.reasoningEffort, 'auto', 'routed tasks should honor cached gateway capabilities');
  const direct = await resolveRuntimeCodexReasoningEffort({ model: 'future-coder', think: 'off' }, { env, fetchers, now, openRouter: forbiddenRouter });
  assert.equal(direct.reasoningEffort, 'low', 'gateway restrictions must not affect direct tasks');
  let customReads = 0;
  const custom = await resolveRuntimeCodexReasoningEffort(
    { model: 'future-coder', think: 'off', codexPath: '/custom/codex' },
    {
      env,
      now,
      fetchers: {
        'codex-cli': async () => {
          customReads++;
          return { status: 'ok', models: [{ id: 'future-coder', supportedReasoningEfforts: ['high'] }], meta: { binary: '/custom/codex' } };
        },
      },
      openRouter: forbiddenRouter,
    }
  );
  assert.equal(custom.reasoningEffort, 'high');
  assert.equal(customReads, 1, 'custom binaries must not reuse another binary’s metadata');
  // Restore the ordinary binary cache before verifying stale/offline operation.
  await resolveRuntimeCodexReasoningEffort({ model: 'future-coder' }, { env, fetchers, now });
  const offlineCatalogue = await loadModelCatalogue({ tool: 'codex', env, sourceIds: ['codex-cli'], now: now + 7200000, fetchers: { 'codex-cli': async () => ({ status: 'error', error: 'offline' }) }, openRouter: forbiddenRouter });
  assert.equal(offlineCatalogue.sources[0].stale, true);
  assert.equal(getModelReasoningCapabilities('future-coder', offlineCatalogue).source, 'codex-cli (stale)');
  const disabled = await resolveRuntimeCodexReasoningEffort({ model: 'gpt-6.1-sol', think: 'off' }, { env: { ...env, HIVE_MIND_MODELS_HOT_LOAD: '0' }, fetchers, now, openRouter: forbiddenRouter });
  assert.equal(disabled.reasoningEffort, 'low');
  assert.equal(reads, 2);
  const logs = [];
  const unavailable = await resolveRuntimeCodexReasoningEffort(
    { model: 'future-coder', think: 'off' },
    {
      getCatalogue: async () => {
        throw new Error('read-only state');
      },
      log: async (...args) => logs.push(args),
    }
  );
  assert.equal(unavailable.reasoningEffort, null);
  assert.ok(logs.every(([, options]) => options.verbose === true));
} finally {
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('Issue #2526 capability loading and caching tests passed.');
