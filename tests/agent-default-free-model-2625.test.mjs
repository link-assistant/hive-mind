/**
 * Regression coverage for issue #2625 (E2E Hello World Matrix run 37616874265,
 * row `agent / nemotron-3-super-free`).
 *
 * Hive Mind's default Agent model mapped to `opencode/nemotron-3-super-free`,
 * which OpenCode Zen withdrew (link-assistant/agent#327):
 *
 *   Model "nemotron-3-super-free" not found in provider "opencode".
 *
 * Zen's remaining free models refuse non-OpenCode clients with HTTP 403
 * FreeTierError, so the default now runs the same model on the Kilo gateway,
 * with the provider entry Agent 0.26.11 lacks supplied through
 * LINK_ASSISTANT_AGENT_CONFIG_CONTENT.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2625
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { AGENT_PROVIDER_MODEL_OVERLAYS, getAgentModelOverlayEnv, mergeAgentModelOverlayConfigContent } from '../src/agent-model-overlay.lib.mjs';
import { defaultModels } from '../src/models/catalog.mjs';
import { mapModelForTool, validateModelName } from '../src/models/index.mjs';

const source = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('the default Agent model no longer points at the withdrawn Zen model', () => {
  const mapped = mapModelForTool('agent', defaultModels.agent);
  assert.notEqual(mapped, 'opencode/nemotron-3-super-free');
  assert.equal(mapped, 'kilo/nemotron-3-super-free');
  assert.ok(AGENT_PROVIDER_MODEL_OVERLAYS[mapped], 'Agent 0.26.11 has no entry for it, so Hive Mind must supply one');
  assert.equal(AGENT_PROVIDER_MODEL_OVERLAYS[mapped].id, 'nvidia/nemotron-3-super-120b-a12b:free');
  assert.deepEqual(AGENT_PROVIDER_MODEL_OVERLAYS[mapped].cost, { input: 0, output: 0, cache_read: 0, cache_write: 0 });
});

test('both the short name and the full Kilo id are accepted', () => {
  assert.equal(validateModelName('nemotron-3-super-free', 'agent').mappedModel, 'kilo/nemotron-3-super-free');
  assert.equal(validateModelName('kilo/nemotron-3-super-free', 'agent').mappedModel, 'kilo/nemotron-3-super-free');
});

test('the overlay is added to an empty inline config', () => {
  const env = getAgentModelOverlayEnv({ env: {}, mappedModel: 'kilo/nemotron-3-super-free' });
  const config = JSON.parse(env.LINK_ASSISTANT_AGENT_CONFIG_CONTENT);
  assert.equal(config.provider.kilo.models['nemotron-3-super-free'].id, 'nvidia/nemotron-3-super-120b-a12b:free');
});

test('existing inline config is preserved, including Playwright MCP settings', () => {
  const existing = JSON.stringify({ mcp: { playwright: { enabled: false } }, provider: { kilo: { options: { apiKey: 'k' }, models: { other: { id: 'x' } } } } });
  const config = JSON.parse(mergeAgentModelOverlayConfigContent(existing, 'kilo/nemotron-3-super-free'));
  assert.deepEqual(config.mcp, { playwright: { enabled: false } });
  assert.deepEqual(config.provider.kilo.options, { apiKey: 'k' });
  assert.deepEqual(config.provider.kilo.models.other, { id: 'x' });
  assert.ok(config.provider.kilo.models['nemotron-3-super-free']);
});

test('a user definition of the same model wins', () => {
  const existing = JSON.stringify({ provider: { kilo: { models: { 'nemotron-3-super-free': { id: 'mine' } } } } });
  assert.equal(mergeAgentModelOverlayConfigContent(existing, 'kilo/nemotron-3-super-free'), null);
  assert.deepEqual(getAgentModelOverlayEnv({ env: { LINK_ASSISTANT_AGENT_CONFIG_CONTENT: existing }, mappedModel: 'kilo/nemotron-3-super-free' }), {});
});

test('unparseable inline config is left alone', () => {
  assert.equal(mergeAgentModelOverlayConfigContent('{not json', 'kilo/nemotron-3-super-free'), null);
  assert.equal(mergeAgentModelOverlayConfigContent('[]', 'kilo/nemotron-3-super-free'), null);
});

test('models Agent already knows need no overlay', () => {
  for (const model of ['opencode/big-pickle', 'kilo/glm-5-free', 'formalai/formal-ai']) {
    assert.deepEqual(getAgentModelOverlayEnv({ env: {}, mappedModel: model }), {}, model);
  }
});

test('both the task run and the connection check hand the overlay to Agent', () => {
  const agentLib = source('src/agent.lib.mjs');
  assert.match(agentLib, /const validationEnv = \{ \.\.\.process\.env, \.\.\.getAgentModelOverlayEnv\(\{ mappedModel \}\) \};/);
  assert.match(agentLib, /\$\(\{ env: validationEnv \}\)`printf "hi" \| timeout/);
  assert.match(agentLib, /getAgentModelOverlayEnv\(\{ env: agentEnv, mappedModel \}\)/);
});
