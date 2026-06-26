#!/usr/bin/env node
// Test file for issue #1990 — cross-tool coverage.
//
// Issue #1990 ("docker isolation failed with 2 tasks") was reproduced with
// `--tool codex` (see test-issue-1990-codex-incomplete-session-false-success.mjs)
// but the same class of bug — declaring SUCCESS on exit-0 without verifying the
// AI session actually completed — applies to every tool. This file covers the
// two additional tools whose stream-json output (adopted from the Claude Agent
// SDK schema) ends with a single terminal `result` event: gemini-cli and
// qwen-code. (claude already gates on its final result event via
// shouldFailClaudeStreamWithoutResult; opencode is intentionally excluded — its
// terminal `step_finish` event is not reliably flushed before a clean exit on
// some versions, upstream bug anomalyco/opencode#26855, so gating on it would
// turn genuine successes into failures.)
//
// Fix: getTerminalEventCompletionHealth() (src/tool-run-health.lib.mjs) flags an
// exit-0 run that did work but never emitted its terminal `result` event as
// incomplete, so it is registered as success:false and the session is preserved
// (argv.resume) for a context-preserving restart — mirroring codex/claude.

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { getTerminalEventCompletionHealth } = await import('../src/tool-run-health.lib.mjs');
const { executeGeminiCommand } = await import('../src/gemini.lib.mjs');
const { executeQwenCommand } = await import('../src/qwen.lib.mjs');

let passed = 0;
let failed = 0;

const test = (name, fn) => {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ❌ ${name}\n     ${error.message}`);
    failed++;
  }
};

const asyncTest = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ❌ ${name}\n     ${error.message}`);
    failed++;
  }
};

// ============================================================
// Section 1: the shared helper
// ============================================================
console.log('Testing cross-tool exit-0-but-incomplete false success (Issue #1990)\n');
console.log('=== 1. getTerminalEventCompletionHealth ===');

test('activity but no terminal result event is NOT healthy', () => {
  const health = getTerminalEventCompletionHealth({ eventCounts: { message: 2, tool_use: 1 }, hadActivity: true });
  assert.equal(health.healthy, false);
  assert.equal(health.incompleteSession, true);
  assert.match(health.reasons.join(' '), /never emitted its terminal completion event/i);
});

test('a terminal result event makes the run healthy', () => {
  const health = getTerminalEventCompletionHealth({ eventCounts: { message: 1, result: 1 }, hadActivity: true });
  assert.equal(health.healthy, true);
  assert.equal(health.reasons.length, 0);
});

test('no activity at all is not flagged', () => {
  const health = getTerminalEventCompletionHealth({ eventCounts: {}, hadActivity: false });
  assert.equal(health.healthy, true);
  assert.equal(health.incompleteSession, false);
});

test('disk-pressure is surfaced as diagnostics on an incomplete run', () => {
  const health = getTerminalEventCompletionHealth({
    eventCounts: { message: 1 },
    hadActivity: true,
    diskEvidenceTexts: [{ source: 'output', text: 'error: No space left on device (os error 28)' }],
  });
  assert.equal(health.incompleteSession, true);
  assert.equal(health.diskPressureDetected, true);
  assert.match(health.reasons.join(' '), /No space left on device/i);
});

test('a completed run that merely echoes a disk phrase is still healthy', () => {
  const health = getTerminalEventCompletionHealth({
    eventCounts: { message: 1, result: 1 },
    hadActivity: true,
    diskEvidenceTexts: [{ source: 'output', text: 'sed of an old log mentioning No space left on device' }],
  });
  assert.equal(health.healthy, true);
  assert.equal(health.reasons.length, 0, 'a completed run has no failure reasons even if a disk phrase was echoed');
});

// ============================================================
// Section 2: gemini end-to-end
// ============================================================
console.log('\n=== 2. executeGeminiCommand ===');

const geminiDollar = jsonl => () => () => ({
  stream: async function* stream() {
    yield { type: 'stdout', data: Buffer.from(jsonl) };
    yield { type: 'exit', code: 0 };
  },
});

const runGemini = async (jsonl, argv = {}) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-1990-'));
  const logLines = [];
  const fullArgv = { model: 'flash', verbose: false, ...argv };
  const result = await executeGeminiCommand({
    tempDir,
    branchName: 'issue-1990-test',
    prompt: 'Proceed.\n',
    systemPrompt: '',
    argv: fullArgv,
    log: async message => logLines.push(String(message)),
    formatAligned: (icon, label, value = '') => [icon, label, value].filter(Boolean).join(' '),
    getResourceSnapshot: async () => ({ memory: 'Mem:\nMemAvailable: ok', load: '0.1' }),
    geminiPath: 'gemini',
    $: geminiDollar(jsonl),
  });
  await fs.rm(tempDir, { recursive: true, force: true });
  return { result, logLines, argv: fullArgv };
};

const GEMINI_INCOMPLETE = ['{"type":"init","sessionId":"gemini-1990","model":"gemini-2.5-flash"}', '{"type":"message","content":"Compiling formal-ai..."}'].join('\n') + '\n';
const GEMINI_COMPLETE = ['{"type":"init","sessionId":"gemini-1990","model":"gemini-2.5-flash"}', '{"type":"message","content":"done"}', '{"type":"result","response":"completed","stats":{"models":{"gemini-2.5-flash":{"tokens":{"input":5,"output":2,"total":7}}}}}'].join('\n') + '\n';
const GEMINI_INCOMPLETE_DISK = ['{"type":"init","sessionId":"gemini-1990"}', '{"type":"message","content":"error: could not compile: No space left on device (os error 28)"}'].join('\n') + '\n';

await asyncTest('gemini exit-0 with activity but no result event is registered as failure + preserves session', async () => {
  const { result, logLines, argv } = await runGemini(GEMINI_INCOMPLETE);
  assert.equal(result.success, false, 'a gemini run cut off before its result event must fail');
  assert.equal(result.incompleteSession, true);
  assert.equal(argv.resume, 'gemini-1990', 'session must be preserved for a context-preserving restart');
  assert.ok(logLines.some(line => line.includes('did not complete')));
});

await asyncTest('gemini incomplete run WITH disk pressure surfaces disk diagnostics', async () => {
  const { result, logLines } = await runGemini(GEMINI_INCOMPLETE_DISK);
  assert.equal(result.success, false);
  assert.equal(result.diskPressureDetected, true);
  assert.ok(logLines.some(line => line.includes('Disk-exhaustion evidence')));
});

await asyncTest('gemini run that reaches its result event still succeeds', async () => {
  const { result } = await runGemini(GEMINI_COMPLETE);
  assert.equal(result.success, true);
  assert.equal(result.resultSummary, 'completed');
});

// ============================================================
// Section 3: qwen end-to-end
// ============================================================
console.log('\n=== 3. executeQwenCommand ===');

const qwenDollar = jsonl => () => () => ({
  async *stream() {
    yield { type: 'stdout', data: Buffer.from(jsonl) };
    yield { type: 'exit', code: 0 };
  },
});

const runQwen = async (jsonl, argv = {}) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qwen-1990-'));
  const logLines = [];
  const fullArgv = { model: 'qwen', url: 'https://github.com/link-assistant/hive-mind/issues/1990', verbose: false, ...argv };
  const result = await executeQwenCommand({
    tempDir,
    branchName: 'issue-1990-test',
    prompt: 'Proceed.',
    systemPrompt: '',
    argv: fullArgv,
    log: async message => logLines.push(String(message)),
    formatAligned: (_icon, label, value = '') => `${label} ${value}`.trim(),
    getResourceSnapshot: async () => ({ memory: '\nMem: 1 2', load: '0.00' }),
    waitForRetryDelay: async () => {},
    qwenPath: 'qwen',
    $: qwenDollar(jsonl),
  });
  await fs.rm(tempDir, { recursive: true, force: true });
  return { result, logLines, argv: fullArgv };
};

const QWEN_INCOMPLETE = '{"type":"session.started","session_id":"session-1990"}\n{"type":"assistant","message":{"content":"running cargo build"}}\n';
const QWEN_COMPLETE = '{"type":"session.started","session_id":"session-1990"}\n{"type":"result","result":"Final answer."}\n';
const QWEN_INCOMPLETE_DISK = '{"type":"session.started","session_id":"session-1990"}\n{"type":"assistant","message":{"content":"rustc: No space left on device (os error 28)"}}\n';

await asyncTest('qwen exit-0 with activity but no result event is registered as failure + preserves session', async () => {
  const { result, logLines, argv } = await runQwen(QWEN_INCOMPLETE);
  assert.equal(result.success, false, 'a qwen run cut off before its result event must fail');
  assert.equal(result.incompleteSession, true);
  assert.equal(argv.resume, 'session-1990', 'session must be preserved for a context-preserving restart');
  assert.ok(logLines.some(line => line.includes('did not complete')));
});

await asyncTest('qwen incomplete run WITH disk pressure surfaces disk diagnostics', async () => {
  const { result, logLines } = await runQwen(QWEN_INCOMPLETE_DISK);
  assert.equal(result.success, false);
  assert.equal(result.diskPressureDetected, true);
  assert.ok(logLines.some(line => line.includes('Disk-exhaustion evidence')));
});

await asyncTest('qwen run that reaches its result event still succeeds', async () => {
  const { result } = await runQwen(QWEN_COMPLETE);
  assert.equal(result.success, true);
  assert.equal(result.resultSummary, 'Final answer.');
});

// ============================================================
// Summary
// ============================================================
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
  process.exit(1);
}
console.log('\n✅ All issue #1990 multi-tool tests passed');
