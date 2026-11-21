/**
 * @hive-mind-test-suite default
 * Issue #3570 (Codex side): a non-zero Codex exit whose usage limit is only in
 * the thread's rollout file must still be reported as a usage limit.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
const { executeCodexCommand } = await import('../src/codex.lib.mjs');
const { classifyCodexRateLimitSnapshot, readCodexRolloutLimitFacts } = await import('../src/codex-rollout-usage-limit.lib.mjs');

const THREAD_ID = '019a3570-0000-7000-8000-000000003570';
// 2026-10-20 11:00 UTC, the reset of the issue #3570 weekly window.
const RESETS_AT = 1792494000;
const line = (type, payload) => ({ timestamp: '2026-10-19T19:18:37.000Z', type, payload });
const turnStarted = line('event_msg', { type: 'task_started', model_context_window: 258400 });
const tokenCount = (primary, secondary, extra = {}) => line('event_msg', { type: 'token_count', info: null, rate_limits: { limit_id: 'codex', primary, secondary, credits: null, plan_type: 'pro', ...extra } });
const weeklyFull = tokenCount({ used_percent: 41, window_minutes: 300, resets_at: RESETS_AT - 3600 }, { used_percent: 100, window_minutes: 10080, resets_at: RESETS_AT });
const weeklyHalf = tokenCount({ used_percent: 12, window_minutes: 300, resets_at: RESETS_AT - 3600 }, { used_percent: 55, window_minutes: 10080, resets_at: RESETS_AT });

async function replay({ rollout = null, code = 1, signal = null, stderr = [] } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hive-mind-3570-codex-'));
  const tempDir = path.join(root, 'work');
  const codexHome = path.join(root, 'codex-home');
  await mkdir(tempDir, { recursive: true });
  if (rollout) {
    const dir = path.join(codexHome, 'sessions', '2026', '10', '19');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `rollout-2026-10-19T16-18-00-${THREAD_ID}.jsonl`), rollout.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  }
  const logs = [];
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  const events = [{ type: 'thread.started', thread_id: THREAD_ID }, { type: 'turn.started' }];
  const fakeDollar = () => () => ({
    async *stream() {
      yield { type: 'stdout', data: Buffer.from(events.map(event => JSON.stringify(event)).join('\n') + '\n') };
      for (const text of stderr) yield { type: 'stderr', data: Buffer.from(text) };
      yield { type: 'exit', code, signal };
    },
  });
  try {
    const result = await executeCodexCommand({
      tempDir,
      branchName: 'issue-3570-test',
      prompt: 'Run the tests.',
      systemPrompt: 'Solve the issue.',
      argv: { model: 'gpt-5.5', verbose: true },
      log: async (message, options) => logs.push({ message: String(message), options }),
      formatAligned: (_icon, label, value = '') => `${label} ${value}`,
      getResourceSnapshot: async () => ({ memory: 'Mem:\n  9.4 GB available', load: '0.00' }),
      readCgroupMemory: () => null,
      codexPath: 'codex',
      $: fakeDollar,
      calculatePricing: async () => null,
    });
    return { result, logs, text: logs.map(entry => entry.message).join('\n') };
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await rm(root, { recursive: true, force: true });
  }
}

test('exit 1 with no stderr: a weekly window at 100% in the rollout is a usage limit with its exact reset', { timeout: 10000 }, async () => {
  const { result, text } = await replay({ rollout: [turnStarted, weeklyHalf, weeklyFull] });
  assert.equal(result.success, false);
  assert.equal(result.limitReached, true);
  assert.equal(result.limitResetTime, 'Oct 20, 2026, 11:00 AM');
  assert.equal(result.limitTimezone, 'UTC');
  assert.match(text, /Usage limit found only in: rollout rate_limits/);
  assert.match(text, /Usage Limit Reached!/);
  assert.match(text, /secondary weekly window at 100%/);
  assert.doesNotMatch(text, /Codex command failed with exit code 1/);
});

test('a usage_limit_exceeded error event kept in an older rollout is a usage limit', { timeout: 10000 }, async () => {
  const error = line('event_msg', { type: 'error', message: "You've hit your usage limit. Try again at 11:00 AM.", codex_error_info: 'usage_limit_exceeded' });
  const { result, text } = await replay({ rollout: [turnStarted, weeklyHalf, error] });
  assert.equal(result.limitReached, true);
  assert.equal(result.limitResetTime, '11:00 AM');
  assert.match(text, /rollout error event: usage-limit text/);
});

test('a limit hit in an earlier turn is not reported again', { timeout: 10000 }, async () => {
  const { result, text } = await replay({ rollout: [turnStarted, weeklyFull, turnStarted, weeklyHalf] });
  assert.equal(result.limitReached, false);
  assert.match(text, /Codex command failed with exit code 1/);
  assert.match(text, /peak used_percent 55/);
});

test('a rollout below 100% and a missing rollout both stay a plain failure', { timeout: 10000 }, async () => {
  for (const rollout of [[turnStarted, weeklyHalf], null]) {
    const { result, text } = await replay({ rollout });
    assert.equal(result.limitReached, false);
    assert.equal(result.limitTimezone, null);
    assert.match(text, /Codex command failed with exit code 1/);
  }
});

test('a killed Codex process is never reported as a usage limit, even with a full window', { timeout: 10000 }, async () => {
  const { result } = await replay({ rollout: [turnStarted, weeklyFull], code: 137, signal: 'SIGKILL' });
  assert.equal(result.limitReached, false);
  assert.match(result.result, /SIGKILL/);
});

test('rate_limits classification', () => {
  assert.equal(classifyCodexRateLimitSnapshot(null).isUsageLimit, false);
  assert.equal(classifyCodexRateLimitSnapshot(weeklyHalf.payload.rate_limits).isUsageLimit, false);
  // `rate_limit_reached_type` without a window at 100% + resets_at has no reset to wait for.
  const typed = classifyCodexRateLimitSnapshot({ primary: { used_percent: 100, window_minutes: 300, resets_at: null }, rate_limit_reached_type: 'rate_limit_reached' });
  assert.equal(typed.isUsageLimit, false);
  assert.match(typed.reason, /rate_limit_reached/);
  const both = classifyCodexRateLimitSnapshot({ primary: { used_percent: 100, window_minutes: 300, resets_at: RESETS_AT - 3600 }, secondary: { used_percent: 100.4, window_minutes: 10080, resets_at: RESETS_AT } });
  assert.deepEqual([both.isUsageLimit, both.windowLabel, both.resetTime, both.timezone], [true, 'weekly', 'Oct 20, 2026, 11:00 AM', 'UTC']);
  const fiveHour = classifyCodexRateLimitSnapshot({ primary: { used_percent: 100, window_minutes: 300, resets_at: RESETS_AT } });
  assert.equal(fiveHour.windowLabel, '5-hour');
});

test('rollout reader reports a missing thread id and a missing rollout', async () => {
  assert.deepEqual(await readCodexRolloutLimitFacts({}), { found: false, reason: 'no thread id' });
  const missing = await readCodexRolloutLimitFacts({ threadId: THREAD_ID, codexHome: path.join(os.tmpdir(), 'hive-mind-3570-none') });
  assert.equal(missing.found, false);
  assert.match(missing.reason, /no rollout under/);
});
