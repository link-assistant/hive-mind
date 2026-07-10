#!/usr/bin/env node

import assert from 'node:assert/strict';

const { defaultModels, primaryModelNames, resolveDefaultFallbackModel, resolveModelId, resolveRuntimeDefaultModel, validateModelName } = await import('../src/models/index.mjs');
const { resolveCodexReasoningEffort } = await import('../src/codex.options.lib.mjs');
const { parseCodexExecJsonOutput, getCodexErrorEventSummary, executeCodexCommand, buildCodexResultModelUsage, calculateCodexPricingFromModelInfo } = await import('../src/codex.lib.mjs');
const { executeOpenCodeCommand } = await import('../src/opencode.lib.mjs');
const { executeAgentCommand, agentCliSupportsLiveInput, getAgentCliVersion, MIN_AGENT_LIVE_INPUT_VERSION } = await import('../src/agent.lib.mjs');
const { classifyRetryableError } = await import('../src/tool-retry.lib.mjs');
const { retryLimits } = await import('../src/config.lib.mjs');
const { buildCostInfoString } = await import('../src/github-cost-info.lib.mjs');
const { buildAgentBudgetStats, buildBudgetStatsString } = await import('../src/claude.budget-stats.lib.mjs');

let passed = 0;
let failed = 0;

const test = (name, fn) => {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   ${error.message}`);
    failed++;
  }
};

const asyncTest = async (name, fn) => {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   ${error.message}`);
    failed++;
  }
};

const renderTaggedTemplateCommand = (strings, values) => strings.reduce((result, stringPart, index) => result + stringPart + (index < values.length ? String(values[index]) : ''), '');

test('Codex preferred default model is gpt-5.6-sol', () => {
  // Issue #2027: GPT-5.6 Sol is the released Codex flagship default.
  assert.equal(defaultModels.codex, 'gpt-5.6-sol');
});

test('Codex resolves gpt-5.5 model id', () => {
  assert.equal(resolveModelId('gpt-5.5', 'codex'), 'gpt-5.5');
});

test('Codex validates gpt-5.5-mini model id', () => {
  const result = validateModelName('gpt-5.5-mini', 'codex');
  assert.equal(result.valid, true);
  assert.equal(result.mappedModel, 'gpt-5.5-mini');
});

test('Codex validates gpt-5.5-nano model id', () => {
  const result = validateModelName('gpt-5.5-nano', 'codex');
  assert.equal(result.valid, true);
  assert.equal(result.mappedModel, 'gpt-5.5-nano');
});

for (const model of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
  test(`Codex validates upcoming ${model} model id`, () => {
    const result = validateModelName(model, 'codex');
    assert.equal(result.valid, true);
    assert.equal(result.mappedModel, model);
  });
}

for (const model of ['openai.gpt-5.5', 'openai.gpt-5.4', 'openai.gpt-5.6-sol', 'openai.gpt-5.6-terra', 'openai.gpt-5.6-luna']) {
  test(`Codex validates Bedrock-prefixed ${model} model id`, () => {
    const result = validateModelName(model, 'codex');
    assert.equal(result.valid, true);
    assert.equal(result.mappedModel, model);
  });
}

test('Codex validates hidden codex-auto-review model id from CLI catalog', () => {
  const result = validateModelName('codex-auto-review', 'codex');
  assert.equal(result.valid, true);
  assert.equal(result.mappedModel, 'codex-auto-review');
});

test('Codex primary model names prioritize gpt-5.6-sol and current visible catalog entries', () => {
  // Issue #2027: gpt-5.6-sol leads the primary catalog, with gpt-5.5 kept as the stable fallback.
  assert.deepEqual(primaryModelNames.codex, ['gpt-5.6-sol', 'gpt-5.5', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex-spark']);
  assert.equal(primaryModelNames.codex.includes('codex-auto-review'), false);
});

await asyncTest('Codex runtime default uses gpt-5.6-sol when the local catalog includes it', async () => {
  const result = await resolveRuntimeDefaultModel('codex', {
    availableCodexModels: ['gpt-5.6-sol', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'],
  });
  assert.equal(result, 'gpt-5.6-sol');
});

await asyncTest('Codex runtime default falls back to gpt-5.5 when gpt-5.6-sol is missing from the local catalog', async () => {
  const result = await resolveRuntimeDefaultModel('codex', {
    availableCodexModels: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'],
  });
  assert.equal(result, 'gpt-5.5');
});

await asyncTest('Codex runtime default falls back to gpt-5.5 for current CLI catalog including hidden auto-review model', async () => {
  const result = await resolveRuntimeDefaultModel('codex', {
    availableCodexModels: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex-spark', 'codex-auto-review'],
  });
  assert.equal(result, 'gpt-5.5');
});

await asyncTest('Codex runtime default keeps gpt-5.6-sol when only the preview tier is available', async () => {
  const result = await resolveRuntimeDefaultModel('codex', {
    availableCodexModels: ['gpt-5.6-sol', 'gpt-5.4', 'gpt-5.4-mini'],
  });
  assert.equal(result, 'gpt-5.6-sol');
});

await asyncTest('Codex runtime default falls back to gpt-5.4 when gpt-5.5 is not in the local catalog', async () => {
  const result = await resolveRuntimeDefaultModel('codex', {
    availableCodexModels: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex'],
  });
  assert.equal(result, 'gpt-5.4');
});

await asyncTest('Codex runtime default falls back to gpt-5.5-mini when newer small variants are available before older full-size fallbacks', async () => {
  const result = await resolveRuntimeDefaultModel('codex', {
    availableCodexModels: ['gpt-5.5-mini', 'gpt-5.5-nano'],
  });
  assert.equal(result, 'gpt-5.5-mini');
});

test('Codex default fallback model resolves from gpt-5.5 to gpt-5.4', () => {
  assert.equal(resolveDefaultFallbackModel('codex', 'gpt-5.5'), 'gpt-5.4');
});

// Issue #2037 (review): the codex default fallback is a *closest-first* chain ordered
// by intelligence / size tier, not by generation. The flagship sibling gpt-5.6-terra is
// closest to Sol, and the next-closest to terra is the previous-generation flagship
// gpt-5.5 (larger/more capable than the smaller gpt-5.6-luna tier), then 5.5 -> 5.4 -> 5.2.
const codexChain = {
  'gpt-5.6-sol': 'gpt-5.6-terra',
  'gpt-5.6-terra': 'gpt-5.5',
  'gpt-5.6-luna': 'gpt-5.5',
  'gpt-5.5': 'gpt-5.4',
  'gpt-5.4': 'gpt-5.2',
  'openai.gpt-5.6-sol': 'openai.gpt-5.6-terra',
  'openai.gpt-5.6-terra': 'openai.gpt-5.5',
  'openai.gpt-5.6-luna': 'openai.gpt-5.5',
  'openai.gpt-5.5': 'openai.gpt-5.4',
  'openai.gpt-5.4': 'openai.gpt-5.2',
};
for (const [model, expected] of Object.entries(codexChain)) {
  test(`Codex default fallback model resolves from ${model} to ${expected}`, () => {
    assert.equal(resolveDefaultFallbackModel('codex', model), expected);
  });
}

// Walking the full chain step-by-step descends by intelligence tier, skipping the
// smaller luna variant: sol -> terra -> gpt-5.5 -> gpt-5.4 -> gpt-5.2.
test('Codex default fallback chain walks gpt-5.6-sol -> terra -> gpt-5.5 -> gpt-5.4 -> gpt-5.2', () => {
  const chain = ['gpt-5.6-sol'];
  let current = chain[0];
  for (let i = 0; i < 6; i++) {
    const next = resolveDefaultFallbackModel('codex', current);
    if (!next) break;
    chain.push(next);
    current = next;
  }
  assert.deepEqual(chain, ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.5', 'gpt-5.4', 'gpt-5.2']);
});

test('Claude default fallback model resolves from opus to opus-4-7', () => {
  // Updated for Issue #1832: opus is now claude-opus-4-8 with fallback to opus-4-7
  assert.equal(resolveDefaultFallbackModel('claude', 'opus'), 'opus-4-7');
});

test('Models without configured defaults keep fallback unset', () => {
  assert.equal(resolveDefaultFallbackModel('codex', 'gpt-5.2'), null);
  assert.equal(resolveDefaultFallbackModel('agent', 'opencode/grok-code'), null);
});

test('Agent live input version guard requires Agent 0.24.1 or newer', () => {
  assert.equal(MIN_AGENT_LIVE_INPUT_VERSION, '0.24.1');
  assert.equal(getAgentCliVersion('@link-assistant/agent 0.24.1'), '0.24.1');
  assert.equal(agentCliSupportsLiveInput('@link-assistant/agent 0.24.0'), false);
  assert.equal(agentCliSupportsLiveInput('@link-assistant/agent 0.24.1'), true);
});

test('Capacity errors are classified as retryable overloads', () => {
  const classified = classifyRetryableError('Selected model is at capacity. Please try a different model.');
  assert.equal(classified.isRetryable, true);
  assert.equal(classified.isCapacity, true);
  assert.equal(classified.label, 'Model capacity error');
});

test('Codex stream disconnects are classified as retryable transport errors', () => {
  const classified = classifyRetryableError(['stream disconnected before completion: An error occurred while processing your request.', 'You can retry your request, or contact us through our help center at help.openai.com if the error persists.', 'Please include the request ID 00f1ff7f-106b-4f1e-a689-122e886fcaae in your message.'].join(' '));
  assert.equal(classified.isRetryable, true);
  assert.equal(classified.isCapacity, false);
  assert.equal(classified.label, 'Stream disconnected before completion');
});

test('Codex --think off maps to none reasoning', () => {
  const result = resolveCodexReasoningEffort({ think: 'off' });
  assert.equal(result.reasoningEffort, 'none');
});

test('Codex --think low maps to low reasoning', () => {
  const result = resolveCodexReasoningEffort({ think: 'low' });
  assert.equal(result.reasoningEffort, 'low');
});

test('Codex --think medium maps to medium reasoning', () => {
  const result = resolveCodexReasoningEffort({ think: 'medium' });
  assert.equal(result.reasoningEffort, 'medium');
});

test('Codex --think high maps to high reasoning', () => {
  const result = resolveCodexReasoningEffort({ think: 'high' });
  assert.equal(result.reasoningEffort, 'high');
});

test('Codex --think xhigh maps to xhigh reasoning (natively supported by GPT-5.5/5.6)', () => {
  const result = resolveCodexReasoningEffort({ think: 'xhigh' });
  assert.equal(result.reasoningEffort, 'xhigh');
});

test('Codex --think ultra maps to ultra reasoning (multi-agent tier) and pairs a rollout token budget', () => {
  const result = resolveCodexReasoningEffort({ think: 'ultra' });
  assert.equal(result.reasoningEffort, 'ultra');
  // Issue #2027: ultra must be paired with a rollout token budget cap to stay predictable.
  assert.equal(result.rolloutTokenBudget, 500000);
});

test('Codex --think ultra honors an explicit --rollout-token-budget override', () => {
  const result = resolveCodexReasoningEffort({ think: 'ultra', rolloutTokenBudget: 250000 });
  assert.equal(result.reasoningEffort, 'ultra');
  assert.equal(result.rolloutTokenBudget, 250000);
});

test('Codex --think max maps to max reasoning (deepest single-agent effort, above xhigh)', () => {
  const result = resolveCodexReasoningEffort({ think: 'max' });
  assert.equal(result.reasoningEffort, 'max');
  // Only ultra carries a rollout token budget; max is single-agent.
  assert.equal(result.rolloutTokenBudget, undefined);
});

test('Codex --thinking-budget exposes minimal reasoning tier', () => {
  const result = resolveCodexReasoningEffort({ thinkingBudget: 1000, maxThinkingBudget: 10000 });
  assert.equal(result.reasoningEffort, 'minimal');
});

test('Codex --thinking-budget exposes high reasoning tier', () => {
  const result = resolveCodexReasoningEffort({ thinkingBudget: 7500, maxThinkingBudget: 10000 });
  assert.equal(result.reasoningEffort, 'high');
});

test('Codex --thinking-budget caps the budget-derived effort at xhigh (max/ultra stay explicit)', () => {
  const result = resolveCodexReasoningEffort({ thinkingBudget: 10000, maxThinkingBudget: 10000 });
  assert.equal(result.reasoningEffort, 'xhigh');
});

test('Codex --thinking-budget 0 disables reasoning', () => {
  const result = resolveCodexReasoningEffort({ thinkingBudget: 0 });
  assert.equal(result.reasoningEffort, 'none');
});

test('Codex defaults to none reasoning when no thinking flags are set', () => {
  const result = resolveCodexReasoningEffort({});
  assert.equal(result.reasoningEffort, 'none');
});

test('Codex exec JSON parser extracts session, result text, usage, and collab calls from authoritative event types', () => {
  const jsonl = ['{"type":"thread.started","thread_id":"thread_123"}', '{"type":"turn.started"}', '{"type":"item.completed","item":{"id":"item_1","type":"reasoning","text":"Need to inspect files."}}', '{"type":"item.completed","item":{"id":"item_2","type":"collab_tool_call","tool":"spawn_agent","sender_thread_id":"thread_123","receiver_thread_ids":["thread_child"],"prompt":"Check tests","agents_states":{},"status":"completed"}}', '{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"Hi."}}', '{"type":"turn.completed","usage":{"input_tokens":1200,"cached_input_tokens":200,"output_tokens":50}}'].join('\n');

  const parsed = parseCodexExecJsonOutput(jsonl, {}, 'gpt-5.4');

  assert.equal(parsed.sessionId, 'thread_123');
  assert.equal(parsed.resultSummary, 'Hi.');
  assert.equal(parsed.tokenUsage.inputTokens, 1000);
  assert.equal(parsed.tokenUsage.cacheReadTokens, 200);
  assert.equal(parsed.tokenUsage.outputTokens, 50);
  assert.equal(parsed.tokenUsage.stepCount, 1);
  assert.equal(parsed.tokenUsage.tokenFieldAvailability.inputTokens, true);
  assert.equal(parsed.tokenUsage.tokenFieldAvailability.cacheReadTokens, true);
  assert.equal(parsed.tokenUsage.tokenFieldAvailability.outputTokens, true);
  assert.equal(parsed.tokenUsage.tokenFieldAvailability.cacheWriteTokens, false);
  assert.equal(parsed.reasoningSummaries.length, 1);
  assert.equal(parsed.subAgentCalls.length, 1);
  assert.equal(parsed.subAgentCalls[0].description, 'Check tests');
  assert.equal(parsed.subAgentCalls[0].model, 'gpt-5.4');
});

test('Codex exec JSON parser does not mark cache write as available when CLI does not emit it', () => {
  const jsonl = '{"type":"turn.completed","usage":{"input_tokens":433303,"cached_input_tokens":388480,"output_tokens":3031}}';
  const parsed = parseCodexExecJsonOutput(jsonl, {}, 'gpt-5.4');

  assert.equal(parsed.tokenUsage.inputTokens, 44823);
  assert.equal(parsed.tokenUsage.cacheReadTokens, 388480);
  assert.equal(parsed.tokenUsage.outputTokens, 3031);
  assert.equal(parsed.tokenUsage.peakContextUsage, 433303);
  assert.equal(parsed.tokenUsage.contextFillInputTokens, 44823);
  assert.deepEqual(parsed.observedUsageFieldSets, [['input_tokens', 'cached_input_tokens', 'output_tokens']]);
  assert.equal(parsed.tokenUsage.tokenFieldAvailability.cacheReadTokens, true);
  assert.equal(parsed.tokenUsage.tokenFieldAvailability.cacheWriteTokens, false);
});

test('Codex pricing uses OpenAI input, cached input, and output rates', () => {
  assert.equal(typeof calculateCodexPricingFromModelInfo, 'function');

  const pricing = calculateCodexPricingFromModelInfo(
    'gpt-5.4',
    {
      inputTokens: 42742,
      cacheReadTokens: 885376,
      cacheWriteTokens: 0,
      outputTokens: 4784,
      reasoningTokens: 0,
      peakContextUsage: 200000,
    },
    {
      name: 'GPT-5.4',
      provider: 'OpenAI',
      cost: { input: 2.5, cache_read: 0.25, output: 15 },
      limit: { context: 1050000, output: 128000 },
    }
  );

  assert.equal(pricing.modelName, 'GPT-5.4');
  assert.equal(pricing.provider, 'OpenAI');
  assert.equal(pricing.totalCostUSD.toFixed(6), '0.399959');
});

test('Codex pricing applies long-context rates when peak prompt exceeds OpenAI threshold', () => {
  const pricing = calculateCodexPricingFromModelInfo(
    'gpt-5.4',
    {
      inputTokens: 1000,
      cacheReadTokens: 1000,
      cacheWriteTokens: 0,
      outputTokens: 1000,
      reasoningTokens: 0,
      peakContextUsage: 300000,
    },
    {
      name: 'GPT-5.4',
      provider: 'OpenAI',
      cost: {
        input: 2.5,
        cache_read: 0.25,
        output: 15,
        context_over_200k: { input: 5, cache_read: 0.5, output: 22.5 },
      },
      limit: { context: 1050000, output: 128000 },
    }
  );

  assert.equal(pricing.usesLongContextPricing, true);
  assert.equal(pricing.pricing.inputPerMillion, 5);
  assert.equal(pricing.totalCostUSD.toFixed(6), '0.028000');
});

test('Codex exec JSON parser captures optional nested cache write and reasoning fields when emitted', () => {
  const jsonl = '{"type":"turn.completed","usage":{"input_tokens":1200,"cached_input_tokens":200,"cache_write_tokens":0,"output_tokens":50,"output_tokens_details":{"reasoning_tokens":10}}}';
  const parsed = parseCodexExecJsonOutput(jsonl, {}, 'gpt-5.4');

  assert.equal(parsed.tokenUsage.inputTokens, 1000);
  assert.equal(parsed.tokenUsage.cacheReadTokens, 200);
  assert.equal(parsed.tokenUsage.cacheWriteTokens, 0);
  assert.equal(parsed.tokenUsage.outputTokens, 50);
  assert.equal(parsed.tokenUsage.reasoningTokens, 10);
  assert.equal(parsed.tokenUsage.tokenFieldAvailability.cacheWriteTokens, true);
  assert.equal(parsed.tokenUsage.tokenFieldAvailability.reasoningTokens, true);
  assert.deepEqual(parsed.observedUsageFieldSets, [['input_tokens', 'cached_input_tokens', 'output_tokens', 'cache_write_tokens', 'output_tokens_details.reasoning_tokens']]);

  const costInfo = buildCostInfoString(null, null, {
    modelName: 'gpt-5.4',
    provider: 'OpenAI',
    tokenUsage: parsed.tokenUsage,
  });
  assert.match(costInfo, /10 reasoning/);
  assert.match(costInfo, /0 cache write/);
});

test('Codex exec parser turns compact diagnostics into sub-session usage rows', () => {
  const output = [
    '[2026-06-12T21:21:49.135Z] [INFO] 2026-06-12T21:21:49.135056Z  INFO session_init: codex_otel.log_only: event.name="codex.conversation_starts" context_window=200000 auto_compact_token_limit=125000 event.timestamp=2026-06-12T21:21:49.135Z conversation.id=thread_issue_1912 app.version=0.139.0 originator=codex_exec model=gpt-5.5 slug=gpt-5.5',
    '{"type":"thread.started","thread_id":"thread_issue_1912"}',
    '[2026-06-12T21:30:31.355Z] [INFO] 2026-06-12T21:30:31.354832Z  INFO turn:endpoint_session.execute_with{http.method=POST api.path="responses/compact"}: codex_otel.log_only: event.name="codex.api_request" http.response.status_code=200 endpoint="/responses/compact" event.timestamp=2026-06-12T21:30:31.354Z conversation.id=thread_issue_1912 app.version=0.139.0 model=gpt-5.5',
    '[2026-06-12T21:40:46.641Z] [INFO] 2026-06-12T21:40:46.641228Z  INFO turn:endpoint_session.execute_with{http.method=POST api.path="responses/compact"}: codex_otel.log_only: event.name="codex.api_request" http.response.status_code=200 endpoint="/responses/compact" event.timestamp=2026-06-12T21:40:46.641Z conversation.id=thread_issue_1912 app.version=0.139.0 model=gpt-5.5',
    '{"type":"turn.completed","usage":{"input_tokens":7996733,"cached_input_tokens":7642624,"output_tokens":57353,"reasoning_output_tokens":21471}}',
  ].join('\n');

  const parsed = parseCodexExecJsonOutput(output, {}, 'gpt-5.5');

  assert.equal(parsed.tokenUsage.inputTokens, 354109);
  assert.equal(parsed.tokenUsage.cacheReadTokens, 7642624);
  assert.equal(parsed.tokenUsage.outputTokens, 57353);
  assert.equal(parsed.tokenUsage.reasoningTokens, 21471);
  assert.equal(parsed.tokenUsage.contextLimit, 200000);
  assert.equal(parsed.tokenUsage.autoCompactTokenLimit, 125000);
  assert.equal(parsed.tokenUsage.compactifications.length, 2);
  assert.deepEqual(
    parsed.tokenUsage.compactifications.map(compact => compact.timestamp),
    ['2026-06-12T21:30:31.354Z', '2026-06-12T21:40:46.641Z']
  );
  assert.equal(parsed.tokenUsage.subSessions.length, 3);
  assert.deepEqual(
    parsed.tokenUsage.subSessions.map(session => session.inputTokens),
    [125000, 125000, 104109]
  );
  assert.equal(
    parsed.tokenUsage.subSessions.reduce((sum, session) => sum + session.inputTokens, 0),
    parsed.tokenUsage.inputTokens
  );

  const budgetStatsData = buildAgentBudgetStats(parsed.tokenUsage, {
    modelId: 'gpt-5.5',
    modelName: 'GPT-5.5',
    modelInfo: { limit: { context: 200000, output: 128000 } },
    totalCostUSD: null,
  });
  const renderedStats = buildBudgetStatsString(budgetStatsData);
  assert.equal(budgetStatsData.subSessions.length, 3);
  assert.match(renderedStats, /\*\*GPT-5\.5:\*\* \(3 sub-sessions\)/);
  assert.match(renderedStats, /1\. ~125K \/ 200K \(63%\) input tokens/);
  assert.match(renderedStats, /_Sub-session values are estimates from observed compact events/);
});

test('Codex exec JSON parser captures remaining supported item payloads', () => {
  const jsonl = [
    '{"type":"item.started","item":{"id":"cmd_1","type":"command_execution","command":"npm test","aggregated_output":"","exit_code":null,"status":"in_progress"}}',
    '{"type":"item.completed","item":{"id":"cmd_1","type":"command_execution","command":"npm test","aggregated_output":"ok","exit_code":0,"status":"completed"}}',
    '{"type":"item.completed","item":{"id":"fc_1","type":"file_change","changes":[{"path":"src/a.js","kind":"update"},{"path":"src/b.js","kind":"add"}],"status":"completed"}}',
    '{"type":"item.completed","item":{"id":"mcp_1","type":"mcp_tool_call","server":"github","tool":"search","arguments":{"q":"bug"},"result":{"content":[{"type":"text","text":"x"}],"structured_content":{"ok":true}},"error":null,"status":"completed"}}',
    '{"type":"item.completed","item":{"id":"ws_1","type":"web_search","query":"codex cli","action":"search"}}',
    '{"type":"item.completed","item":{"id":"todo_1","type":"todo_list","items":[{"text":"Inspect","completed":true},{"text":"Patch","completed":false}]}}',
    '{"type":"item.completed","item":{"id":"err_1","type":"error","message":"tool failed"}}',
    '{"type":"turn.failed","error":{"message":"temporary failure"}}',
    '{"type":"error","message":"stream warning"}}'.slice(0, -1),
  ].join('\n');

  const parsed = parseCodexExecJsonOutput(jsonl, {}, 'gpt-5.4');

  assert.equal(parsed.commandExecutions.length, 1);
  assert.equal(parsed.commandExecutions[0].status, 'completed');
  assert.equal(parsed.commandExecutions[0].exitCode, 0);
  assert.equal(parsed.fileChanges.length, 1);
  assert.equal(parsed.fileChanges[0].changes.length, 2);
  assert.equal(parsed.mcpToolCalls.length, 1);
  assert.equal(parsed.mcpToolCalls[0].server, 'github');
  assert.equal(parsed.webSearches.length, 1);
  assert.equal(parsed.webSearches[0].query, 'codex cli');
  assert.equal(parsed.todoLists.length, 1);
  assert.equal(parsed.todoLists[0].items.length, 2);
  assert.equal(parsed.itemErrors.length, 1);
  assert.equal(parsed.turnFailures.length, 1);
  assert.equal(parsed.streamErrors.length, 1);
});

test('Codex error summary unwraps unsupported ChatGPT-account model errors', () => {
  const message = JSON.stringify({
    type: 'error',
    status: 400,
    error: {
      type: 'invalid_request_error',
      message: "The 'gpt-5.5-mini' model is not supported when using Codex with a ChatGPT account.",
    },
  });
  const jsonl = [`{"type":"error","message":${JSON.stringify(message)}}`, `{"type":"turn.failed","error":{"message":${JSON.stringify(message)}}}`].join('\n');

  const parsed = parseCodexExecJsonOutput(jsonl, {}, 'gpt-5.5-mini');
  const summary = getCodexErrorEventSummary(parsed);

  assert.equal(summary.hasError, true);
  assert.equal(summary.counts.stream, 1);
  assert.equal(summary.counts.turn, 1);
  assert.match(summary.message, /gpt-5\.5-mini/);
  assert.match(summary.message, /ChatGPT account/);
});

test('Codex error summary ignores non-fatal app-server stream lag item errors', () => {
  const jsonl = ['{"type":"thread.started","thread_id":"thread_issue_1696"}', '{"type":"item.completed","item":{"id":"item_115","type":"error","message":"in-process app-server event stream lagged; dropped 133 events"}}', '{"type":"item.completed","item":{"id":"item_116","type":"error","message":"in-process app-server event stream lagged; dropped 1 events"}}', '{"type":"turn.completed","usage":{"input_tokens":1200,"cached_input_tokens":200,"output_tokens":50}}'].join('\n');

  const parsed = parseCodexExecJsonOutput(jsonl, {}, 'gpt-5.5');
  const summary = getCodexErrorEventSummary(parsed);

  assert.equal(parsed.itemErrors.length, 2);
  assert.equal(summary.hasError, false);
  assert.equal(summary.counts.item, 0);
  assert.equal(summary.observedCounts.item, 2);
  assert.equal(summary.ignoredCounts.item, 2);
  assert.equal(summary.ignoredEvents[0].type, 'item');
});

await asyncTest('Codex command fails when JSON error events are emitted with exit code 0', async () => {
  const message = JSON.stringify({
    type: 'error',
    status: 400,
    error: {
      type: 'invalid_request_error',
      message: "The 'gpt-5.5-mini' model is not supported when using Codex with a ChatGPT account.",
    },
  });
  const jsonl = [`{"type":"thread.started","thread_id":"thread_issue_1660"}`, `{"type":"error","message":${JSON.stringify(message)}}`, `{"type":"turn.failed","error":{"message":${JSON.stringify(message)}}}`].join('\n');
  const logLines = [];
  const fakeDollar = () => () => ({
    async *stream() {
      yield { type: 'stdout', data: Buffer.from(jsonl) };
      yield { type: 'exit', code: 0 };
    },
  });

  const result = await executeCodexCommand({
    tempDir: process.cwd(),
    branchName: 'issue-1660-test',
    prompt: 'test prompt',
    systemPrompt: '',
    argv: { model: 'gpt-5.5-mini', verbose: false },
    log: async message => {
      logLines.push(String(message));
    },
    formatAligned: (icon, label, value = '') => `${icon} ${label} ${value}`,
    getResourceSnapshot: async () => ({ memory: 'Mem:\n  100 MB available', load: '0.00' }),
    forkedRepo: null,
    feedbackLines: [],
    codexPath: 'codex',
    $: fakeDollar,
    owner: null,
    repo: null,
    prNumber: null,
    calculatePricing: async () => null,
  });

  assert.equal(result.success, false);
  assert.equal(result.limitReached, false);
  assert.equal(result.sessionId, 'thread_issue_1660');
  assert.equal(result.errorInfo.hasError, true);
  assert.match(result.errorInfo.message, /not supported/);
  assert.ok(
    logLines.some(line => line.includes('Codex emitted error event')),
    'Should log the Codex error as fatal'
  );
});

await asyncTest('Codex command succeeds when only non-fatal app-server stream lag item errors are emitted', async () => {
  const jsonl = ['{"type":"thread.started","thread_id":"thread_issue_1696"}', '{"type":"item.completed","item":{"id":"item_115","type":"error","message":"in-process app-server event stream lagged; dropped 133 events"}}', '{"type":"item.completed","item":{"id":"item_116","type":"agent_message","text":"Done. PR is ready for review."}}', '{"type":"turn.completed","usage":{"input_tokens":1200,"cached_input_tokens":200,"output_tokens":50}}'].join('\n');
  const logLines = [];
  const fakeDollar = () => () => ({
    async *stream() {
      yield { type: 'stdout', data: Buffer.from(jsonl) };
      yield { type: 'exit', code: 0 };
    },
  });

  const result = await executeCodexCommand({
    tempDir: process.cwd(),
    branchName: 'issue-1696-test',
    prompt: 'test prompt',
    systemPrompt: '',
    argv: { model: 'gpt-5.5', verbose: false },
    log: async message => {
      logLines.push(String(message));
    },
    formatAligned: (icon, label, value = '') => `${icon} ${label} ${value}`,
    getResourceSnapshot: async () => ({ memory: 'Mem:\n  100 MB available', load: '0.00' }),
    forkedRepo: null,
    feedbackLines: [],
    codexPath: 'codex',
    $: fakeDollar,
    owner: null,
    repo: null,
    prNumber: null,
    calculatePricing: async () => null,
  });

  assert.equal(result.success, true);
  assert.equal(result.sessionId, 'thread_issue_1696');
  assert.equal(result.resultSummary, 'Done. PR is ready for review.');
  assert.ok(!logLines.some(line => line.includes('Codex emitted error event')), 'Non-fatal app-server lag warnings should not be logged as fatal Codex errors');
});

await asyncTest('Codex command parses compact diagnostics from stderr stream chunks', async () => {
  const stderr = ['[2026-06-12T21:21:49.135Z] [INFO] 2026-06-12T21:21:49.135056Z  INFO session_init: codex_otel.log_only: event.name="codex.conversation_starts" context_window=200000 auto_compact_token_limit=125000 event.timestamp=2026-06-12T21:21:49.135Z conversation.id=thread_issue_1912 app.version=0.139.0 originator=codex_exec model=gpt-5.5 slug=gpt-5.5', '[2026-06-12T21:30:31.355Z] [INFO] 2026-06-12T21:30:31.354832Z  INFO turn:endpoint_session.execute_with{http.method=POST api.path="responses/compact"}: codex_otel.log_only: event.name="codex.api_request" http.response.status_code=200 endpoint="/responses/compact" event.timestamp=2026-06-12T21:30:31.354Z conversation.id=thread_issue_1912 app.version=0.139.0 model=gpt-5.5'].join('\n');
  const stdout = ['{"type":"thread.started","thread_id":"thread_issue_1912"}', '{"type":"item.completed","item":{"id":"msg_1","type":"agent_message","text":"Done."}}', '{"type":"turn.completed","usage":{"input_tokens":300000,"cached_input_tokens":50000,"output_tokens":1200}}'].join('\n');
  const fakeDollar = () => () => ({
    async *stream() {
      yield { type: 'stderr', data: Buffer.from(stderr) };
      yield { type: 'stdout', data: Buffer.from(stdout) };
      yield { type: 'exit', code: 0 };
    },
  });

  const result = await executeCodexCommand({
    tempDir: process.cwd(),
    branchName: 'issue-1912-test',
    prompt: 'test prompt',
    systemPrompt: '',
    argv: { model: 'gpt-5.5', verbose: false },
    log: async () => {},
    formatAligned: (icon, label, value = '') => `${icon} ${label} ${value}`,
    getResourceSnapshot: async () => ({ memory: 'Mem:\n  100 MB available', load: '0.00' }),
    forkedRepo: null,
    feedbackLines: [],
    codexPath: 'codex',
    $: fakeDollar,
    owner: null,
    repo: null,
    prNumber: null,
    calculatePricing: async (modelId, tokenUsage) => ({
      modelId,
      modelName: modelId,
      modelInfo: { limit: { context: 200000, output: 128000 } },
      totalCostUSD: 0,
      tokenUsage,
    }),
  });

  assert.equal(result.success, true);
  assert.equal(result.sessionId, 'thread_issue_1912');
  assert.equal(result.pricingInfo.tokenUsage.compactifications.length, 1);
  assert.equal(result.pricingInfo.tokenUsage.subSessions.length, 2);
  assert.deepEqual(
    result.pricingInfo.tokenUsage.subSessions.map(session => session.inputTokens),
    [125000, 125000]
  );
});

await asyncTest('Codex retries the same model on capacity errors before falling back, then switches', async () => {
  // Issue #2037 (review): a capacity error must first retry the *originally requested*
  // model up to capacityRetriesBeforeFallback (default 5) times with exponential
  // backoff. Only once those are exhausted does it switch to the next-closest fallback.
  const capacityBudget = retryLimits.capacityRetriesBeforeFallback;
  const commands = [];
  let attempt = 0;
  const capacityChunk = Buffer.from(['{"type":"thread.started","thread_id":"thread_capacity_1666"}', '{"type":"error","message":"Selected model is at capacity. Please try a different model."}', '{"type":"turn.failed","error":{"message":"Selected model is at capacity. Please try a different model."}}'].join('\n'));
  const recoveredChunk = Buffer.from(['{"type":"thread.started","thread_id":"thread_capacity_1666"}', '{"type":"turn.started"}', '{"type":"item.completed","item":{"id":"msg_1","type":"agent_message","text":"Recovered after fallback."}}', '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}'].join('\n'));
  const fakeDollar =
    options =>
    (strings, ...values) => {
      commands.push(renderTaggedTemplateCommand(strings, values));
      const currentAttempt = attempt++;
      return {
        async *stream() {
          // Fail with a capacity error for the initial attempt plus every same-model
          // retry (capacityBudget of them); the attempt after the switch succeeds.
          const failCount = capacityBudget + 1;
          yield { type: 'stdout', data: currentAttempt < failCount ? capacityChunk : recoveredChunk };
          yield { type: 'exit', code: 0 };
        },
        result: { code: 0 },
      };
    };

  const delaysSeen = [];
  const result = await executeCodexCommand({
    tempDir: process.cwd(),
    branchName: 'issue-1666-test',
    prompt: 'test prompt',
    systemPrompt: '',
    argv: { model: 'gpt-5.5', verbose: false },
    log: async () => {},
    formatAligned: (icon, label, value = '') => `${icon} ${label} ${value}`,
    getResourceSnapshot: async () => ({ memory: 'Mem:\n  100 MB available', load: '0.00' }),
    forkedRepo: null,
    feedbackLines: [],
    codexPath: 'codex',
    $: fakeDollar,
    owner: null,
    repo: null,
    prNumber: null,
    calculatePricing: async () => null,
    waitForRetryDelay: async delay => {
      delaysSeen.push(delay);
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.sessionId, 'thread_capacity_1666');
  // 1 initial + capacityBudget same-model retries + 1 switched retry = capacityBudget + 2.
  assert.equal(commands.length, capacityBudget + 2);
  assert.ok(commands[0].includes('--model "gpt-5.5"'), `Expected first attempt to use gpt-5.5, got: ${commands[0]}`);
  // All same-model retries stay on gpt-5.5 (the originally requested model).
  for (let i = 1; i <= capacityBudget; i++) {
    assert.ok(commands[i].includes('--model "gpt-5.5"'), `Expected same-model retry ${i} to stay on gpt-5.5, got: ${commands[i]}`);
  }
  // Only after exhausting the same-model retries do we switch to the closest fallback.
  assert.ok(commands[capacityBudget + 1].includes('--model "gpt-5.4"'), `Expected the retry after exhausting same-model retries to switch to gpt-5.4, got: ${commands[capacityBudget + 1]}`);
  // The same-model retries use exponential backoff; the post-switch retry is fast (5s).
  assert.equal(delaysSeen.length, capacityBudget + 1, `Expected ${capacityBudget + 1} retry delays, got: ${JSON.stringify(delaysSeen)}`);
  assert.equal(delaysSeen[delaysSeen.length - 1], retryLimits.modelSwitchRetryDelayMs, `Expected a fast model-switch delay after the switch, got: ${delaysSeen[delaysSeen.length - 1]}ms`);
});

await asyncTest('Codex command retries stream disconnects by resuming the same session', async () => {
  const commands = [];
  let attempt = 0;
  const disconnectMessage = ['stream disconnected before completion: An error occurred while processing your request.', 'You can retry your request, or contact us through our help center at help.openai.com if the error persists.', 'Please include the request ID 00f1ff7f-106b-4f1e-a689-122e886fcaae in your message.'].join(' ');
  const fakeDollar =
    options =>
    (strings, ...values) => {
      commands.push(renderTaggedTemplateCommand(strings, values));
      const currentAttempt = attempt++;
      return {
        async *stream() {
          if (currentAttempt === 0) {
            yield {
              type: 'stdout',
              data: Buffer.from([`{"type":"thread.started","thread_id":"thread_stream_1673"}`, `{"type":"error","message":${JSON.stringify(disconnectMessage)}}`, `{"type":"turn.failed","error":{"message":${JSON.stringify(disconnectMessage)}}}`].join('\n')),
            };
            yield { type: 'exit', code: 0 };
            return;
          }

          yield {
            type: 'stdout',
            // Issue #1990: a recovered codex turn always emits turn.completed; the
            // completion-health gate requires it before reporting success.
            data: Buffer.from(['{"type":"thread.started","thread_id":"thread_stream_1673"}', '{"type":"turn.started"}', '{"type":"item.completed","item":{"id":"msg_1","type":"agent_message","text":"Recovered after stream disconnect."}}', '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}'].join('\n')),
          };
          yield { type: 'exit', code: 0 };
        },
        result: { code: 0 },
      };
    };

  const result = await executeCodexCommand({
    tempDir: process.cwd(),
    branchName: 'issue-1673-test',
    prompt: 'test prompt',
    systemPrompt: '',
    argv: { model: 'gpt-5.5', verbose: false },
    log: async () => {},
    formatAligned: (icon, label, value = '') => `${icon} ${label} ${value}`,
    getResourceSnapshot: async () => ({ memory: 'Mem:\n  100 MB available', load: '0.00' }),
    forkedRepo: null,
    feedbackLines: [],
    codexPath: 'codex',
    $: fakeDollar,
    owner: null,
    repo: null,
    prNumber: null,
    calculatePricing: async () => null,
    waitForRetryDelay: async () => {},
  });

  assert.equal(result.success, true);
  assert.equal(result.sessionId, 'thread_stream_1673');
  assert.equal(commands.length, 2);
  assert.ok(commands[0].includes('--model "gpt-5.5"'), `Expected first attempt to use gpt-5.5, got: ${commands[0]}`);
  assert.ok(commands[1].includes('resume "thread_stream_1673" --model "gpt-5.5"'), `Expected retry to resume with same model, got: ${commands[1]}`);
});

await asyncTest('OpenCode resume uses --session so fallback retries can stay on the same session', async () => {
  const commands = [];
  const fakeDollar =
    options =>
    (strings, ...values) => {
      commands.push(renderTaggedTemplateCommand(strings, values));
      return {
        async *stream() {
          yield { type: 'exit', code: 0 };
        },
        result: { code: 0 },
      };
    };

  const result = await executeOpenCodeCommand({
    tempDir: process.cwd(),
    branchName: 'issue-1666-test',
    prompt: 'test prompt',
    systemPrompt: '',
    argv: { model: 'opencode/grok-code', resume: 'session-open-1666', verbose: false },
    log: async () => {},
    formatAligned: (icon, label, value = '') => `${icon} ${label} ${value}`,
    getResourceSnapshot: async () => ({ memory: 'Mem:\n  100 MB available', load: '0.00' }),
    forkedRepo: null,
    feedbackLines: [],
    opencodePath: 'opencode',
    $: fakeDollar,
  });

  assert.equal(result.success, true);
  assert.ok(
    commands.some(command => command.includes('opencode run --format json --session session-open-1666 --model opencode/grok-code')),
    `Expected --session resume command, got: ${commands.join('\n')}`
  );
});

await asyncTest('Agent resume uses --resume with --no-fork to preserve the same session', async () => {
  const commands = [];
  const fakeDollar =
    options =>
    (strings, ...values) => {
      commands.push(renderTaggedTemplateCommand(strings, values));
      return {
        async *stream() {
          yield { type: 'exit', code: 0 };
        },
        result: { code: 0 },
      };
    };

  const result = await executeAgentCommand({
    tempDir: process.cwd(),
    branchName: 'issue-1666-test',
    prompt: 'test prompt',
    systemPrompt: '',
    argv: { model: 'opencode/grok-code', resume: 'session-agent-1666', verbose: false },
    log: async () => {},
    formatAligned: (icon, label, value = '') => `${icon} ${label} ${value}`,
    getResourceSnapshot: async () => ({ memory: 'Mem:\n  100 MB available', load: '0.00' }),
    forkedRepo: null,
    feedbackLines: [],
    agentPath: 'agent',
    $: fakeDollar,
    calculatePricing: async (modelId, tokenUsage) => ({
      modelId,
      modelName: modelId,
      provider: 'OpenCode Zen',
      tokenUsage,
      totalCostUSD: 0,
    }),
  });

  assert.equal(result.success, true);
  assert.ok(
    commands.some(command => command.includes('agent --model opencode/grok-code --resume session-agent-1666 --no-fork')),
    `Expected --resume --no-fork command, got: ${commands.join('\n')}`
  );
});

await asyncTest('Agent live input uses stream-json stdin and parses Agent 0.24 idle events', async () => {
  const commands = [];
  const stdinWrites = [];
  const fakeStdin = {
    destroyed: false,
    writableEnded: false,
    closed: false,
    write(chunk) {
      stdinWrites.push(String(chunk));
      return true;
    },
  };
  const fakeDollar = (first, ...rest) => {
    const run = (strings, values) => {
      const command = renderTaggedTemplateCommand(strings, values);
      commands.push(command);

      if (command.includes('gh api')) {
        if (command.includes('--jq')) {
          return Promise.resolve({ code: 0, stdout: JSON.stringify({ title: 'Existing title', body: 'Existing body' }) });
        }
        return Promise.resolve({ code: 0, stdout: '[]' });
      }

      return {
        streams: { stdin: Promise.resolve(fakeStdin) },
        async *stream() {
          yield {
            type: 'stdout',
            data: Buffer.from(['{"type":"init","session_id":"agent_live_2007"}', '{"type":"message","session_id":"agent_live_2007","content":[{"type":"text","text":"Done live."}]}', '{"type":"result","status":"success","session_id":"agent_live_2007"}', '{"type":"idle","session_id":"agent_live_2007"}'].join('\n')),
          };
          yield { type: 'exit', code: 0 };
        },
        result: { code: 0 },
      };
    };

    if (Array.isArray(first) && Object.prototype.hasOwnProperty.call(first, 'raw')) {
      return run(first, rest);
    }
    return (strings, ...values) => run(strings, values);
  };

  const result = await executeAgentCommand({
    tempDir: process.cwd(),
    branchName: 'issue-2007-test',
    prompt: 'user prompt',
    systemPrompt: 'system prompt',
    owner: 'o',
    repo: 'r',
    issueNumber: 11,
    prNumber: 22,
    argv: {
      model: 'opencode/grok-code',
      tool: 'agent',
      verbose: false,
      acceptIncommingCommentsAsInput: true,
      queueCommentsToInput: true,
      autoInputUntilMergeable: true,
    },
    log: async () => {},
    formatAligned: (icon, label, value = '') => `${icon} ${label} ${value}`,
    getResourceSnapshot: async () => ({ memory: 'Mem:\n  100 MB available', load: '0.00' }),
    forkedRepo: null,
    feedbackLines: [],
    agentPath: 'agent',
    $: fakeDollar,
    calculatePricing: async (modelId, tokenUsage) => ({
      modelId,
      modelName: modelId,
      provider: 'OpenCode Zen',
      tokenUsage,
      totalCostUSD: 0,
    }),
  });

  assert.equal(result.success, true);
  assert.equal(result.sessionId, 'agent_live_2007');
  assert.equal(result.resultSummary, 'Done live.');
  const agentCommand = commands.find(command => command.includes('agent --model opencode/grok-code'));
  assert.ok(agentCommand, `Expected Agent command, got: ${commands.join('\n')}`);
  assert.ok(agentCommand.includes('--input-format stream-json'), `Expected stream-json input flag, got: ${agentCommand}`);
  assert.ok(agentCommand.includes('--output-format stream-json'), `Expected stream-json output flag, got: ${agentCommand}`);
  assert.ok(!agentCommand.includes('cat '), `Live input should not pipe a prompt file, got: ${agentCommand}`);
  const stdinPayload = stdinWrites.join('');
  assert.match(stdinPayload, /"type":"user"/);
  assert.match(stdinPayload, /system prompt/);
  assert.match(stdinPayload, /user prompt/);
});

test('Codex result model usage uses parsed token usage in shared budget-stats shape', () => {
  const tokenUsage = {
    inputTokens: 1000,
    outputTokens: 50,
    reasoningTokens: 0,
    cacheReadTokens: 200,
    cacheWriteTokens: 0,
    totalTokens: 1250,
    stepCount: 1,
  };

  const resultModelUsage = buildCodexResultModelUsage('gpt-5.4', tokenUsage, { modelName: 'gpt-5.4' });

  assert.deepEqual(resultModelUsage, {
    'gpt-5.4': {
      inputTokens: 1000,
      cacheCreationTokens: 0,
      cacheReadTokens: 200,
      outputTokens: 50,
      modelName: 'gpt-5.4',
      modelInfo: null,
      contextFillInputTokens: 1000,
      peakContextUsage: 0,
      costUSD: null,
    },
  });
});

console.log(`\nPassed: ${passed}  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
