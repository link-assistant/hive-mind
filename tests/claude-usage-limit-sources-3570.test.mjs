#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #3570: the weekly usage limit reached only the Claude session
 * transcript. stdout ended with exit 1, no `result` event, and a base64 debug
 * line as the last output, so the run was reported as "Claude command failed
 * with exit code 1" with no reset time and no auto-resume. These tests replay
 * that run and check every source solve now cross-checks on failure.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

const { classifyAnthropicDebugRateLimit, classifyClaudeRateLimitEvent, createClaudeUsageLimitEvidence, formatEpochResetTimeUtc, readClaudeTranscriptApiError, resolveClaudeUsageLimit } = await import('../src/claude.usage-limit-sources.lib.mjs');
const { executeClaudeCommand } = await import('../src/claude.lib.mjs');
const { resetCumulativeAnthropicCost } = await import('../src/anthropic-cost-accumulator.lib.mjs');
const { parseResetTime } = await import('../src/usage-limit.lib.mjs');

const SESSION_ID = '84101e53-d3a4-4b69-a82a-b20b2819f791';
const WEEKLY_LIMIT = "You've hit your weekly limit · resets 11am (UTC)";
const WEEKLY_RESET_EPOCH = 1792494000; // 2026-10-20T11:00:00Z

// The last rate_limit_event of the reported run: a warning, not a rejection.
const allowedWarning = { type: 'rate_limit_event', session_id: SESSION_ID, rate_limit_info: { status: 'allowed_warning', resetsAt: WEEKLY_RESET_EPOCH, rateLimitType: 'seven_day', utilization: 0.97, overageStatus: 'rejected', overageDisabledReason: 'org_level_disabled', isUsingOverage: false, surpassedThreshold: 0.75 } };
// Issue #1924: the server-side throttle carries no reset and is not a usage limit.
const serverThrottle = { type: 'rate_limit_event', session_id: SESSION_ID, rate_limit_info: { status: 'rejected', isUsingOverage: false } };
// Issue #1905: a real limit carries resetsAt and the window type.
const realRejection = { status: 'rejected', resetsAt: 1781110200, rateLimitType: 'five_hour', overageStatus: 'rejected', overageDisabledReason: 'org_level_disabled', isUsingOverage: false };

// The ANTHROPIC_LOG=debug block printed on stdout under --verbose (IDs omitted).
const DEBUG_429_BLOCK = ['[log_be123b] response error (error; no more retries left) {', '  url: "https://api.anthropic.com/v1/messages?beta=true",', '  status: 429,', '  headers: {', '    "anthropic-ratelimit-unified-5h-status": "allowed",', '    "anthropic-ratelimit-unified-7d-reset": "1792494000",', '    "anthropic-ratelimit-unified-7d-status": "rejected",', '    "anthropic-ratelimit-unified-7d-utilization": "1.0",', '    "anthropic-ratelimit-unified-overage-status": "rejected",', '    "anthropic-ratelimit-unified-representative-claim": "seven_day",', '    "anthropic-ratelimit-unified-reset": "1792494000",', '    "anthropic-ratelimit-unified-status": "rejected",', '    date: "Mon, 19 Oct 2026 19:18:37 GMT",', '    "retry-after": "56482",', '    "x-should-retry": "true",', '  },', '  message: undefined,', '  durationMs: 135875,', '}'];
const BASE64_DUMP = 'Cfl40YOZK5u33blnr31i3MxYfHT5zEUjKBjXrhm2/98OPPp89fWvPn+j7hXMOJYumS72k3VC9m3nobyxtvue321954c/f+g3v+PfTKwtexMPPjD99brfXN8NNvmunzluk33SSV2of4nj51kl6mePvWrY6xM5F97Lz25pvf';

const transcriptLine = (text, extra = {}) => JSON.stringify({ parentUuid: 'p', isSidechain: false, type: 'assistant', sessionId: SESSION_ID, timestamp: '2026-10-19T19:19:48.000Z', message: { id: 'm', model: '<synthetic>', role: 'assistant', type: 'message', content: [{ type: 'text', text }] }, error: 'rate_limit', isApiErrorMessage: true, ...extra });
const userLine = JSON.stringify({ type: 'user', sessionId: SESSION_ID, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] } });

async function writeTranscript(homeDir, tempDir, lines) {
  const dir = path.join(homeDir, '.claude', 'projects', tempDir.replace(/\//g, '-'));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${SESSION_ID}.jsonl`), lines.join('\n') + '\n');
}

async function replay({ events, rawLines = [], transcript = null, exitCode = 1 }) {
  resetCumulativeAnthropicCost();
  const root = await mkdtemp(path.join(os.tmpdir(), 'hive-mind-3570-'));
  const tempDir = path.join(root, 'repo');
  const homeDir = path.join(root, 'home');
  await mkdir(tempDir, { recursive: true });
  if (transcript) await writeTranscript(homeDir, tempDir, transcript);
  const previous = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
  process.env.HOME = homeDir;
  delete process.env.CLAUDE_CONFIG_DIR;
  let logFile = path.join(root, 'current.log');
  await writeFile(logFile, '');
  const logs = [];
  let calls = 0;
  const fakeDollar = () => () => {
    calls++;
    const output = [...events.map(event => JSON.stringify(event)), ...rawLines].join('\n') + '\n';
    return {
      result: { code: exitCode },
      kill() {},
      async *stream() {
        yield { type: 'stdout', data: Buffer.from(output) };
        yield { type: 'exit', code: exitCode };
      },
    };
  };
  try {
    const result = await executeClaudeCommand({
      tempDir,
      branchName: 'issue-3570-test',
      prompt: 'Continue.',
      systemPrompt: 'Solve the issue.',
      argv: { model: 'opus', tool: 'claude', url: 'https://github.com/konard/konard.github.io/issues/7', verbose: true, fallbackModel: null, disable1mContext: false, uselessToolsDisabled: false },
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
      owner: 'konard',
      repo: 'konard.github.io',
      prNumber: 8,
      issueNumber: 7,
    });
    return { result, logs, calls };
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
}

const init = { type: 'system', subtype: 'init', session_id: SESSION_ID, model: 'claude-opus-4-8' };
const working = { type: 'assistant', session_id: SESSION_ID, message: { content: [{ type: 'text', text: 'Taking the screenshots now.' }] } };

test('issue #3570 replay: exit 1, no result event, weekly limit only in the transcript', { timeout: 15000 }, async () => {
  const { result, logs, calls } = await replay({ events: [init, working, allowedWarning], rawLines: [BASE64_DUMP], transcript: [userLine, transcriptLine(WEEKLY_LIMIT)] });
  assert.equal(result.success, false);
  assert.equal(result.limitReached, true, 'the limit is found in the transcript');
  assert.equal(result.limitResetTime, '11:00 AM');
  assert.equal(result.limitTimezone, 'UTC');
  assert.equal(result.errorInfo.message, WEEKLY_LIMIT);
  assert.equal(calls, 1, 'an account limit must not consume transient retries');
  assert.ok(!logs.some(line => line.includes('Claude command failed with exit code 1')), 'no generic exit-code failure');
  assert.ok(logs.some(line => line.includes('Usage limit found only in: session transcript')));
});

test('with --verbose debug output, the 429 headers add the exact reset date', { timeout: 15000 }, async () => {
  const { result } = await replay({ events: [init, working, allowedWarning], rawLines: [...DEBUG_429_BLOCK, BASE64_DUMP], transcript: [transcriptLine(WEEKLY_LIMIT)] });
  assert.equal(result.limitReached, true);
  assert.equal(result.limitResetTime, 'Oct 20, 2026, 11:00 AM');
  assert.equal(result.limitTimezone, 'UTC');
  assert.equal(result.errorInfo.message, WEEKLY_LIMIT);
  assert.equal(parseResetTime(result.limitResetTime, 'UTC').toISOString(), '2026-10-20T11:00:00.000Z');
});

test('without a transcript, the debug 429 headers alone identify the weekly limit', { timeout: 15000 }, async () => {
  const { result, calls } = await replay({ events: [init, working], rawLines: [...DEBUG_429_BLOCK, BASE64_DUMP] });
  assert.equal(result.limitReached, true);
  assert.equal(result.limitResetTime, 'Oct 20, 2026, 11:00 AM');
  assert.match(result.errorInfo.message, /weekly limit reached · resets Oct 20, 2026, 11:00 AM \(UTC\)/);
  assert.equal(calls, 1);
});

test('a rejected rate_limit_event with resetsAt identifies the limit', { timeout: 15000 }, async () => {
  const { result } = await replay({ events: [init, working, { type: 'rate_limit_event', session_id: SESSION_ID, rate_limit_info: { ...allowedWarning.rate_limit_info, status: 'rejected', utilization: 1 } }] });
  assert.equal(result.limitReached, true);
  assert.equal(result.limitResetTime, 'Oct 20, 2026, 11:00 AM');
});

test('a synthetic API error message on stdout is used even when it is not the last line', { timeout: 15000 }, async () => {
  const apiError = { type: 'assistant', session_id: SESSION_ID, is_api_error_message: true, error: 'rate_limit', message: { model: '<synthetic>', content: [{ type: 'text', text: WEEKLY_LIMIT }] } };
  const { result } = await replay({ events: [init, apiError], rawLines: [BASE64_DUMP] });
  assert.equal(result.limitReached, true);
  assert.equal(result.limitResetTime, '11:00 AM');
});

test('issue #1924 server throttle stays a non-limit failure, and a base64 dump is not the reason', { timeout: 15000 }, async () => {
  const { result } = await replay({ events: [init, working, serverThrottle], rawLines: [BASE64_DUMP], transcript: [userLine] });
  assert.equal(result.limitReached, false);
  assert.doesNotMatch(result.errorInfo.message, /Cfl40YOZ/);
});

test('rate_limit_event classification', () => {
  assert.equal(classifyClaudeRateLimitEvent(allowedWarning.rate_limit_info).isUsageLimit, false, '97% is a warning');
  assert.equal(classifyClaudeRateLimitEvent(serverThrottle.rate_limit_info).isUsageLimit, false, 'issue #1924 throttle');
  const real = classifyClaudeRateLimitEvent(realRejection);
  assert.equal(real.isUsageLimit, true);
  assert.equal(real.resetTime, formatEpochResetTimeUtc(1781110200));
  assert.equal(classifyClaudeRateLimitEvent({ ...allowedWarning.rate_limit_info, utilization: 1 }).isUsageLimit, true, '100% with overage rejected');
  assert.equal(classifyClaudeRateLimitEvent({ ...allowedWarning.rate_limit_info, utilization: 1, isUsingOverage: true, overageStatus: 'allowed' }).isUsageLimit, false, 'overage keeps the session going');
  assert.equal(classifyClaudeRateLimitEvent(null).isUsageLimit, false);
});

test('debug block parsing ignores other debug blocks and non-429 errors', () => {
  const evidence = createClaudeUsageLimitEvidence();
  for (const line of ['[log_aaaaaa] sending request {', '  status: 429,', '  "anthropic-ratelimit-unified-status": "rejected",', '}']) assert.equal(evidence.observeRawLine(line).isDebugOutput, true);
  assert.equal(evidence.snapshot().debugRateLimit, null);
  assert.equal(evidence.observeRawLine(BASE64_DUMP).isDebugOutput, true);
  assert.equal(evidence.observeRawLine('Error: real failure text').isDebugOutput, false);
  for (const line of DEBUG_429_BLOCK) evidence.observeRawLine(line, 'stderr');
  const verdict = classifyAnthropicDebugRateLimit(evidence.snapshot().debugRateLimit);
  assert.equal(verdict.isUsageLimit, true);
  assert.equal(verdict.rateLimitType, 'seven_day');
  assert.equal(verdict.retryAfterSeconds, 56482);
  assert.equal(classifyAnthropicDebugRateLimit({ status: 429, headers: { 'anthropic-ratelimit-unified-status': 'allowed' } }).isUsageLimit, false);
});

test('transcript reader skips trailing non-conversation entries and reports a missing file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hive-mind-3570-t-'));
  try {
    const tempDir = '/tmp/gh-issue-solver-1792426716947';
    await writeTranscript(root, tempDir, [userLine, transcriptLine(WEEKLY_LIMIT), JSON.stringify({ type: 'last-prompt', sessionId: SESSION_ID }), '{not json']);
    const found = await readClaudeTranscriptApiError({ tempDir, sessionId: SESSION_ID, homeDir: root, env: {} });
    assert.equal(found.found, true);
    assert.equal(found.text, WEEKLY_LIMIT);
    assert.equal((await readClaudeTranscriptApiError({ tempDir, sessionId: 'b6f5a2b0-0000-4000-8000-000000000000', homeDir: root, env: {} })).reason, 'transcript not found');
    const verdict = await resolveClaudeUsageLimit({ lastMessage: BASE64_DUMP, evidence: createClaudeUsageLimitEvidence(), tempDir, sessionId: SESSION_ID, homeDir: root, env: {} });
    assert.deepEqual([verdict.isUsageLimit, verdict.resetTime, verdict.timezone, verdict.sources], [true, '11:00 AM', 'UTC', ['session transcript']]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
