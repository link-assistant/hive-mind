/**
 * @hive-mind-test-suite default
 *
 * Issue #4079: one `codex exec` turn ran for ten hours, degenerated into
 * 63,437 `.` lines in a tool call's arguments, and ended with
 * `Incomplete response returned, reason: max_output_tokens`, which failed the
 * whole run. The turn guard now detects degenerate output, bounds a turn by
 * time and input tokens, and resumes the session with a continuation prompt
 * instead of failing.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { CODEX_TURN_GUARD_DEFAULTS, buildCodexContinuationPrompt, createCodexTurnBudget, createCodexTurnGuard, createDegenerateOutputDetector, decideCodexContinuation, isFillerLine, isMaxOutputTokensFailure, resolveCodexTurnLimits } from '../src/codex-turn-guard.lib.mjs';
import { promptText } from '../src/prompt-text.lib.mjs';

const MINUTE = 60_000;
const ndjson = (...events) => events.map(event => JSON.stringify(event)).join('\n') + '\n';
const limits = (overrides = {}) => ({ ...CODEX_TURN_GUARD_DEFAULTS, ...overrides });
// The incident's record shape, with the identity trailer left out.
const toolResult = dots => [`2026-11-18T01:27:18.858Z  INFO codex_otel.log_only: event.name="codex.tool_result" tool_name=exec arguments=Need work exact continue.`, ...Array(dots).fill('.'), ' output=Script failed', "SyntaxError: Unexpected identifier 'exactlog' event.timestamp=2026-11-18T01:27:18.858Z", ''].join('\n');
const responseCompleted = (logger, input, timestamp = '2026-11-18T01:00:00.000Z') => `2026-11-18T01:00:00.1Z  INFO ${logger}: event.name="codex.sse_event" event.kind=response.completed input_token_count=${input} output_token_count=10 cached_token_count=0 event.timestamp=${timestamp}\n`;

test('limits come from the environment; 0 disables a check, garbage keeps the default', () => {
  assert.deepEqual(resolveCodexTurnLimits({ env: {} }), CODEX_TURN_GUARD_DEFAULTS);
  const resolved = resolveCodexTurnLimits({ env: { HIVE_MIND_CODEX_DEGENERATE_LINE_LIMIT: '0', HIVE_MIND_CODEX_MAX_TURN_MINUTES: ' 30 ', HIVE_MIND_CODEX_MAX_TURN_SPLITS: 'many' } });
  assert.equal(resolved.degenerateLineLimit, 0);
  assert.equal(resolved.maxTurnMinutes, 30);
  assert.equal(resolved.maxTurnSplits, CODEX_TURN_GUARD_DEFAULTS.maxTurnSplits);
});

test('filler lines have no letter or digit', () => {
  for (const line of ['', '.', '   ', '---', ')))', '…']) assert.equal(isFillerLine(line), true, JSON.stringify(line));
  for (const line of ['a', '1.', 'é', '}x']) assert.equal(isFillerLine(line), false, JSON.stringify(line));
});

test('the incident: a tool call whose arguments degenerate into dots, seen only on stderr telemetry', () => {
  const detector = createDegenerateOutputDetector({ limit: 200 });
  // Split mid-record, as the stream delivers it.
  const text = toolResult(63437);
  assert.equal(detector.observeStderr(text.slice(0, 120)), null);
  const finding = detector.observeStderr(text.slice(120));
  assert.deepEqual(finding, { line: '.', count: 200, source: 'stderr' });
});

test('repeats in tool output, in other telemetry and below the limit are not degenerate', () => {
  const detector = createDegenerateOutputDetector({ limit: 200 });
  // Tool output (after ` output=`) may repeat freely: a test log, a progress bar.
  const output = `2026-11-18T01:00:00Z  INFO codex_otel.log_only: event.name="codex.tool_result" arguments=ls\n output=${'ok\n'.repeat(500)}`;
  assert.equal(detector.observeStderr(output), null);
  assert.equal(detector.observeStderr(`2026-11-18T01:00:00Z  DEBUG codex_core: body\n${'.\n'.repeat(500)}`), null);
  assert.equal(detector.observeStderr(toolResult(150)), null);
  assert.equal(detector.observeStdout(ndjson({ type: 'item.completed', item: { type: 'command_execution', command: 'npm test', aggregated_output: 'pass\n'.repeat(500) } })), null);
  // A long message with varied lines is fine.
  assert.equal(detector.observeStdout(ndjson({ type: 'item.completed', item: { type: 'agent_message', text: Array.from({ length: 500 }, (_, i) => `step ${i}`).join('\n') } })), null);
  assert.equal(createDegenerateOutputDetector({ limit: 0 }).observeStderr(toolResult(5000)), null, 'limit 0 disables detection');
});

test('degenerate model text on stdout: identical lines in a message, blank lines in a command', () => {
  const message = createDegenerateOutputDetector({ limit: 200 });
  assert.deepEqual(message.observeStdout(ndjson({ type: 'item.completed', item: { type: 'agent_message', text: `Plan:\n${'Need work exact continue.\n'.repeat(250)}` } })), { line: 'Need work exact continue.', count: 200, source: 'stdout' });
  const command = createDegenerateOutputDetector({ limit: 200 });
  assert.equal(command.observeStdout(ndjson({ type: 'item.started', item: { type: 'command_execution', command: `node -e "x"${'\n'.repeat(300)}` } })).source, 'stdout');
  // Runs do not join across items.
  const split = createDegenerateOutputDetector({ limit: 200 });
  const half = { type: 'item.completed', item: { type: 'reasoning', text: '.\n'.repeat(150) } };
  assert.equal(split.observeStdout(ndjson(half, half)), null);
});

test('the turn budget: time and deduplicated input tokens, never while a command is running', () => {
  let clock = 0;
  const budget = createCodexTurnBudget({ maxTurnMinutes: 240, maxTurnInputTokens: 1000, now: () => clock });
  assert.equal(budget.check(), null, 'no turn yet');
  budget.observeStdout(ndjson({ type: 'thread.started', thread_id: 't' }, { type: 'turn.started' }));
  clock = 239 * MINUTE;
  assert.equal(budget.check(), null);
  budget.observeStdout(ndjson({ type: 'item.started', item: { id: 'c1', type: 'command_execution', command: 'npm test' } }, { type: 'item.started', item: { id: 'todo', type: 'todo_list', items: [] } }));
  clock = 300 * MINUTE;
  assert.equal(budget.check(), null, 'a running command is never cut off');
  budget.observeStdout(ndjson({ type: 'item.completed', item: { id: 'c1', type: 'command_execution' } }));
  assert.deepEqual(budget.check(), { kind: 'turn-time', minutes: 300, tokens: 0 }, 'an open todo list does not hold the split');
  budget.observeStdout(ndjson({ type: 'turn.completed', usage: {} }));
  assert.equal(budget.check(), null, 'between turns');

  const tokens = createCodexTurnBudget({ maxTurnMinutes: 0, maxTurnInputTokens: 1000, now: () => clock });
  tokens.observeStdout(ndjson({ type: 'turn.started' }));
  // Codex logs each response.completed twice (log_only and trace_safe).
  tokens.observeStderr(responseCompleted('codex_otel.log_only', 600) + responseCompleted('codex_otel.trace_safe', 600));
  assert.equal(tokens.check(), null);
  tokens.observeStderr(responseCompleted('codex_otel.log_only', 600, '2026-11-18T01:05:00.000Z'));
  assert.deepEqual(tokens.check(), { kind: 'turn-tokens', minutes: 0, tokens: 1200 });
});

test('the guard stops the session once, and only while a resume is left', async () => {
  const stops = [];
  const logs = [];
  const guard = createCodexTurnGuard({ limits: limits(), counters: { truncation: 0, splits: 0 }, stopSession: async () => stops.push('SIGTERM'), log: async message => logs.push(message) });
  await guard.observeStderr(toolResult(500));
  await guard.observeStderr(toolResult(500));
  assert.deepEqual(stops, ['SIGTERM']);
  assert.deepEqual(guard.getStopReason(), { kind: 'degenerate-output', line: '.', count: 200, source: 'stderr' });
  assert.match(logs.join('\n'), /Codex output degenerated: 200 consecutive repeated or empty lines \("\."\) in the model's tool call arguments/);

  const spent = [];
  const used = createCodexTurnGuard({ limits: limits({ maxTruncationResumes: 1 }), counters: { truncation: 1, splits: 0 }, stopSession: async () => spent.push('SIGTERM'), log: async message => spent.push(message) });
  await used.observeStderr(toolResult(500));
  assert.equal(used.getStopReason(), null);
  assert.ok(!spent.includes('SIGTERM'));
  assert.match(spent.join('\n'), /Not stopping/);
});

test('the guard splits a long turn between tool calls, from its timer too', async () => {
  let clock = 0;
  const stops = [];
  const guard = createCodexTurnGuard({ limits: limits({ maxTurnMinutes: 60 }), counters: { truncation: 0, splits: 0 }, stopSession: async () => stops.push('SIGTERM'), log: async () => {}, now: () => clock, checkIntervalMs: 5 });
  guard.start();
  try {
    await guard.observeStdout(ndjson({ type: 'turn.started' }));
    clock = 61 * MINUTE;
    // The model writes silently for a long time; only the timer notices.
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(stops, ['SIGTERM']);
    assert.deepEqual(guard.getStopReason(), { kind: 'turn-time', minutes: 61, tokens: 0 });
  } finally {
    guard.end();
  }
  const exhausted = createCodexTurnGuard({ limits: limits({ maxTurnMinutes: 60, maxTurnSplits: 2 }), counters: { truncation: 0, splits: 2 }, stopSession: async () => stops.push('again'), log: async () => {}, now: () => clock });
  clock = 0;
  await exhausted.observeStdout(ndjson({ type: 'turn.started' }));
  clock = 600 * MINUTE;
  await exhausted.observeStdout(ndjson({ type: 'item.completed', item: { id: 'x', type: 'agent_message', text: 'hi' } }));
  assert.equal(exhausted.getStopReason(), null, 'no split once the splits are used up');
});

test('max_output_tokens is recognised in turn failures and stream errors', () => {
  assert.equal(isMaxOutputTokensFailure({ turnFailures: [{ message: 'Incomplete response returned, reason: max_output_tokens' }] }), true);
  assert.equal(isMaxOutputTokensFailure({ streamErrors: [{ message: 'reason: max_output_tokens' }] }), true);
  assert.equal(isMaxOutputTokensFailure({ turnFailures: [{ message: 'Selected model is at capacity.' }] }), false);
  assert.equal(isMaxOutputTokensFailure(null), false);
});

test('continuation decisions: resumable kinds, per-kind limits, no session, other failures', () => {
  const counters = { truncation: 0, splits: 0 };
  const truncated = { turnFailures: [{ message: 'Incomplete response returned, reason: max_output_tokens' }] };
  const first = decideCodexContinuation({ state: truncated, sessionId: 'thread-1', counters, limits: limits({ maxTruncationResumes: 2 }) });
  assert.equal(first.resume, true);
  assert.equal(first.kind, 'max-output-tokens');
  assert.match(first.message, /Resuming Codex session thread-1: the response hit max_output_tokens \(1\/2, issue #4079\)/);
  assert.match(first.prompt, /max_output_tokens/);
  assert.equal(decideCodexContinuation({ state: truncated, sessionId: 'thread-1', counters, limits: limits({ maxTruncationResumes: 2 }) }).resume, true);
  const third = decideCodexContinuation({ state: truncated, sessionId: 'thread-1', counters, limits: limits({ maxTruncationResumes: 2 }) });
  assert.equal(third.resume, false);
  assert.match(third.message, /used up/);
  // Splits have their own budget.
  assert.equal(decideCodexContinuation({ stopReason: { kind: 'turn-time', minutes: 241, tokens: 0 }, sessionId: 'thread-1', counters, limits: limits() }).resume, true);
  assert.deepEqual(counters, { truncation: 2, splits: 1 });
  assert.equal(decideCodexContinuation({ state: truncated, sessionId: null, counters: { truncation: 0, splits: 0 }, limits: limits() }).resume, false);
  // A turn that failed for another reason goes to the error handling.
  assert.equal(decideCodexContinuation({ stopReason: { kind: 'turn-time', minutes: 241 }, state: { turnFailures: [{ message: 'Selected model is at capacity.' }] }, sessionId: 'thread-1', counters, limits: limits() }), null);
  assert.equal(decideCodexContinuation({ state: { turnFailures: [] }, sessionId: 'thread-1', counters, limits: limits() }), null);
});

test('continuation prompts say why the turn ended and ask for smaller steps after truncation', () => {
  const degenerate = buildCodexContinuationPrompt({ kind: 'degenerate-output', line: '.', count: 200 });
  assert.match(degenerate, /200/);
  assert.match(degenerate, /"\."/);
  const time = buildCodexContinuationPrompt({ kind: 'turn-time', minutes: 241 });
  assert.match(time, /241/);
  const tokens = buildCodexContinuationPrompt({ kind: 'turn-tokens', tokens: 123456789 });
  assert.match(tokens, /123,456,789/);
  const truncated = buildCodexContinuationPrompt({ kind: 'max-output-tokens' });
  for (const prompt of [degenerate, time, tokens, truncated]) assert.ok(!/{{|}}/.test(prompt), `no unfilled placeholder: ${prompt}`);
  // Only truncation asks for shorter steps.
  const shorterSteps = promptText('prompt.templates.codex-turn-guard.buildCodexContinuationPrompt.shorterSteps');
  assert.ok(shorterSteps && truncated.includes(shorterSteps) && degenerate.includes(shorterSteps));
  assert.ok(!time.includes(shorterSteps) && !tokens.includes(shorterSteps));
});

// End to end through executeCodexCommand, with a fake codex process.
globalThis.use ??= async name => {
  const packageName = name.replace(/@\d[^/]*$/, '');
  if (packageName === 'command-stream') return { $: () => ({ stream: async function* noopStream() {} }) };
  if (packageName === 'fs') return { ...fs, default: fs };
  if (packageName === 'os') return { ...os, default: os };
  if (packageName === 'path') return { ...path, default: path };
  if (packageName === 'getenv') return (key, fallback) => process.env[key] ?? fallback;
  return import(packageName);
};

async function runCodex(attempts) {
  const { executeCodexCommand } = await import('../src/codex.lib.mjs');
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hive-4079-'));
  const calls = [];
  const prompts = [];
  const logs = [];
  const fakeDollar =
    options =>
    (strings, ...values) => {
      const index = calls.length;
      const command = strings.reduce((text, part, i) => text + part + (values[i] ?? ''), '');
      calls.push(command);
      const files = [...command.matchAll(/["'](\/[^"']+\.txt)["']/g)].map(match => match[1]);
      files.push(...values.filter(value => typeof value === 'string' && value.startsWith('/') && value.endsWith('.txt')));
      prompts.push([options.stdin, ...files.filter(file => fs.existsSync(file)).map(file => fs.readFileSync(file, 'utf8'))].join('\n'));
      assert.ok(index < attempts.length, 'unexpected extra codex run');
      return {
        result: { code: attempts[index].code ?? 1 },
        async *stream() {
          for (const chunk of attempts[index].chunks) yield { type: chunk.stream ?? 'stdout', data: Buffer.from(chunk.text) };
          yield { type: 'exit', code: attempts[index].code ?? 1 };
        },
      };
    };
  const argv = { model: 'gpt-6.1-sol', verbose: false, agentMemoryDisabled: false, auxiliaryModelCallsDisabled: false };
  try {
    const result = await executeCodexCommand({
      tempDir,
      branchName: 'issue-4079-test',
      prompt: 'Continue unfinished work.',
      systemPrompt: 'Solve the issue.',
      argv,
      log: async (message, options) => logs.push({ message: String(message), options }),
      formatAligned: (_icon, label, value = '') => `${label} ${value}`,
      getResourceSnapshot: async () => ({ memory: 'Mem:\n  available', load: '0.00' }),
      readCgroupMemory: () => null,
      codexPath: 'codex',
      $: fakeDollar,
      calculatePricing: async () => ({ totalCostUSD: null }),
      waitForRetryDelay: async () => {},
    });
    return { result, argv, calls, prompts, logs };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

const started = { text: ndjson({ type: 'thread.started', thread_id: 'thread-4079' }, { type: 'turn.started' }) };
const succeeded = { text: ndjson({ type: 'item.completed', item: { id: 'm', type: 'agent_message', text: 'Done.' } }, { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }) };
const truncated = { text: ndjson({ type: 'error', message: 'Incomplete response returned, reason: max_output_tokens' }, { type: 'turn.failed', error: { message: 'Incomplete response returned, reason: max_output_tokens' } }) };

test('executeCodexCommand resumes a max_output_tokens failure instead of failing the run', { timeout: 20000 }, async () => {
  const { result, argv, calls, prompts, logs } = await runCodex([{ chunks: [started, truncated] }, { chunks: [started, succeeded], code: 0 }]);
  assert.equal(result.success, true);
  assert.equal(calls.length, 2);
  assert.equal(argv.resume, 'thread-4079');
  assert.match(calls[1], /exec resume.*thread-4079/);
  assert.match(prompts[1], /max_output_tokens/, 'the resumed turn is told why');
  assert.ok(!/max_output_tokens/.test(prompts[0]));
  assert.ok(logs.some(line => /Resuming Codex session thread-4079: the response hit max_output_tokens \(1\/3, issue #4079\)/.test(line.message)));
});

test('the incident replay: degenerate tool arguments on stderr stop the turn, and it resumes', { timeout: 20000 }, async () => {
  const { result, calls, prompts, logs } = await runCodex([{ chunks: [started, { stream: 'stderr', text: toolResult(63437) }, truncated] }, { chunks: [started, succeeded], code: 0 }]);
  assert.equal(result.success, true);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /exec resume.*thread-4079/);
  assert.match(prompts[1], /degenerated into 200 repeated or empty lines \("\."\)/);
  assert.ok(logs.some(line => /Codex output degenerated/.test(line.message)));
  assert.ok(logs.some(line => /Resuming Codex session thread-4079: the output degenerated/.test(line.message)));
});

test('executeCodexCommand gives up after the configured resumes and reports the failure', { timeout: 20000 }, async () => {
  const previous = process.env.HIVE_MIND_CODEX_MAX_TRUNCATION_RESUMES;
  process.env.HIVE_MIND_CODEX_MAX_TRUNCATION_RESUMES = '1';
  try {
    const { result, calls, logs } = await runCodex([{ chunks: [started, truncated] }, { chunks: [started, truncated] }]);
    assert.equal(result.success, false);
    assert.equal(calls.length, 2);
    assert.ok(logs.some(line => /automatic resume\(s\) for this are used up/.test(line.message)));
  } finally {
    if (previous === undefined) delete process.env.HIVE_MIND_CODEX_MAX_TRUNCATION_RESUMES;
    else process.env.HIVE_MIND_CODEX_MAX_TRUNCATION_RESUMES = previous;
  }
});

test('codex.lib.mjs wires the guard into the stream loop and the retry path', () => {
  const source = fs.readFileSync(new URL('../src/codex.lib.mjs', import.meta.url), 'utf8');
  assert.match(source, /createCodexTurnGuard\(\{ limits: codexTurnLimits, counters: codexTurnGuardCounters, stopSession: async \(\) => execCommand\?\.kill\?\.\('SIGTERM'\)/);
  assert.match(source, /await codexTurnGuard\.observeStdout\(output\);/);
  assert.match(source, /await codexTurnGuard\.observeStderr\(errorOutput\);/);
  assert.match(source, /codexContinuationPrompt = continuation\.prompt;\n\s+return await executeWithRetry\(\);/);
});
