#!/usr/bin/env node

import assert from 'node:assert/strict';

const { defaultModels, primaryModelNames, resolveModelId } = await import('../src/models/index.mjs');
const { resolveCodexReasoningEffort } = await import('../src/codex.options.lib.mjs');
const { parseCodexExecJsonOutput, buildCodexResultModelUsage } = await import('../src/codex.lib.mjs');

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

test('Codex default model is gpt-5.4', () => {
  assert.equal(defaultModels.codex, 'gpt-5.4');
});

test('Codex resolves gpt-5.4 model id', () => {
  assert.equal(resolveModelId('gpt-5.4', 'codex'), 'gpt-5.4');
});

test('Codex primary model names include gpt-5.3-codex and exclude removed legacy entries', () => {
  assert.deepEqual(primaryModelNames.codex, ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.2-codex']);
});

test('Codex --think max maps to xhigh reasoning', () => {
  const result = resolveCodexReasoningEffort({ think: 'max' });
  assert.equal(result.reasoningEffort, 'xhigh');
});

test('Codex --think xhigh maps to xhigh reasoning', () => {
  const result = resolveCodexReasoningEffort({ think: 'xhigh' });
  assert.equal(result.reasoningEffort, 'xhigh');
});

test('Codex --think off maps to none reasoning', () => {
  const result = resolveCodexReasoningEffort({ think: 'off' });
  assert.equal(result.reasoningEffort, 'none');
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
  assert.equal(parsed.reasoningSummaries.length, 1);
  assert.equal(parsed.subAgentCalls.length, 1);
  assert.equal(parsed.subAgentCalls[0].description, 'Check tests');
  assert.equal(parsed.subAgentCalls[0].model, 'gpt-5.4');
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
      peakContextUsage: 0,
      costUSD: null,
    },
  });
});

console.log(`\nPassed: ${passed}  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
