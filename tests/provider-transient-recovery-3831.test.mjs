/**
 * @hive-mind-test-suite default
 * Issue #3831: retries bound a continuous outage, not productive task lifetime.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.HIVE_MIND_INITIAL_TRANSIENT_ERROR_DELAY_MS = '1';
process.env.HIVE_MIND_MAX_TRANSIENT_ERROR_DELAY_MS = '8';
process.env.HIVE_MIND_MIN_TRANSIENT_ERROR_DELAY_MS = '0';
process.env.HIVE_MIND_INITIAL_CAPACITY_RETRY_DELAY_MS = '1';
process.env.HIVE_MIND_MAX_CAPACITY_RETRY_DELAY_MS = '8';
process.env.HIVE_MIND_MAX_TRANSIENT_ERROR_RETRIES = '3';
process.env.HIVE_MIND_TRANSIENT_ERROR_RETRY_BUDGET_MS = '1000';

globalThis.use = async name => {
  const packageName = name.replace(/@\d[^/]*$/, '');
  if (packageName === 'command-stream') return { $: () => ({ stream: async function* noopStream() {} }) };
  if (packageName === 'fs') return { ...fs, default: fs };
  if (packageName === 'os') return { ...os, default: os };
  if (packageName === 'path') return { ...path, default: path };
  if (packageName === 'getenv') return (key, fallback) => process.env[key] ?? fallback;
  return import(packageName);
};
const { createTransientRetryBudget, classifyRetryableError } = await import('../src/tool-retry.lib.mjs');
const { isRetryProgressEvent } = await import('../src/tool-retry-progress.lib.mjs');
const { executeCodexCommand } = await import('../src/codex.lib.mjs');
const { executeClaudeCommand } = await import('../src/claude.lib.mjs');
const { executeAgentCommand } = await import('../src/agent.lib.mjs');
const { executeOpenCodeCommand } = await import('../src/opencode.lib.mjs');
const { executeQwenCommand } = await import('../src/qwen.lib.mjs');
const { executeGeminiCommand } = await import('../src/gemini.lib.mjs');
const capacity = 'Selected model is at capacity. Please try a different model.';
const hour = 3600000;
const codexStart = [{ type: 'thread.started', thread_id: 'session-3831' }, { type: 'turn.started' }];
const codexFailure = message => [
  { type: 'error', message },
  { type: 'turn.failed', error: { message } },
];
const codexProgress = { type: 'item.completed', item: { id: 'work', type: 'command_execution', command: 'git status', exit_code: 0, status: 'completed', aggregated_output: 'clean' } };
const claudeStart = [{ type: 'system', subtype: 'init', session_id: 'session-3831' }];
const claudeFailure = message => [{ type: 'result', subtype: 'error_during_execution', is_error: true, errors: [message], result: message, session_id: 'session-3831', num_turns: 1 }];
const claudeProgress = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'work', name: 'Bash', input: { command: 'git status' } }] } };
const adapters = {
  codex: { execute: executeCodexCommand, model: 'gpt-6.1-sol', start: codexStart, failure: codexFailure, progress: codexProgress, success: [{ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }] },
  claude: { execute: executeClaudeCommand, model: 'opus', start: claudeStart, failure: claudeFailure, progress: claudeProgress, success: [{ type: 'result', subtype: 'success', is_error: false, result: 'Done.', num_turns: 2 }] },
};
for (const tool of ['agent', 'opencode']) adapters[tool] = { execute: tool === 'agent' ? executeAgentCommand : executeOpenCodeCommand, model: 'sonnet', start: [{ type: 'init', sessionID: 'session-3831' }], failure: message => [{ type: 'error', error: { message } }], progress: { type: 'text', part: { type: 'text', text: 'Working on the next change.' } }, success: [{ type: 'step_finish', part: { reason: 'stop' } }] };
adapters.qwen = { ...adapters.claude, execute: executeQwenCommand, model: 'qwen3-coder-plus', failure: message => [{ type: 'error', error: { message } }] };
adapters.gemini = { execute: executeGeminiCommand, model: 'gemini-2.5-pro', start: [{ type: 'init', session_id: 'session-3831' }], failure: message => [{ type: 'error', error: { message } }], progress: { type: 'message', role: 'assistant', content: 'Working on the next change.' }, success: [{ type: 'result', status: 'success' }] };

async function replay(t, tool, attempts, { throwAt = null, throwMessage = 'fetch failed' } = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hive-3831-'));
  const calls = [];
  const logs = [];
  const waits = [];
  let clock = 0;
  t.mock.method(Date, 'now', () => clock);
  const fakeDollar =
    () =>
    (strings, ...values) => {
      const index = calls.length;
      calls.push(strings.reduce((s, part, i) => s + part + (values[i] ?? ''), ''));
      assert.ok(index < attempts.length, 'unexpected unbounded retry');
      return {
        result: { code: attempts[index].code ?? 1 },
        async *stream() {
          const attempt = attempts[index];
          for (const entry of attempt.events) {
            if (entry.advance) {
              clock += entry.advance;
              continue;
            }
            yield { type: entry.stream || 'stdout', data: Buffer.from(JSON.stringify(entry.event || entry) + '\n') };
          }
          if (Array.isArray(throwAt) ? throwAt.includes(index) : throwAt === index) throw new Error(throwMessage);
          yield { type: 'exit', code: attempt.code ?? 1 };
        },
      };
    };
  const argv = { model: adapters[tool].model, verbose: false, agentMemoryDisabled: false, auxiliaryModelCallsDisabled: false };
  try {
    const { execute } = adapters[tool];
    const result = await execute({
      tempDir,
      branchName: 'issue-3831-test',
      prompt: 'Continue unfinished work.',
      systemPrompt: 'Solve the issue.',
      argv,
      log: async (message, options) => logs.push({ message: String(message), options }),
      formatAligned: (_icon, label, value = '') => `${label} ${value}`,
      getResourceSnapshot: async () => ({ memory: 'Mem:\n  available', load: '0.00' }),
      readCgroupMemory: () => null,
      codexPath: 'codex',
      claudePath: 'claude',
      agentPath: 'agent',
      opencodePath: 'opencode',
      qwenPath: 'qwen',
      geminiPath: 'gemini',
      $: fakeDollar,
      calculatePricing: async () => ({ totalCostUSD: null }),
      waitForRetryDelay: async delay => {
        waits.push(delay);
        clock += delay;
      },
    });
    return { result, argv, calls, logs, waits };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test('productive recovery resets the outage clock and retry backstop', () => {
  let clock = 0;
  const budget = createTransientRetryBudget({ budgetMs: 1000, now: () => clock });
  budget.grant();
  clock += 13 * hour;
  assert.equal(budget.evaluate().allowed, false);
  budget.recordProgress();
  assert.equal(budget.evaluate({ retryCount: 0, initialDelayMs: 1, maxDelayMs: 8 }).allowed, true);
  assert.match(budget.describeProgress(), /0s/);
});

for (const [tool, { start, failure, progress, success }] of Object.entries(adapters)) {
  test(`${tool}: capacity after 13 hours of resumed work gets a fresh retry with context`, { timeout: 10000 }, async t => {
    const { result, argv, calls, logs, waits } = await replay(t, tool, [{ events: [...start, ...failure(capacity)] }, { events: [...start, { advance: 13 * hour }, progress, ...failure(capacity)] }, { events: [...start, ...success], code: 0 }]);
    assert.equal(result.success, true);
    assert.equal(calls.length, 3);
    assert.equal(argv.resume, 'session-3831');
    assert.match(calls[1], /(?:--resume|--session|exec resume).*session-3831/);
    assert.match(calls[2], /(?:--resume|--session|exec resume).*session-3831/);
    assert.deepEqual(waits, [1, 1]);
    assert.equal(argv._capacityRetryCount, 1, 'separate outages must not accumulate fallback attempts');
    assert.ok(logs.some(line => /retry.*reset|reset.*retry/i.test(line.message) && line.options?.verbose));
  });
  test(`${tool}: server overload resumes with fresh backoff and keeps the selected model`, { timeout: 10000 }, async t => {
    const overload = 'API Error: 529';
    const { result, argv, calls, waits } = await replay(t, tool, [{ events: [...start, ...failure(overload)] }, { events: [...start, { advance: 13 * hour }, progress, ...failure(overload)] }, { events: [...start, ...success], code: 0 }]);
    assert.equal(result.success, true);
    assert.equal(calls.length, 3);
    assert.equal(argv.model, adapters[tool].model);
    assert.deepEqual(waits, [1, 1]);
  });
  test(`${tool}: init and repeated failures do not reset exponential backoff or the count limit`, { timeout: 10000 }, async t => {
    const { result, calls, waits } = await replay(
      t,
      tool,
      Array.from({ length: 4 }, () => ({ events: [...start, ...failure(capacity)] }))
    );
    assert.equal(result.success, false);
    assert.equal(calls.length, 4);
    assert.deepEqual(waits, [1, 2, 4]);
  });
  test(`${tool}: successful text quoting an outage is never retried`, { timeout: 10000 }, async t => {
    const { result, calls } = await replay(t, tool, [{ events: [...start, ...success.map(e => ({ ...e, result: capacity }))], code: 0 }]);
    assert.equal(result.success, true);
    assert.equal(calls.length, 1);
  });
}

for (const tool of ['codex', 'qwen']) {
  test(`${tool}: stderr protocol echoes cannot reset an exhausted outage budget`, { timeout: 10000 }, async t => {
    const { start, failure, progress } = adapters[tool];
    const { result, calls } = await replay(t, tool, [{ events: [...start, ...failure(capacity)] }, { events: [...start, { advance: 13 * hour }, { stream: 'stderr', event: progress }, ...failure(capacity)] }]);
    assert.equal(result.success, false);
    assert.equal(calls.length, 2);
  });
}

for (const [tool, { start, success }] of Object.entries(adapters)) {
  test(`${tool}: transport exception resumes the observed session`, { timeout: 10000 }, async t => {
    const { result, argv, calls } = await replay(t, tool, [{ events: start }, { events: [...start, ...success], code: 0 }], { throwAt: 0 });
    assert.equal(result.success, true);
    assert.equal(argv.resume, 'session-3831');
    assert.equal(calls.length, 2);
  });
  test(`${tool}: repeated transport exceptions remain bounded`, { timeout: 10000 }, async t => {
    const { result, calls, waits } = await replay(
      t,
      tool,
      Array.from({ length: 4 }, () => ({ events: start })),
      { throwAt: [0, 1, 2, 3] }
    );
    assert.equal(result.success, false);
    assert.equal(calls.length, 4);
    assert.deepEqual(waits, [1, 2, 4]);
  });
  test(`${tool}: permanent exceptions are not retried`, { timeout: 10000 }, async t => {
    const { result, calls, waits } = await replay(t, tool, [{ events: start }], { throwAt: 0, throwMessage: 'Invalid API key' });
    assert.equal(result.success, false);
    assert.equal(calls.length, 1);
    assert.deepEqual(waits, []);
  });
}

for (const message of ['server_is_overloaded', 'HTTP 529', 'API Error: 529', 'timeout_error', 'rate_limit_error', 'InternalServerError', 'ResponseStreamDisconnected', 'ResponseTooManyFailedAttempts', 'Opus is experiencing high load. Switch to Sonnet.', 'API Error: No response from API', 'APITimeoutError']) {
  test(`provider transient signature is retryable: ${message}`, () => assert.equal(classifyRetryableError(message).isRetryable, true));
}
for (const tool of Object.keys(adapters)) {
  test(`${tool}: synthetic errors, initialization and tool results cannot replenish the budget`, () => {
    const { start, failure } = adapters[tool];
    for (const event of [...start, ...failure(capacity), { type: 'assistant', isApiErrorMessage: true, message: { content: [{ type: 'text', text: capacity }] } }, { type: 'tool_result', content: 'Successful tool output quoting provider errors' }]) assert.equal(isRetryProgressEvent(tool, event), false, JSON.stringify(event));
    assert.equal(isRetryProgressEvent(tool, adapters[tool].progress), true);
  });
}
for (const message of ['Invalid API key', 'model not found', 'Quota exceeded. Check your plan and billing details.', 'API Error: 429 insufficient_quota: You exceeded your current quota, please check your plan and billing details.', 'HTTP 429 billing_hard_limit_reached', 'API Error: 429 credit balance is too low', 'This content was flagged for possible cybersecurity risk.', 'See issue #529 and PR #503.']) {
  test(`permanent errors and prose stay terminal: ${message}`, () => assert.equal(classifyRetryableError(message).isRetryable, false));
}
