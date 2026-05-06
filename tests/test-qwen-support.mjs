#!/usr/bin/env node

/**
 * Tests for direct Qwen Code CLI support.
 *
 * Issue #513 requires invoking the qwen CLI directly and preferring structured
 * output over plain text where the CLI supports it.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fsModule = await import('node:fs');
const pathModule = await import('node:path');
const osModule = await import('node:os');

globalThis.use = async name => {
  if (name === 'command-stream') return { $: () => ({ stream: async function* noopStream() {} }) };
  if (name === 'fs') return { ...fsModule, default: fsModule };
  if (name === 'path') return { ...pathModule, default: pathModule };
  if (name === 'os') return { ...osModule, default: osModule };
  return await import(name);
};

const { defaultModels, getToolDisplayName, isModelCompatibleWithTool, mapModelForTool, resolveModelId, resolveRuntimeDefaultModel } = await import('../src/models/index.mjs');
const { executeQwenCommand, parseQwenStreamJsonOutput } = await import('../src/qwen.lib.mjs');

let testsPassed = 0;
let testsFailed = 0;

const test = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.stack || error.message}`);
    testsFailed++;
  }
};

const buildFakeDollar = responses => {
  const calls = [];
  const fakeDollar =
    options =>
    (strings, ...values) => {
      calls.push({
        options,
        strings: [...strings],
        values,
        command: strings.reduce((command, part, index) => command + part + (index < values.length ? values[index] : ''), ''),
      });
      const response = responses.shift() || { chunks: [], code: 0 };
      return {
        async *stream() {
          for (const chunk of response.chunks || []) {
            yield chunk;
          }
          yield { type: 'exit', code: response.code ?? 0 };
        },
      };
    };
  fakeDollar.calls = calls;
  return fakeDollar;
};

const buildExecutionParams = overrides => ({
  tempDir: mkdtempSync(join(tmpdir(), 'qwen-support-test-')),
  branchName: 'issue-513-c2f93fb5',
  prompt: 'Fix the issue',
  systemPrompt: 'Use structured output',
  argv: {
    model: 'qwen',
    url: 'https://github.com/link-assistant/hive-mind/issues/513',
    verbose: false,
    ...overrides?.argv,
  },
  log: async message => overrides?.logs?.push(String(message)),
  formatAligned: (_icon, label, value = '') => `${label} ${value}`.trim(),
  getResourceSnapshot: async () => ({ memory: '\nMem: 1 2', load: '0.00' }),
  waitForRetryDelay: async () => {},
  ...overrides,
});

await test('Qwen model registry maps defaults and aliases', async () => {
  assert.equal(defaultModels.qwen, 'qwen3-coder-plus');
  assert.equal(await resolveRuntimeDefaultModel('qwen'), 'qwen3-coder-plus');
  assert.equal(resolveModelId('qwen', 'qwen'), 'qwen3-coder-plus');
  assert.equal(mapModelForTool('qwen', 'qwen-coder'), 'qwen3-coder-plus');
  assert.equal(isModelCompatibleWithTool('qwen', 'qwen3-coder-plus'), true);
  assert.equal(getToolDisplayName('qwen'), 'Qwen Code');
});

await test('Qwen stream-json parser extracts session, result, and error events', async () => {
  let state = parseQwenStreamJsonOutput('{"type":"session.started","session_id":"session-513"}\n');
  state = parseQwenStreamJsonOutput('{"type":"result","result":"fixed"}\n{"type":"error","error":{"message":"boom"}}\n', state);

  assert.equal(state.sessionId, 'session-513');
  assert.equal(state.lastTextContent, 'fixed');
  assert.equal(state.eventCounts['session.started'], 1);
  assert.equal(state.eventCounts.result, 1);
  assert.equal(state.errors.length, 1);
  assert.equal(state.errors[0].message, 'boom');
});

await test('Qwen stream-json parser extracts issue #1741 context-fill usage when emitted', async () => {
  const state = parseQwenStreamJsonOutput('{"type":"result","result":"fixed","usage":{"model":"qwen3-coder-plus","inputTokens":94,"cacheWriteTokens":61200,"cacheReadTokens":1100000,"outputTokens":6600,"contextLimit":200000,"outputLimit":64000}}\n');

  assert.equal(state.tokenUsage.stepCount, 1);
  assert.equal(state.tokenUsage.inputTokens, 94);
  assert.equal(state.tokenUsage.cacheWriteTokens, 61_200);
  assert.equal(state.tokenUsage.cacheReadTokens, 1_100_000);
  assert.equal(state.tokenUsage.contextFillInputTokens, 61_294);
  assert.equal(state.tokenUsage.peakContextUsage, 1_161_294);
  assert.equal(state.resultModelUsage['qwen3-coder-plus'].contextFillInputTokens, 61_294);
});

await test('executeQwenCommand invokes qwen with stream-json and prompt files', async () => {
  const logs = [];
  const fakeDollar = buildFakeDollar([
    {
      chunks: [
        {
          type: 'stdout',
          data: Buffer.from('{"type":"session.started","session_id":"session-513"}\n{"type":"result","result":"Final answer.","usage":{"model":"qwen3-coder-plus","inputTokens":94,"cacheWriteTokens":61200,"cacheReadTokens":1100000,"outputTokens":6600,"contextLimit":200000,"outputLimit":64000}}\n'),
        },
      ],
      code: 0,
    },
  ]);
  const params = buildExecutionParams({ logs, $: fakeDollar });

  try {
    const result = await executeQwenCommand(params);
    const commandScript = fakeDollar.calls[0].values[0];

    assert.equal(result.success, true);
    assert.equal(result.sessionId, 'session-513');
    assert.equal(result.resultSummary, 'Final answer.');
    assert.equal(result.pricingInfo.tokenUsage.contextFillInputTokens, 61_294);
    assert.equal(result.resultModelUsage['qwen3-coder-plus'].contextFillInputTokens, 61_294);
    assert.match(commandScript, /qwen/);
    assert.match(commandScript, /--model 'qwen3-coder-plus'/);
    assert.match(commandScript, /--output-format stream-json/);
    assert.match(commandScript, /--yolo/);
    assert.match(commandScript, /--append-system-prompt/);
    assert.match(commandScript, /--prompt/);
  } finally {
    rmSync(params.tempDir, { recursive: true, force: true });
  }
});

await test('executeQwenCommand passes resume session to qwen', async () => {
  const fakeDollar = buildFakeDollar([{ chunks: [{ type: 'stdout', data: Buffer.from('{"type":"result","result":"done"}\n') }], code: 0 }]);
  const params = buildExecutionParams({
    $: fakeDollar,
    argv: {
      model: 'qwen3-coder-plus',
      resume: 'session-existing',
      url: 'https://github.com/link-assistant/hive-mind/issues/513',
      verbose: false,
    },
  });

  try {
    const result = await executeQwenCommand(params);
    const commandScript = fakeDollar.calls[0].values[0];

    assert.equal(result.success, true);
    assert.match(commandScript, /--resume 'session-existing'/);
  } finally {
    rmSync(params.tempDir, { recursive: true, force: true });
  }
});

await test('executeQwenCommand retries retryable errors and preserves session id', async () => {
  const fakeDollar = buildFakeDollar([
    {
      chunks: [
        { type: 'stdout', data: Buffer.from('{"type":"session.started","session_id":"session-retry"}\n') },
        { type: 'stderr', data: Buffer.from('selected model is at capacity, try a different model\n') },
      ],
      code: 1,
    },
    {
      chunks: [{ type: 'stdout', data: Buffer.from('{"type":"result","result":"ok"}\n') }],
      code: 0,
    },
  ]);
  const argv = {
    model: 'qwen3-coder-plus',
    url: 'https://github.com/link-assistant/hive-mind/issues/513',
    verbose: false,
  };
  const params = buildExecutionParams({ $: fakeDollar, argv });

  try {
    const result = await executeQwenCommand(params);
    const secondCommandScript = fakeDollar.calls[1].values[0];

    assert.equal(result.success, true);
    assert.equal(fakeDollar.calls.length, 2);
    assert.equal(argv.resume, 'session-retry');
    assert.match(secondCommandScript, /--resume 'session-retry'/);
  } finally {
    rmSync(params.tempDir, { recursive: true, force: true });
  }
});

console.log(`\nTotal: ${testsPassed + testsFailed} tests`);
console.log(`Passed: ${testsPassed}`);
console.log(`Failed: ${testsFailed}`);

process.exit(testsFailed > 0 ? 1 : 0);
