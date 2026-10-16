/**
 * @hive-mind-test-suite default
 *
 * Issue #3215: "Formal AI should be treated as just another model for our
 * tools." Every tool accepts the same two spellings, `formal-ai` and
 * `formalai/formal-ai`, and nothing else. Codex used to derive `openai/<name>`
 * and `openai.<name>` variants for every model in its map, Formal AI
 * included, so `--tool codex --model openai/formal-ai` validated and was then
 * sent to OpenAI as the model id `openai/formal-ai` instead of to Formal AI.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FORMAL_AI_SUPPORTED_TOOLS } from '../src/formal-ai.lib.mjs';
import { getModelMapForTool, isModelCompatibleWithTool, validateModelName } from '../src/models/index.mjs';

test('every tool accepts exactly the two Formal AI spellings', () => {
  for (const tool of FORMAL_AI_SUPPORTED_TOOLS) {
    const spellings = Object.keys(getModelMapForTool(tool)).filter(name => /formal/i.test(name));
    assert.deepEqual(spellings.sort(), ['formal-ai', 'formalai/formal-ai'], `${tool} model names mentioning Formal AI`);
    for (const model of ['formal-ai', 'formalai/formal-ai']) {
      assert.equal(validateModelName(model, tool).valid, true, `${tool} accepts ${model}`);
      assert.equal(isModelCompatibleWithTool(tool, model), true, `${tool} is compatible with ${model}`);
    }
  }
});

test('codex does not route a provider-prefixed Formal AI spelling to OpenAI', () => {
  for (const model of ['openai/formal-ai', 'openai.formal-ai', 'openai/formalai/formal-ai']) {
    assert.equal(validateModelName(model, 'codex').valid, false, `codex rejects ${model}`);
    assert.equal(isModelCompatibleWithTool('codex', model), false, `codex is not compatible with ${model}`);
  }
  // The real OpenAI spellings keep working (no breaking change for codex users).
  assert.equal(validateModelName('openai/gpt-5.5', 'codex').valid, true);
  assert.equal(validateModelName('openai.sol', 'codex').valid, true);
});

test('hive and solve validate a Formal AI model through the wrapper, not the tool provider', async () => {
  const { validateToolConnection } = await import('../src/tool-connection-validation.lib.mjs');
  for (const tool of FORMAL_AI_SUPPORTED_TOOLS) {
    const checked = [];
    const lines = [];
    const validateFormalAiToolConnection = async name => {
      checked.push(name);
      return { valid: true, formalAiVersion: '0.353.2', version: `${name} 1.0.0` };
    };
    // The Claude validator would send a live request to Anthropic; it must not run.
    const validateClaudeConnection = async () => assert.fail('the Claude provider check ran for a Formal AI model');
    const ok = await validateToolConnection({ tool, model: 'formal-ai', validateClaudeConnection, validateFormalAiToolConnection, log: async line => lines.push(line) });
    assert.equal(ok, true, tool);
    assert.deepEqual(checked, [tool]);
    assert.ok(lines.includes('📦 Formal AI wrapper version: 0.353.2'), lines.join('\n'));
  }
  const failures = [];
  const failed = await validateToolConnection({ tool: 'codex', model: 'formalai/formal-ai', validateFormalAiToolConnection: async () => ({ valid: false, error: 'no client', formalAiVersion: null }), log: async line => failures.push(line) });
  assert.equal(failed, false);
  assert.match(failures.join('\n'), /Formal AI dispatch validation failed: no client/);
});

test('a miscased Formal AI model is Formal AI for every tool, and no vendor model is', async () => {
  const { canonicalFormalAiModel, isFormalAiModel } = await import('../src/models/index.mjs');
  for (const [typed, canonical] of [
    ['Formal-AI', 'formal-ai'],
    [' FORMAL-AI ', 'formal-ai'],
    ['FormalAI/Formal-AI', 'formalai/formal-ai'],
  ]) {
    assert.equal(canonicalFormalAiModel(typed), canonical, typed);
    assert.equal(isFormalAiModel(typed), true, typed);
    // Validation is case-insensitive, so the identity check must agree with
    // it: before, these passed validation and then went to the vendor CLI.
    for (const tool of FORMAL_AI_SUPPORTED_TOOLS) {
      assert.equal(validateModelName(typed.trim(), tool).valid, true, `${tool} accepts ${typed}`);
      assert.equal(isModelCompatibleWithTool(tool, typed), true, `${tool} is compatible with ${typed}`);
    }
  }
  for (const value of [undefined, null, '', 'opus', 'gpt-5.5', 'openai/formal-ai', 'formal-ai-2']) assert.equal(canonicalFormalAiModel(value), null, String(value));
  for (const tool of FORMAL_AI_SUPPORTED_TOOLS) {
    for (const [name, id] of Object.entries(getModelMapForTool(tool))) {
      if (/formal/i.test(name)) continue;
      assert.equal(isFormalAiModel(name) || isFormalAiModel(id), false, `${tool}: ${name} -> ${id} is a vendor model`);
    }
  }
});
