#!/usr/bin/env node

import assert from 'node:assert/strict';

const { defaultModels, primaryModelNames, resolveDefaultFallbackModel, resolveModelId, resolveRuntimeDefaultModel, validateModelName } = await import('../src/models/index.mjs');
const { resolveCodexReasoningEffort } = await import('../src/codex.options.lib.mjs');
const { parseCodexExecJsonOutput, getCodexErrorEventSummary, executeCodexCommand, buildCodexResultModelUsage, calculateCodexPricingFromModelInfo } = await import('../src/codex.lib.mjs');
const { executeOpenCodeCommand } = await import('../src/opencode.lib.mjs');
const { executeAgentCommand } = await import('../src/agent.lib.mjs');
const { classifyRetryableError } = await import('../src/tool-retry.lib.mjs');
const { buildCostInfoString } = await import('../src/github-cost-info.lib.mjs');

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

test('Codex preferred default model is gpt-5.5', () => {
  assert.equal(defaultModels.codex, 'gpt-5.5');
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

test('Codex primary model names prioritize gpt-5.5 and current visible catalog entries', () => {
  assert.deepEqual(primaryModelNames.codex, ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark']);
});

await asyncTest('Codex runtime default stays on gpt-5.5 when the local catalog includes it', async () => {
  const result = await resolveRuntimeDefaultModel('codex', {
    availableCodexModels: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'],
  });
  assert.equal(result, 'gpt-5.5');
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

test('Claude default fallback model resolves from opus to opus-4-6', () => {
  assert.equal(resolveDefaultFallbackModel('claude', 'opus'), 'opus-4-6');
});

test('Models without configured defaults keep fallback unset', () => {
  assert.equal(resolveDefaultFallbackModel('codex', 'gpt-5.4'), null);
  assert.equal(resolveDefaultFallbackModel('agent', 'opencode/grok-code'), null);
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

test('Codex --think xhigh maps to xhigh reasoning', () => {
  const result = resolveCodexReasoningEffort({ think: 'xhigh' });
  assert.equal(result.reasoningEffort, 'xhigh');
});

test('Codex --think max maps to xhigh reasoning', () => {
  const result = resolveCodexReasoningEffort({ think: 'max' });
  assert.equal(result.reasoningEffort, 'xhigh');
});

test('Codex --thinking-budget exposes minimal reasoning tier', () => {
  const result = resolveCodexReasoningEffort({ thinkingBudget: 1000, maxThinkingBudget: 10000 });
  assert.equal(result.reasoningEffort, 'minimal');
});

test('Codex --thinking-budget exposes high reasoning tier', () => {
  const result = resolveCodexReasoningEffort({ thinkingBudget: 7500, maxThinkingBudget: 10000 });
  assert.equal(result.reasoningEffort, 'high');
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

await asyncTest('Codex command retries with resume and fallback model after capacity error', async () => {
  const commands = [];
  let attempt = 0;
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
              data: Buffer.from(['{"type":"thread.started","thread_id":"thread_capacity_1666"}', '{"type":"error","message":"Selected model is at capacity. Please try a different model."}', '{"type":"turn.failed","error":{"message":"Selected model is at capacity. Please try a different model."}}'].join('\n')),
            };
            yield { type: 'exit', code: 0 };
            return;
          }

          yield {
            type: 'stdout',
            data: Buffer.from(['{"type":"thread.started","thread_id":"thread_capacity_1666"}', '{"type":"item.completed","item":{"id":"msg_1","type":"agent_message","text":"Recovered after fallback."}}'].join('\n')),
          };
          yield { type: 'exit', code: 0 };
        },
        result: { code: 0 },
      };
    };

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
    waitForRetryDelay: async () => {},
  });

  assert.equal(result.success, true);
  assert.equal(result.sessionId, 'thread_capacity_1666');
  assert.equal(commands.length, 2);
  assert.ok(commands[0].includes('--model "gpt-5.5"'), `Expected first attempt to use gpt-5.5, got: ${commands[0]}`);
  assert.ok(commands[1].includes('resume "thread_capacity_1666" --model "gpt-5.4"'), `Expected retry to resume with gpt-5.4, got: ${commands[1]}`);
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
            data: Buffer.from(['{"type":"thread.started","thread_id":"thread_stream_1673"}', '{"type":"item.completed","item":{"id":"msg_1","type":"agent_message","text":"Recovered after stream disconnect."}}'].join('\n')),
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
  });

  assert.equal(result.success, true);
  assert.ok(
    commands.some(command => command.includes('agent --model opencode/grok-code --resume session-agent-1666 --no-fork')),
    `Expected --resume --no-fork command, got: ${commands.join('\n')}`
  );
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
