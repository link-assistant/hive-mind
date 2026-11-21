#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression tests for issue #2591: every obvious "latest version" alias works
 * (`--model astra` → the newest GPT Astra), aliases for families released after
 * this build are derived from the live catalogue, and the "Available models"
 * listing shows what the vendor CLI currently offers instead of ~60 entries
 * including obsolete models and provider-prefixed spellings.
 *
 * Live catalogues are injected through `availableModels`, so no CLI is spawned.
 */

import assert from 'node:assert/strict';
import { claudeModels, clearRuntimeModelAliases, CODEX_FAMILY_ALIASES, defaultModels, deriveClaudeFamilyAliases, deriveCodexFamilyAliases, deriveQwenFamilyAliases, getAvailableModelNames, mapModelForTool, resolveDefaultFallbackModel, resolveModelId, supports1mContext, validateModelName, validateRuntimeModelName } from '../src/models/index.mjs';
import { mapModelToId as mapCodexModelToId } from '../src/codex.options.lib.mjs';
import { mapModelToId as mapClaudeModelToId } from '../src/claude.model-utils.lib.mjs';
import { validateRuntimeModelInArgs } from '../src/telegram-command-args.lib.mjs';

// Codex CLI 0.161.0 `codex debug models` (docs/case-studies/issue-2591/data/codex/).
const CODEX_0_161_MODELS = ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-daybreak-blue-latest', 'gpt-daybreak-red-latest', 'gpt-5.5', 'codex-auto-review'];

let passed = 0;
const test = async (name, fn) => {
  clearRuntimeModelAliases();
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
};

console.log('Issue #2591: latest-version model aliases');

await test('the reported command: --tool codex --model astra resolves to GPT-6 Astra', async () => {
  const validation = validateModelName('astra', 'codex');
  assert.equal(validation.valid, true, validation.message);
  assert.equal(validation.mappedModel, 'gpt-6-astra');
  assert.equal(mapCodexModelToId('astra'), 'gpt-6-astra');
  assert.equal(resolveModelId('openai/astra', 'codex'), 'openai/gpt-6-astra');
  assert.equal(resolveModelId('openai.astra', 'codex'), 'openai.gpt-6-astra');
});

await test('the Telegram /codex command from the issue screenshot is accepted', async () => {
  const args = ['https://github.com/link-assistant/calculator/issues/227', '--think', 'high', '--model', 'astra'];
  assert.equal(await validateRuntimeModelInArgs(args, 'codex'), null);
});

await test('each Codex family alias names its own newest generation', async () => {
  // GPT-6 has Sol, Luna and Astra but no Terra; the complete-trio rule of
  // issue #2043 kept `sol` and `luna` on GPT-5.6 and gave `astra` nothing.
  assert.deepEqual(CODEX_FAMILY_ALIASES, {
    astra: 'gpt-6-astra',
    sol: 'gpt-6.1-sol',
    luna: 'gpt-6-luna',
    terra: 'gpt-5.6-terra',
    'daybreak-blue': 'gpt-daybreak-blue-latest',
    'daybreak-red': 'gpt-daybreak-red-latest',
  });
  assert.equal(mapModelForTool('codex', 'sol'), 'gpt-6.1-sol');
  assert.equal(mapModelForTool('codex', 'luna'), 'gpt-6-luna');
  assert.deepEqual(deriveCodexFamilyAliases(['gpt-6-sol', 'gpt-6.10-sol', 'gpt-6.9-sol']), { sol: 'gpt-6.10-sol' });
});

await test('an alias for a family released after this build comes from the live catalogue', async () => {
  assert.equal(validateModelName('nova', 'codex').valid, false);
  const result = await validateRuntimeModelName('nova', 'codex', { availableModels: [...CODEX_0_161_MODELS, 'gpt-7-nova'] });
  assert.equal(result.valid, true, result.message);
  assert.equal(result.mappedModel, 'gpt-7-nova');
  assert.equal(result.source, 'live-alias');
  // Execution maps the alias exactly as validation reported it.
  assert.equal(mapCodexModelToId('nova'), 'gpt-7-nova');
  assert.equal(resolveModelId('nova', 'codex'), 'gpt-7-nova');
});

await test('a known alias follows a newer generation the installed CLI already offers', async () => {
  const result = await validateRuntimeModelName('sol', 'codex', { availableModels: [...CODEX_0_161_MODELS, 'gpt-6.2-sol'] });
  assert.equal(result.mappedModel, 'gpt-6.2-sol');
  assert.equal(mapCodexModelToId('sol'), 'gpt-6.2-sol');
  const prefixed = await validateRuntimeModelName('openai/sol', 'codex', { availableModels: [...CODEX_0_161_MODELS, 'gpt-6.2-sol'] });
  assert.equal(prefixed.mappedModel, 'openai/gpt-6.2-sol');
});

await test('the live alias matches the bundled one for the current Codex catalogue', async () => {
  for (const [alias, modelId] of Object.entries({ astra: 'gpt-6-astra', sol: 'gpt-6.1-sol', luna: 'gpt-6-luna', terra: 'gpt-5.6-terra' })) {
    const result = await validateRuntimeModelName(alias, 'codex', { availableModels: CODEX_0_161_MODELS });
    assert.equal(result.mappedModel, modelId, alias);
    assert.equal(result.warning, undefined);
  }
});

await test('the Codex listing shows the CLI catalogue, not obsolete or prefixed names', async () => {
  const names = getAvailableModelNames('codex');
  for (const expected of ['astra', 'sol', 'luna', 'terra', 'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.5']) assert.ok(names.includes(expected), expected);
  for (const obsolete of ['gpt-reserve', 'gpt5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.6-cyber', 'o3-mini', 'gpt4o', 'codex-auto-review']) assert.ok(!names.includes(obsolete), obsolete);
  assert.ok(!names.some(name => name.startsWith('openai')), 'provider-prefixed spellings are not listed');
  assert.ok(names.length <= 20, `listing has ${names.length} entries`);
});

await test('obsolete Codex models stay accepted for pinned configurations', async () => {
  for (const legacy of ['gpt-5.4', 'gpt-5.3-codex', 'o3-mini', 'openai/gpt-5.4']) assert.equal(validateModelName(legacy, 'codex').valid, true, legacy);
});

await test('a typo lists what the installed Codex CLI offers', async () => {
  const result = await validateRuntimeModelName('astar', 'codex', { availableModels: [...CODEX_0_161_MODELS, 'gpt-7-nova'] });
  assert.equal(result.valid, false);
  assert.deepEqual(result.suggestions, ['astra']);
  assert.match(result.message, /Available models for codex: .*nova/);
  assert.match(result.message, /gpt-7-nova/);
});

await test('a model missing from the installed Codex catalogue is flagged', async () => {
  const result = await validateRuntimeModelName('astra', 'codex', { availableModels: ['gpt-6-sol', 'gpt-6-luna'] });
  assert.equal(result.valid, true);
  assert.equal(result.mappedModel, 'gpt-6-astra');
  assert.match(result.warning, /not in the installed Codex CLI's catalogue/);
});

await test('Claude rolling aliases match Claude Code 2.1.296', async () => {
  assert.equal(claudeModels.opus, 'claude-opus-5-5');
  assert.equal(claudeModels.sonnet, 'claude-sonnet-5-5');
  assert.equal(claudeModels.fable, 'claude-fable-5-1');
  assert.equal(claudeModels.best, 'claude-fable-5-1');
  // Direct runs still hand the rolling alias to Claude Code.
  assert.equal(mapClaudeModelToId('sonnet', { preserveRollingAlias: true }), 'sonnet');
});

await test('every Claude family gets a latest alias and dotted version spellings', async () => {
  for (const [input, expected] of Object.entries({ mythos: 'claude-mythos-5-1', 'sonnet-5-5': 'claude-sonnet-5-5', 'sonnet-5.5': 'claude-sonnet-5-5', 'opus-5.5': 'claude-opus-5-5', 'claude-opus-5.5': 'claude-opus-5-5', 'fable-5.1': 'claude-fable-5-1' })) {
    const validation = validateModelName(input, 'claude');
    assert.equal(validation.valid, true, input);
    assert.equal(validation.mappedModel, expected, input);
  }
  assert.equal(supports1mContext('mythos', 'claude'), true);
  assert.equal(supports1mContext('sonnet-5-5', 'claude'), true);
  assert.deepEqual(deriveClaudeFamilyAliases(['claude-saga-6', 'claude-saga-6-1']).saga, 'claude-saga-6-1');
});

await test('a newer Claude version shorthand passes through to Claude Code', async () => {
  const result = await validateRuntimeModelName('opus-6', 'claude', { availableModels: [] });
  assert.equal(result.valid, true, result.message);
  assert.equal(result.mappedModel, 'claude-opus-6');
  assert.equal(mapClaudeModelToId('opus-6'), 'claude-opus-6');
  assert.equal(mapClaudeModelToId('opus-6[1m]'), 'claude-opus-6[1m]');
  assert.equal((await validateRuntimeModelName('opsu-6', 'claude', { availableModels: [] })).valid, false);
});

await test('a Claude family alias follows a newer member reported by the live catalogue', async () => {
  const result = await validateRuntimeModelName('mythos', 'claude', { availableModels: ['claude-mythos-6'] });
  assert.equal(result.mappedModel, 'claude-mythos-6');
  assert.equal(mapClaudeModelToId('mythos'), 'claude-mythos-6');
});

await test('the Claude listing hides dotted duplicates and legacy Claude 3 aliases', async () => {
  const names = getAvailableModelNames('claude');
  for (const expected of ['opus', 'sonnet', 'haiku', 'fable', 'mythos', 'best', 'sonnet-5-5']) assert.ok(names.includes(expected), expected);
  assert.ok(!names.some(name => /\d\.\d/.test(name)), 'dotted aliases are not listed');
  assert.ok(!names.includes('haiku-3'));
  assert.equal(validateModelName('haiku-3', 'claude').valid, true);
});

await test('fallbacks cover the newest models', async () => {
  assert.equal(resolveDefaultFallbackModel('codex', 'sol'), 'gpt-6-sol');
  assert.equal(resolveDefaultFallbackModel('codex', 'astra'), 'gpt-6.1-sol');
  assert.equal(resolveDefaultFallbackModel('claude', 'sonnet-5-5'), 'sonnet-5');
});

await test('Gemini rolling aliases reach Gemini CLI unpinned (CLI 0.63.0 resolves them to Gemini 3.x)', async () => {
  for (const alias of ['auto', 'pro', 'flash', 'flash-lite']) assert.equal(mapModelForTool('gemini', alias), alias);
  assert.equal(mapModelForTool('gemini', 'gemini'), 'flash');
  assert.equal(mapModelForTool('gemini', '3.8-flash'), 'gemini-3.8-flash');
  const names = getAvailableModelNames('gemini');
  for (const expected of ['auto', 'pro', 'flash', 'flash-lite', 'gemini-3.1-pro-preview', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemma-4-31b-it']) assert.ok(names.includes(expected), expected);
  for (const obsolete of ['gemini-2.5-flash', 'gemini-2.5-flash-lite', '2.5-flash']) assert.ok(!names.includes(obsolete), obsolete);
  assert.equal(validateModelName('gemini-2.5-flash', 'gemini').valid, true);
});

await test('Qwen gets max/plus/flash latest aliases and the coder-model OAuth alias', async () => {
  assert.equal(mapModelForTool('qwen', 'max'), 'qwen3.8-max');
  assert.equal(mapModelForTool('qwen', 'qwen-plus'), 'qwen3.7-plus');
  assert.equal(mapModelForTool('qwen', 'flash'), 'qwen3.8-flash');
  assert.equal(validateModelName('coder-model', 'qwen').valid, true);
  assert.deepEqual(deriveQwenFamilyAliases(['qwen3.8-max', 'qwen3.8-max-preview', 'qwen3.10-max', 'qwen3-coder-plus']), { max: 'qwen3.10-max', 'qwen-max': 'qwen3.10-max' });
  const names = getAvailableModelNames('qwen');
  for (const obsolete of ['qwen3-coder', 'qwen3-coder-flash', 'qwen3.6-coder-plus']) assert.ok(!names.includes(obsolete), obsolete);
  assert.equal(validateModelName('qwen3-coder-flash', 'qwen').valid, true);
});

await test('agent and opencode premium aliases follow the newest Claude and Gemini models', async () => {
  for (const tool of ['agent', 'opencode']) {
    assert.equal(mapModelForTool(tool, 'opus'), `anthropic/${claudeModels.opus}`);
    assert.equal(mapModelForTool(tool, 'sonnet'), `anthropic/${claudeModels.sonnet}`);
  }
  assert.equal(mapModelForTool('agent', 'haiku'), `anthropic/${claudeModels.haiku}`);
  assert.equal(mapModelForTool('opencode', 'gemini'), 'google/gemini-3.1-pro-preview');
  assert.equal(mapModelForTool('agent', 'nemotron-3-ultra-free'), 'opencode/nemotron-3-ultra-free');
  const names = getAvailableModelNames('agent');
  for (const obsolete of ['grok-code', 'minimax-m2.5-free', 'kimi-k2.5-free']) assert.ok(!names.includes(obsolete), obsolete);
  assert.equal(validateModelName('grok-code', 'agent').valid, true);
});

await test('opencode defaults to a model OpenCode still serves and hides deprecated ones', async () => {
  // grok-code is deprecated on models.dev, and OpenCode deletes deprecated models,
  // so the old `grok-code-fast-1` default named a model OpenCode no longer offers.
  assert.equal(defaultModels.opencode, 'big-pickle');
  assert.equal(mapModelForTool('opencode', defaultModels.opencode), 'opencode/big-pickle');
  assert.equal(validateModelName(defaultModels.opencode, 'opencode').valid, true);
  const names = getAvailableModelNames('opencode');
  for (const current of ['big-pickle', 'nemotron-3-ultra-free', 'sonnet', 'opus', 'haiku', 'gemini']) assert.ok(names.includes(current), current);
  for (const obsolete of ['gpt4', 'grok', 'grok-code', 'grok-code-fast-1']) assert.ok(!names.includes(obsolete), obsolete);
  assert.equal(validateModelName('grok-code-fast-1', 'opencode').mappedModel, 'opencode/grok-code');
});

await test('HIVE_MIND_MODEL_DEBUG traces which catalogue resolved an alias', async () => {
  const lines = [];
  const originalError = console.error;
  const originalDebug = process.env.HIVE_MIND_MODEL_DEBUG;
  console.error = line => lines.push(String(line));
  try {
    delete process.env.HIVE_MIND_MODEL_DEBUG;
    if (!process.argv.includes('--verbose')) {
      await validateRuntimeModelName('astra', 'codex', { availableModels: CODEX_0_161_MODELS });
      assert.deepEqual(lines, [], 'tracing is off by default');
    }
    process.env.HIVE_MIND_MODEL_DEBUG = '1';
    await validateRuntimeModelName('nova', 'codex', { availableModels: [...CODEX_0_161_MODELS, 'gpt-7-nova'] });
  } finally {
    console.error = originalError;
    if (originalDebug === undefined) delete process.env.HIVE_MIND_MODEL_DEBUG;
    else process.env.HIVE_MIND_MODEL_DEBUG = originalDebug;
  }
  assert.ok(
    lines.some(line => line.startsWith('[model-resolution] live alias') && line.includes('"mappedModel":"gpt-7-nova"')),
    lines.join('\n')
  );
});

clearRuntimeModelAliases();
console.log(`Issue #2591 tests passed (${passed})`);
