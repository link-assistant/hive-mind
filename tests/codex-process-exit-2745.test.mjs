/**
 * @hive-mind-test-suite default
 * Replay abruptly terminated Codex sessions without launching a memory probe.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
const { formatToolExecutionFailure } = await import('../src/lib.mjs');
const { isToolProcessKilled } = await import('../src/solve.tool-kill-resume.lib.mjs');

const memory = oomKills => ({ version: 2, path: '/sys/fs/cgroup', limitBytes: 3135373312, currentBytes: 635551744, peakBytes: 3135520768, oomEvents: 216, oomKills });
const started = [{ type: 'thread.started', thread_id: 'session-2745' }, { type: 'turn.started' }];
async function replay({ code = 137, signal = null, before = memory(0), after = memory(23), stderr = [], events = started } = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hive-mind-2745-'));
  const logs = [];
  let promptText;
  let snapshots = 0;
  const fakeDollar = () => (_strings, command) => ({
    async *stream() {
      const promptFile = command.match(/<\s*"([^"]+)"/)?.[1];
      promptText = await readFile(promptFile, 'utf8');
      yield { type: 'stdout', data: Buffer.from(events.map(event => JSON.stringify(event)).join('\n') + '\n') };
      for (const text of stderr) yield { type: 'stderr', data: Buffer.from(text) };
      yield { type: 'exit', code, signal };
    },
  });
  try {
    const result = await executeCodexCommand({
      tempDir,
      branchName: 'issue-2745-test',
      prompt: 'Run the tests.',
      systemPrompt: 'Solve the issue.',
      argv: { model: 'gpt-5.5', verbose: false },
      log: async (message, options) => logs.push({ message: String(message), options }),
      formatAligned: (_icon, label, value = '') => `${label} ${value}`,
      getResourceSnapshot: async () => ({ memory: 'Mem:\n  9.4 GB available', load: '0.00' }),
      readCgroupMemory: () => (snapshots++ === 0 ? before : after),
      codexPath: 'codex',
      $: fakeDollar,
      calculatePricing: async () => null,
    });
    return { result, logs, promptText };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test('incident exit 137 reports its cause and reaches the existing kill recovery gate', { timeout: 10000 }, async () => {
  const { result, logs, promptText } = await replay();
  assert.equal(result.success, false);
  assert.equal(result.exitCode, 137);
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(result.sessionId, 'session-2745');
  assert.equal(isToolProcessKilled(result), true);
  assert.equal(result.errorInfo.hasError, true);
  assert.match(result.result, /exit code 137.*SIGKILL/);
  assert.match(result.result, /23 OOM kills.*during this attempt/);
  assert.match(result.result, /2\.92 GiB/);
  assert.match(formatToolExecutionFailure({ tool: 'codex', toolResult: result }), /137.*SIGKILL.*OOM/);
  assert.ok(logs.some(line => line.message.includes(result.result) && !line.options?.verbose));
  assert.match(promptText, /container memory limit.*2\.92 GiB/i);
  assert.match(promptText, /CARGO_BUILD_JOBS=1/);
});

test('signal-only exit is normalized without losing termination information', { timeout: 10000 }, async () => {
  const { result } = await replay({ code: null, signal: 'SIGKILL', before: null, after: null });
  assert.equal(result.exitCode, 137);
  assert.equal(result.signal, 'SIGKILL');
  assert.match(result.result, /cause.*unknown/i);
  assert.equal(isToolProcessKilled(result), true);
});

for (const [label, before, after] of [
  ['stale counters', memory(23), memory(23)],
  ['reset counters', memory(23), memory(0)],
  ['unreadable before', null, memory(23)],
  ['different cgroup', memory(0), { ...memory(23), path: '/another' }],
  ['unidentified cgroup', { oomKills: 0 }, { oomKills: 23 }],
  ['no cgroup', null, null],
]) {
  test(`SIGKILL does not attribute OOM from ${label}`, { timeout: 10000 }, async () => {
    const { result } = await replay({ before, after });
    assert.match(result.result, /cause.*unknown/i);
    assert.doesNotMatch(result.result, /OOM kills.*during this attempt/);
  });
}

test('plain stderr failure survives chunk splitting and an unterminated final line', { timeout: 10000 }, async () => {
  const { result } = await replay({ code: 1, stderr: ['Error: invalid con', 'figuration: model is missing'], before: null, after: null });
  assert.match(result.result, /exit code 1.*invalid configuration: model is missing/);
  assert.equal(result.errorInfo.hasError, true);
});

test('telemetry echoes and command stderr are not promoted to the CLI failure cause', { timeout: 10000 }, async () => {
  const { result } = await replay({ code: 1, stderr: ['2026-10-07 ERROR codex.tool_result output="Error: fake capacity failure"\n', '{"type":"turn.failed","error":{"message":"echoed error"}}'], before: null, after: null });
  assert.match(result.result, /exit code 1/);
  assert.doesNotMatch(result.result, /fake capacity|echoed error/);
});

test('authoritative turn failure retains priority and process metadata', { timeout: 10000 }, async () => {
  const { result } = await replay({ code: 1, events: [...started, { type: 'turn.failed', error: { message: 'Invalid API key' } }], stderr: ['Error: unrelated diagnostic\n'] });
  assert.equal(result.result, 'Invalid API key');
  assert.equal(result.exitCode, 1);
  assert.equal(result.signal, null);
});

test('completed turns remain successful despite historical OOM counters and stderr', { timeout: 10000 }, async () => {
  const { result } = await replay({ code: 0, events: [...started, { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } }], stderr: ['Error: echoed warning\n'] });
  assert.equal(result.success, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.errorInfo, undefined);
});

test('SIGKILL is not mistaken for an echoed usage limit in the last command output', { timeout: 10000 }, async () => {
  const { result } = await replay({ events: [...started, { type: 'item.completed', item: { id: 'cmd', type: 'command_execution', command: 'cat previous.log', aggregated_output: "You've hit your usage limit", status: 'completed', exit_code: 0 } }] });
  assert.equal(result.limitReached, false);
  assert.equal(isToolProcessKilled(result), true);
  assert.match(result.result, /SIGKILL/);
});
