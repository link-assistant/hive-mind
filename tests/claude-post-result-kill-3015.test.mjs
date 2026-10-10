#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #3015: "Solution Draft Failed with strange message, that looks like last message from AI".
 *
 * The reported Claude run ended with `subtype: success, is_error: false`, but the CLI did not
 * exit within the 30s post-result close timeout (Issue #1280). The solver sent SIGTERM, and
 * the current command-stream yields `{ type: 'exit', code: 143 }` for that. The exit-chunk
 * branch counted 143 as a failure, and the AI's own work summary was published as the error:
 *
 *   CLAUDE execution failed with I fixed the four `/queue` problems from the issue and log, …
 *
 * This file replays that stream through executeClaudeCommand without a live provider.
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
process.env.HIVE_MIND_RESULT_STREAM_CLOSE_MS = '200';
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
const { formatToolExecutionFailure } = await import('../src/lib.mjs');

// Shortened from the reported log (line 55765 of the gist).
const summary = "I fixed the four `/queue` problems from the issue and log, and marked PR https://github.com/link-assistant/hive-mind/pull/2824 ready for review. CI on the final commit has not run yet. All of the repo's runs have been sitting in the queue for more than an hour.";
const assistantText = { type: 'assistant', session_id: 'session-3015', message: { content: [{ type: 'text', text: summary }] } };
const successResult = { type: 'result', subtype: 'success', is_error: false, result: summary, num_turns: 158, total_cost_usd: 6.366721, session_id: 'session-3015' };

/**
 * @param {Object} options
 * @param {boolean} options.hangAfterResult - keep the stream open until the solver kills the process
 * @param {boolean} options.yieldExitChunk - emit `{ type: 'exit' }` (current command-stream) or not (v0.9.4)
 * @param {number} options.exitCode - code the process reports
 */
async function replay({ hangAfterResult, yieldExitChunk, exitCode }) {
  resetCumulativeAnthropicCost();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hive-mind-3015-'));
  let logFile = path.join(tempDir, 'current.log');
  await writeFile(logFile, '');
  const logs = [];
  const kills = [];
  const fakeDollar = () => () => {
    let onKill;
    const killed = new Promise(resolve => {
      onKill = resolve;
    });
    const command = {
      result: null,
      kill(signal) {
        kills.push(signal);
        onKill(signal);
      },
      async *stream() {
        yield { type: 'stdout', data: Buffer.from(`${JSON.stringify(assistantText)}\n${JSON.stringify(successResult)}\n`) };
        if (hangAfterResult) await killed;
        command.result = { code: exitCode };
        if (yieldExitChunk) yield { type: 'exit', code: exitCode };
      },
    };
    return command;
  };
  try {
    const result = await executeClaudeCommand({
      tempDir,
      branchName: 'issue-3015-test',
      prompt: 'Continue.',
      systemPrompt: 'Solve the issue.',
      escapedPrompt: 'Continue.',
      escapedSystemPrompt: 'Solve the issue.',
      argv: { model: 'opus', tool: 'claude', url: 'https://github.com/link-assistant/hive-mind/issues/3015', verbose: true, fallbackModel: null, disable1mContext: false, uselessToolsDisabled: false },
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
      prNumber: 3018,
      issueNumber: 3015,
    });
    return { result, logs, kills };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

for (const yieldExitChunk of [true, false]) {
  test(`SIGTERM after a successful result is not a failure (exit chunk: ${yieldExitChunk})`, { timeout: 10000 }, async () => {
    const { result, logs, kills } = await replay({ hangAfterResult: true, yieldExitChunk, exitCode: 143 });
    assert.deepEqual(kills, ['SIGTERM'], 'the post-result close timeout must stop the hanging CLI');
    assert.equal(result.success, true, `expected success, got ${JSON.stringify(result.errorInfo)}`);
    assert.equal(result.resultSummary, summary);
    assert.ok(!logs.some(line => line.includes('Claude command failed with exit code 143')), 'must not log the forced close as a failure');
    assert.ok(
      logs.some(line => line.includes('did not exit after its successful result')),
      'the ignored exit code is still visible in verbose logs'
    );
  });
}

test('a genuine non-zero exit after a successful result still fails, but never with the summary as the error', { timeout: 10000 }, async () => {
  const { result, kills } = await replay({ hangAfterResult: false, yieldExitChunk: true, exitCode: 1 });
  assert.deepEqual(kills, [], 'the CLI exited on its own');
  assert.equal(result.success, false);
  assert.equal(result.errorInfo.message, 'Claude CLI exited with code 1 after reporting a successful result');
  const published = formatToolExecutionFailure({ tool: 'claude', toolResult: result });
  assert.equal(published, 'CLAUDE execution failed with Claude CLI exited with code 1 after reporting a successful result');
  assert.ok(!published.includes('I fixed the four'), published);
});

test('a CLI that exits by itself after its result is unaffected', { timeout: 10000 }, async () => {
  const { result, kills } = await replay({ hangAfterResult: false, yieldExitChunk: true, exitCode: 0 });
  assert.deepEqual(kills, []);
  assert.equal(result.success, true);
});
