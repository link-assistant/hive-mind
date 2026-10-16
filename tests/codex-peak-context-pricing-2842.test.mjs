/**
 * @hive-mind-test-suite default
 * Issue #2842: Codex long-context pricing must be decided by the largest single
 * request, not by the whole-turn total reported in `turn.completed`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

globalThis.use = async name => {
  const packageName = name.replace(/@\d[^/]*$/, '');
  if (packageName === 'command-stream') return { $: () => ({ stream: async function* noopStream() {} }) };
  if (packageName === 'fs') return { ...fs, default: fs };
  if (packageName === 'os') return { ...os, default: os };
  if (packageName === 'path') return { ...path, default: path };
  if (packageName === 'getenv') return (key, fallback) => process.env[key] ?? fallback;
  return import(packageName);
};
const { calculateCodexPricingFromModelInfo, createCodexTokenUsage, executeCodexCommand, parseCodexExecJsonOutput } = await import('../src/codex.lib.mjs');
const { resolveCodexPeakContextUsage } = await import('../src/codex.diagnostics.lib.mjs');
const { buildCodexContextWindowConfigArgs, getCodexContextWindowFromConfigArgs } = await import('../src/pricing-tier.lib.mjs');

// The raw event from the incident: one `codex exec` turn of many requests.
const INCIDENT_TURN = { type: 'turn.completed', usage: { input_tokens: 2677856, cached_input_tokens: 2508288, output_tokens: 26787 } };
const INCIDENT_STDOUT = [{ type: 'thread.started', thread_id: 'thread-2842' }, { type: 'turn.started' }, { type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'Done.' } }, INCIDENT_TURN].map(event => JSON.stringify(event)).join('\n');
const sseLine = (inputTokenCount, { stream = 'log_only', kind = 'response.completed' } = {}) => `2026-10-09T09:44:17.000000Z  INFO codex_otel.${stream}: event.name="codex.sse_event" event.kind=${kind} input_token_count=${inputTokenCount} output_token_count=512 cached_token_count=${Math.max(0, inputTokenCount - 2000)} reasoning_token_count=64 tool_token_count=${inputTokenCount + 512} event.timestamp=2026-10-09T09:44:17.000Z conversation.id=thread-2842 app.version=0.150.0 auth_mode="Chatgpt" originator=codex_exec`;
// Largest single request in the incident diagnostics was 149,702 tokens; codex
// writes every SSE record twice (log_only + trace_safe).
const INCIDENT_STDERR = [12000, 48000, 149702, 98000].flatMap(count => [sseLine(count), sseLine(count, { stream: 'trace_safe' })]).join('\n');

const MODEL_INFO = {
  name: 'GPT-6.1 Sol',
  provider: 'OpenAI',
  cost: { input: 2.5, cache_read: 0.25, output: 15, context_over_200k: { input: 5, cache_read: 0.5, output: 22.5 } },
  limit: { context: 1050000, output: 128000 },
};

test('reproduces #2842: the per-request peak, not the turn total, drives pricing', () => {
  let state = parseCodexExecJsonOutput(INCIDENT_STDOUT, {}, 'gpt-6.1-sol', { source: 'stdout' });
  state = parseCodexExecJsonOutput(INCIDENT_STDERR, state, 'gpt-6.1-sol', { source: 'stderr' });

  assert.equal(state.tokenUsage.inputTokens, 169568);
  assert.equal(state.tokenUsage.cacheReadTokens, 2508288);
  assert.equal(state.tokenUsage.turnPeakContextUsage, 2677856);
  assert.equal(state.tokenUsage.peakRequestInputTokens, 149702);
  assert.equal(state.tokenUsage.peakContextUsage, 149702);

  const pricing = calculateCodexPricingFromModelInfo('gpt-6.1-sol', state.tokenUsage, MODEL_INFO);
  assert.equal(pricing.usesLongContextPricing, false);
  assert.equal(pricing.peakPromptTokens, 149702);
  assert.equal(pricing.longContextThreshold, null);
  assert.equal(pricing.pricing.inputPerMillion, 2.5);
  // 169,568 × $2.5 + 2,508,288 × $0.25 + 26,787 × $15 per 1M tokens.
  assert.equal(pricing.totalCostUSD.toFixed(6), '1.452797');
});

test('diagnostics parsed before the turn event give the same peak', () => {
  let state = parseCodexExecJsonOutput(INCIDENT_STDERR, {}, 'gpt-6.1-sol', { source: 'stderr' });
  state = parseCodexExecJsonOutput(INCIDENT_STDOUT, state, 'gpt-6.1-sol', { source: 'stdout' });
  assert.equal(state.tokenUsage.peakContextUsage, 149702);
});

test('a single request over 272K still gets long-context pricing', () => {
  let state = parseCodexExecJsonOutput(INCIDENT_STDOUT, {}, 'gpt-6.1-sol', { source: 'stdout' });
  state = parseCodexExecJsonOutput([sseLine(150000), sseLine(300000)].join('\n'), state, 'gpt-6.1-sol', { source: 'stderr' });

  const pricing = calculateCodexPricingFromModelInfo('gpt-6.1-sol', state.tokenUsage, MODEL_INFO);
  assert.equal(pricing.usesLongContextPricing, true);
  assert.equal(pricing.peakPromptTokens, 300000);
  assert.equal(pricing.longContextThreshold, 272000);
  assert.equal(pricing.pricing.inputPerMillion, 5);
});

test('only response.completed SSE records count as requests', () => {
  const lines = [sseLine(900000, { kind: 'response.created' }), 'codex_otel.log_only: event.name="codex.api_request" input_token_count=900000', sseLine(1000).replace('event.kind=response.completed', 'event.kind="response.completed"'), 'plain text input_token_count=900000'].join('\n');
  const state = parseCodexExecJsonOutput(lines, {}, 'gpt-6.1-sol', { source: 'stderr' });
  assert.equal(state.tokenUsage.peakRequestInputTokens, 1000);
});

test('without per-request diagnostics the turn total is capped at the configured window', () => {
  const tokenUsage = createCodexTokenUsage('gpt-6.1-sol', { contextLimit: 272000 });
  const state = parseCodexExecJsonOutput(INCIDENT_STDOUT, { tokenUsage }, 'gpt-6.1-sol', { source: 'stdout' });
  assert.equal(state.tokenUsage.peakContextUsage, 272000);

  const pricing = calculateCodexPricingFromModelInfo('gpt-6.1-sol', state.tokenUsage, MODEL_INFO);
  assert.equal(pricing.usesLongContextPricing, false);
});

test('a context_window diagnostic also caps the turn-total fallback', () => {
  let state = parseCodexExecJsonOutput(INCIDENT_STDOUT, {}, 'gpt-6.1-sol', { source: 'stdout' });
  state = parseCodexExecJsonOutput('codex_otel.log_only: event.name="codex.conversation_starts" model_context_window=200000', state, 'gpt-6.1-sol', { source: 'stderr' });
  assert.equal(state.tokenUsage.peakContextUsage, 200000);
});

test('without diagnostics or a configured window pricing caps at the model window', () => {
  const state = parseCodexExecJsonOutput(INCIDENT_STDOUT, {}, 'gpt-6.1-sol', { source: 'stdout' });
  assert.equal(state.tokenUsage.peakContextUsage, 2677856);

  const shortWindowModel = { ...MODEL_INFO, limit: { context: 200000, output: 128000 } };
  const pricing = calculateCodexPricingFromModelInfo('gpt-6.1-sol', state.tokenUsage, shortWindowModel);
  assert.equal(pricing.peakPromptTokens, 200000);
  assert.equal(pricing.usesLongContextPricing, false);
});

test('resolveCodexPeakContextUsage keeps legacy tokenUsage objects working', () => {
  assert.equal(resolveCodexPeakContextUsage(null), 0);
  assert.equal(resolveCodexPeakContextUsage({ peakContextUsage: 300000 }), 300000);
  assert.equal(resolveCodexPeakContextUsage({ peakContextUsage: 300000 }, { contextWindow: 272000 }), 272000);
  assert.equal(resolveCodexPeakContextUsage({ peakContextUsage: 300000, contextLimit: 200000 }, { contextWindow: 1050000 }), 200000);
  assert.equal(resolveCodexPeakContextUsage({ peakRequestInputTokens: 5000, turnPeakContextUsage: 900000 }), 5000);
});

test('getCodexContextWindowFromConfigArgs reads back the short-context window override', () => {
  assert.equal(getCodexContextWindowFromConfigArgs(buildCodexContextWindowConfigArgs({ longContext: false })), 272000);
  assert.equal(getCodexContextWindowFromConfigArgs(['-c', 'model_context_window=200000']), 200000);
  assert.equal(getCodexContextWindowFromConfigArgs(buildCodexContextWindowConfigArgs({ longContext: true })), null);
  assert.equal(getCodexContextWindowFromConfigArgs(undefined), null);
});

test('executeCodexCommand logs short-context pricing for the incident replay', { timeout: 10000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hive-mind-2842-'));
  const logs = [];
  let pricedTokenUsage = null;
  const fakeDollar = () => () => ({
    async *stream() {
      yield { type: 'stdout', data: Buffer.from(INCIDENT_STDOUT + '\n') };
      yield { type: 'stderr', data: Buffer.from(INCIDENT_STDERR + '\n') };
      yield { type: 'exit', code: 0, signal: null };
    },
  });
  try {
    const result = await executeCodexCommand({
      tempDir,
      branchName: 'issue-2842-test',
      prompt: 'Fix the issue.',
      systemPrompt: 'Solve the issue.',
      argv: { model: 'gpt-5.5', verbose: true },
      log: async (message, options) => logs.push({ message: String(message), options }),
      formatAligned: (_icon, label, value = '') => `${label} ${value}`,
      getResourceSnapshot: async () => ({ memory: 'Mem:\n  9.4 GB available', load: '0.00' }),
      readCgroupMemory: () => null,
      codexPath: 'codex',
      $: fakeDollar,
      calculatePricing: async (modelId, tokenUsage) => {
        pricedTokenUsage = tokenUsage;
        return calculateCodexPricingFromModelInfo(modelId, tokenUsage, MODEL_INFO);
      },
    });
    assert.equal(pricedTokenUsage.peakContextUsage, 149702);
    assert.equal(result.pricingInfo.usesLongContextPricing, false);
    assert.equal(result.publicPricingEstimate.toFixed(6), '1.452797');
    assert.ok(logs.some(line => line.message.includes('Codex public pricing estimate: $1.452797')));
    assert.ok(!logs.some(line => line.message.includes('Long-context pricing applied')));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
