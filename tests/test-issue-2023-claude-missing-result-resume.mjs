#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2023. The captured Claude stream ended after
 * a failed tool_result ("Exit code 144") without a terminal result event. The
 * solver detected the missing result but classified too early, so it failed the
 * whole run instead of retrying with `--resume <sessionId>`.
 */

import assert from 'node:assert/strict';
import fsModule, { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import osModule, { tmpdir } from 'node:os';
import pathModule, { join } from 'node:path';

process.env.HIVE_MIND_MAX_TRANSIENT_ERROR_RETRIES = '1';
process.env.HIVE_MIND_INITIAL_TRANSIENT_ERROR_DELAY_MS = '1';
process.env.HIVE_MIND_MAX_TRANSIENT_ERROR_DELAY_MS = '1';
process.env.HIVE_MIND_RETRY_BACKOFF_MULTIPLIER = '1';
process.env.HIVE_MIND_RESULT_STREAM_CLOSE_MS = '1000';
process.env.HIVE_MIND_STREAM_ACTIVITY_MS = '0';
process.env.HIVE_MIND_STREAM_STARTUP_MS = '5000';

const testHome = mkdtempSync(join(tmpdir(), 'issue-2023-home-'));
process.env.HOME = testHome;

globalThis.use = async name => {
  if (name === 'command-stream') return { $: () => ({ stream: async function* noopStream() {} }) };
  if (name === 'fs') return { ...fsModule, default: fsModule };
  if (name === 'os') return { ...osModule, default: osModule };
  if (name === 'path') return { ...pathModule, default: pathModule };
  if (name === 'getenv') return (key, fallback) => process.env[key] ?? fallback;
  return await import(name);
};

const { executeClaudeCommand } = await import('../src/claude.lib.mjs');
const { buildMissingClaudeResultMessage } = await import('../src/claude.stream-events.lib.mjs');
const { classifyRetryableError } = await import('../src/tool-retry.lib.mjs');

let passed = 0;
let failed = 0;

const test = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.stack || error.message}`);
    failed++;
  }
};

const renderCommand = (strings, values) => strings.reduce((command, part, index) => command + part + (index < values.length ? String(values[index]) : ''), '');

const buildFakeDollar = responses => {
  const calls = [];
  const fakeDollar =
    options =>
    (strings, ...values) => {
      const response = responses.shift() || { chunks: [], code: 0 };
      calls.push({
        options,
        strings: [...strings],
        values,
        command: renderCommand(strings, values),
      });

      return {
        pid: 10000 + calls.length,
        result: { code: response.code ?? 0 },
        kill: () => {},
        async *stream() {
          for (const chunk of response.chunks || []) {
            yield chunk;
          }
        },
      };
    };
  fakeDollar.calls = calls;
  return fakeDollar;
};

const jsonLinesChunk = events => ({
  type: 'stdout',
  data: Buffer.from(`${events.map(event => JSON.stringify(event)).join('\n')}\n`),
});

const buildExecutionParams = ({ fakeDollar, logs }) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'issue-2023-work-'));
  const initialLogFile = join(tempDir, 'current.log');
  writeFileSync(initialLogFile, '');

  let logFile = initialLogFile;
  return {
    tempDir,
    branchName: 'issue-2023-test',
    prompt: 'Continue.',
    systemPrompt: 'Solve the issue.',
    escapedPrompt: 'Continue.',
    escapedSystemPrompt: 'Solve the issue.',
    argv: {
      model: 'opus',
      tool: 'claude',
      url: 'https://github.com/link-assistant/hive-mind/issues/2023',
      verbose: false,
      fallbackModel: null,
      disable1mContext: false,
      uselessToolsDisabled: false,
    },
    log: async message => logs.push(String(message)),
    setLogFile: nextLogFile => {
      logFile = nextLogFile;
    },
    getLogFile: () => logFile,
    formatAligned: (_icon, label, value = '') => `${label} ${value}`.trim(),
    getResourceSnapshot: async () => ({ memory: 'Mem:\nMemAvailable: 1 GB', load: '0.00' }),
    forkedRepo: null,
    feedbackLines: [],
    claudePath: 'claude',
    $: fakeDollar,
    owner: 'link-assistant',
    repo: 'hive-mind',
    prNumber: 2024,
    issueNumber: 2023,
  };
};

await test('missing terminal result after Exit code 144 is retryable', () => {
  const message = buildMissingClaudeResultMessage({ lastToolResultError: 'Exit code 144' });
  const classified = classifyRetryableError(message);

  assert.equal(message, 'Claude stream ended without a terminal result event after: Exit code 144');
  assert.equal(classified.isRetryable, true);
  assert.equal(classified.isCapacity, false);
  assert.equal(classified.label, 'Claude stream ended without terminal result');
});

await test('Claude stream missing result resumes the captured session', async () => {
  const logs = [];
  const firstAttemptEvents = [
    {
      type: 'assistant',
      session_id: 'session-2023',
      message: {
        content: [{ type: 'tool_use', id: 'toolu_issue_2023', name: 'Bash', input: { command: 'gh run view' } }],
      },
    },
    {
      type: 'user',
      session_id: 'session-2023',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_issue_2023',
            is_error: true,
            content: 'Exit code 144',
          },
        ],
      },
      tool_use_result: 'Error: Exit code 144',
    },
  ];
  const secondAttemptEvents = [
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Completed after resume.',
      total_cost_usd: 0,
      num_turns: 2,
    },
  ];
  const fakeDollar = buildFakeDollar([
    { chunks: [jsonLinesChunk(firstAttemptEvents)], code: 0 },
    { chunks: [jsonLinesChunk(secondAttemptEvents)], code: 0 },
  ]);
  const params = buildExecutionParams({ fakeDollar, logs });

  try {
    const result = await executeClaudeCommand(params);

    assert.equal(result.success, true);
    assert.equal(result.resultSummary, 'Completed after resume.');
    assert.equal(params.argv.resume, 'session-2023');
    assert.equal(fakeDollar.calls.length, 2);
    assert.match(fakeDollar.calls[1].command, /--resume session-2023/);
    assert.match(logs.join('\n'), /Claude stream ended without a terminal result event after: Exit code 144/);
    assert.match(logs.join('\n'), /Retrying now/);
  } finally {
    rmSync(params.tempDir, { recursive: true, force: true });
  }
});

rmSync(testHome, { recursive: true, force: true });

console.log(`\nTotal: ${passed + failed} tests`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
