#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 * Replay issue #2687 through the command wrapper without a live provider.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.HIVE_MIND_MAX_TRANSIENT_ERROR_RETRIES = '1';
process.env.HIVE_MIND_INITIAL_TRANSIENT_ERROR_DELAY_MS = '1';
process.env.HIVE_MIND_MAX_TRANSIENT_ERROR_DELAY_MS = '1';
process.env.HIVE_MIND_RETRY_BACKOFF_MULTIPLIER = '1';
process.env.HIVE_MIND_RESULT_STREAM_CLOSE_MS = '1000';
process.env.HIVE_MIND_STREAM_ACTIVITY_MS = '0';
process.env.HIVE_MIND_STREAM_STARTUP_MS = '5000';

globalThis.use = async name => {
  const packageName = name.replace(/@\d[^/]*$/, '');
  if (packageName === 'command-stream') return { $: () => ({ stream: async function* noopStream() {} }) };
  if (packageName === 'fs') return { ...fs, default: fs };
  if (packageName === 'os') return { ...os, default: os };
  if (packageName === 'path') return { ...path, default: path };
  if (packageName === 'getenv') return (key, fallback) => process.env[key] ?? fallback;
  return import(packageName);
};

const { executeClaudeCommand } = await import('../src/claude.lib.mjs');
const { resetCumulativeAnthropicCost } = await import('../src/anthropic-cost-accumulator.lib.mjs');
const { assessClaudeTurnCompletion } = await import('../src/claude.print-turn.lib.mjs');
const toolFailure = {
  type: 'user',
  session_id: 'session-2687',
  message: { content: [{ type: 'tool_result', tool_use_id: 'file-2687', is_error: true, content: 'Exit code 127\n59d1112a Initial commit with task details\n/bin/bash: line 1: file: command not found' }] },
};
const limitMessage = "You've hit your session limit · resets 10:20pm (UTC)";
const limitResult = { type: 'result', subtype: 'success', is_error: true, api_error_status: 429, api_error: 'usage_limit_reached', result: limitMessage, total_cost_usd: 0.2582846, num_turns: 3 };

async function replay(resultEvent, { newline = true, split = false, exitCode = 1, preceding = [toolFailure], retryResult = null } = {}) {
  resetCumulativeAnthropicCost();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hive-mind-2687-'));
  let logFile = path.join(tempDir, 'current.log');
  await writeFile(logFile, '');
  const logs = [];
  let calls = 0;
  const fakeDollar = () => () => {
    const events = calls++ === 0 ? [...preceding, resultEvent] : [retryResult];
    const output = events.map(event => JSON.stringify(event)).join('\n') + (newline ? '\n' : '');
    const chunks = split ? [output.slice(0, -25), output.slice(-25)] : [output];
    return {
      result: { code: calls === 1 ? exitCode : 0 },
      kill() {},
      async *stream() {
        for (const data of chunks) yield { type: 'stdout', data: Buffer.from(data) };
      },
    };
  };
  try {
    const result = await executeClaudeCommand({
      tempDir,
      branchName: 'issue-2687-test',
      prompt: 'Continue.',
      systemPrompt: 'Solve the issue.',
      escapedPrompt: 'Continue.',
      escapedSystemPrompt: 'Solve the issue.',
      argv: { model: 'opus', tool: 'claude', url: 'https://github.com/link-assistant/hive-mind/issues/2687', verbose: false, fallbackModel: null, disable1mContext: false, uselessToolsDisabled: false },
      log: async message => logs.push(String(message)),
      getLogFile: () => logFile,
      setLogFile: value => {
        logFile = value;
      },
      formatAligned: (_icon, label, value = '') => `${label} ${value}`.trim(),
      getResourceSnapshot: async () => ({ memory: 'Mem:\nMemAvailable: 1 GB', load: '0.00' }),
      forkedRepo: null,
      feedbackLines: [],
      claudePath: 'claude',
      $: fakeDollar,
      owner: 'link-assistant',
      repo: 'hive-mind',
      prNumber: 2690,
      issueNumber: 2687,
    });
    return { result, logs, calls };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

for (const framing of [{ newline: true }, { newline: false }, { newline: false, split: true }]) {
  test(`usage-limit result takes precedence over exit 127 (${JSON.stringify(framing)})`, { timeout: 10000 }, async () => {
    const { result, calls } = await replay(limitResult, framing);
    assert.equal(result.success, false);
    assert.equal(result.limitReached, true);
    assert.equal(result.limitResetTime, '10:20 PM');
    assert.equal(result.limitTimezone, 'UTC');
    assert.equal(result.errorInfo.message, limitMessage);
    assert.equal(result.resultSummary, null, 'a provider failure is not a solution summary');
    assert.equal(result.anthropicTotalCostUSD, limitResult.total_cost_usd);
    assert.equal(calls, 1, 'an account limit must not consume transient retries');
  });
}

for (const newline of [true, false]) {
  test(`explicit provider errors keep their diagnostics (newline=${newline})`, { timeout: 10000 }, async () => {
    const message = 'API Error: 400 invalid_request_error: invalid request';
    const { result } = await replay({ type: 'result', subtype: 'success', is_error: true, result: message }, { newline, exitCode: 0 });
    assert.equal(result.success, false);
    assert.equal(result.errorInfo.message, message);
  });

  test(`temporary 429 still resumes the session (newline=${newline})`, { timeout: 10000 }, async () => {
    const { result, calls } = await replay({ type: 'result', subtype: 'success', is_error: true, api_error_status: 429, result: 'API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited' }, { newline, retryResult: { type: 'result', subtype: 'success', is_error: false, result: 'Completed after retry.', total_cost_usd: 0 } });
    assert.equal(result.success, true);
    assert.equal(result.limitReached, false);
    assert.equal(calls, 2);
  });

  test(`failed terminal verification still overrides genuine success (newline=${newline})`, { timeout: 10000 }, async () => {
    const { result } = await replay({ type: 'result', subtype: 'success', is_error: false, result: 'Complete.' }, { newline, exitCode: 0 });
    assert.equal(result.success, false);
    assert.match(result.errorInfo.message, /Final tool result failed: Exit code 127/);
  });

  test(`provider execution and disk errors survive an earlier tool failure (newline=${newline})`, { timeout: 10000 }, async () => {
    const { result } = await replay({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['ENOSPC: no space left on device'] }, { newline, exitCode: 0 });
    assert.equal(result.success, false);
    assert.equal(result.errorDuringExecution, true);
    assert.match(result.errorInfo.message, /ENOSPC/);
    assert.doesNotMatch(result.errorInfo.message, /Final tool result failed/);
  });

  test(`a machine-readable usage limit needs no English wording (newline=${newline})`, { timeout: 10000 }, async () => {
    const { result, calls } = await replay({ ...limitResult, result: 'Quota exhausted' }, { newline });
    assert.equal(result.success, false);
    assert.equal(result.limitReached, true);
    assert.equal(result.errorInfo.message, 'Quota exhausted');
    assert.equal(calls, 1);
  });

  test(`a usage limit overrides an earlier transient error (newline=${newline})`, { timeout: 10000 }, async () => {
    const { result, calls } = await replay(limitResult, { newline, preceding: [toolFailure, { type: 'error', error: 'API Error: 500 Internal server error' }] });
    assert.equal(result.success, false);
    assert.equal(result.limitReached, true);
    assert.equal(result.errorInfo.message, limitMessage);
    assert.equal(calls, 1);
  });
}

test('a nonzero CLI exit takes precedence over an earlier tool failure', { timeout: 10000 }, async () => {
  const { result } = await replay({ type: 'result', subtype: 'success', is_error: false, result: 'Complete.' });
  assert.equal(result.success, false);
  assert.equal(result.errorInfo.exitCode, 1);
  assert.doesNotMatch(result.errorInfo.message, /Final tool result failed/);
});

test('a missing Claude executable retains its installation guidance', { timeout: 10000 }, async () => {
  const { result, logs } = await replay({ type: 'system', subtype: 'init' }, { exitCode: 127, preceding: [] });
  assert.equal(result.success, false);
  assert.equal(result.errorInfo.exitCode, 127);
  assert(logs.some(message => message.includes('not installed or not in PATH')));
});

test('an error result cannot trigger background-task continuation', () => {
  const completion = assessClaudeTurnCompletion({ resultEvent: { ...limitResult, subagent_stats: { killed: { system: 1 } } }, sessionId: 'session-2687' });
  assert.equal(completion.incomplete, false);
  assert.equal(completion.shouldResume, false);
});
