#!/usr/bin/env node
/**
 * Issue #4077: "CLAUDE execution failed with } ReadableStream { locked: false, state: 'readable', supportsBYOB: false }".
 *
 * With `--verbose`, hive-mind runs Claude Code with ANTHROPIC_LOG=debug. For every
 * streamed response `@anthropic-ai/sdk` (internal/parse.ts) prints
 * `debug('response', status, url, headers, body)`: the only SDK debug line without
 * a `[log_<id>]` prefix. It was not recognised as debug output, so each of its
 * lines became `lastMessage`. When the CLI was SIGKILLed (exit 137, the container
 * OOM killer), the last such line — `} ReadableStream {…}` — was published as the
 * failure reason.
 *
 * Fixture: one complete request cycle copied from the failing run's stdout
 * (docs/case-studies/issue-4077), with IDs replaced by placeholders.
 *
 * Run with: node --test tests/issue-4077-sdk-debug-fragment-error.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createClaudeUsageLimitEvidence } from '../src/claude.usage-limit-sources.lib.mjs';
import { isSourceFragmentErrorText } from '../src/error-text.lib.mjs';
import { isMeaningfulErrorText, buildToolErrorMessage, extractToolErrorCore, formatToolExecutionFailure } from '../src/lib.mjs';
import { describeExitCode } from '../src/claude.process-exit.lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CYCLE = readFileSync(path.join(here, 'fixtures/issue-4077/claude-stdout-sdk-debug-cycle.txt'), 'utf8').replace(/\n$/, '').split('\n');
const REPORTED = "} ReadableStream { locked: false, state: 'readable', supportsBYOB: false }";
// Node prints small Headers on one line (reproduced with experiments/issue-4077/sdk-stream-debug-log.mjs, @anthropic-ai/sdk 1.8.0).
const NODE_ONE_LINE = "response 200  Headers { 'content-type': 'text/event-stream', 'request-id': 'req_example' } ReadableStream { locked: false, state: 'readable', supportsBYOB: true }";

/** The stdout capture rule from src/claude.lib.mjs: which non-JSON line becomes `lastMessage`. */
const captureLastMessage = (lines, initial = '') => {
  const evidence = createClaudeUsageLimitEvidence();
  let lastMessage = initial;
  for (const line of lines) {
    if (!evidence.observeRawLine(line).isDebugOutput && !isSourceFragmentErrorText(line)) lastMessage = line;
  }
  return { lastMessage, evidence };
};

test('every line of a real SDK debug cycle is recognised as debug output', () => {
  const evidence = createClaudeUsageLimitEvidence();
  const leaked = CYCLE.filter(line => !evidence.observeRawLine(line).isDebugOutput);
  assert.deepEqual(leaked, []);
  assert.ok(CYCLE.includes(REPORTED), 'fixture contains the reported line');
});

test('the debug detector alone (without the fragment guard) no longer leaks the cycle', () => {
  const evidence = createClaudeUsageLimitEvidence();
  let lastMessage = 'API Error: earlier real failure';
  for (const line of CYCLE) if (!evidence.observeRawLine(line).isDebugOutput) lastMessage = line;
  assert.equal(lastMessage, 'API Error: earlier real failure');
});

test('a SIGKILL right after the debug cycle reports the exit code, not the dump', () => {
  const { lastMessage } = captureLastMessage(CYCLE);
  assert.equal(lastMessage, '');
  const message = buildToolErrorMessage({ lastMessage, exitCode: 137, fallback: `Claude command failed with exit code ${describeExitCode(137)}`, toolLabel: 'Claude' });
  assert.equal(message, 'Claude command failed with exit code 137 (SIGKILL)');
  assert.equal(formatToolExecutionFailure({ tool: 'claude', toolResult: { success: false, errorInfo: { message, exitCode: 137 } } }), 'CLAUDE execution failed with Claude command failed with exit code 137 (SIGKILL)');
});

test('the debug block state is per stream and survives repeated cycles', () => {
  const { lastMessage } = captureLastMessage([...CYCLE, ...CYCLE, 'Error: real failure text', ...CYCLE]);
  assert.equal(lastMessage, 'Error: real failure text');
});

test('the one-line Node form of the SDK response dump is debug output', () => {
  const evidence = createClaudeUsageLimitEvidence();
  assert.equal(evidence.observeRawLine(NODE_ONE_LINE).isDebugOutput, true);
  // It did not open a block, so the next real line is still captured.
  assert.equal(evidence.observeRawLine('Error: real failure text').isDebugOutput, false);
});

test('the multi-line form opens a block that ends at the `} ReadableStream` line', () => {
  const evidence = createClaudeUsageLimitEvidence();
  assert.equal(evidence.observeRawLine('response 429 https://api.anthropic.com/v1/messages?beta=true Headers {').isDebugOutput, true);
  assert.equal(evidence.observeRawLine('  "retry-after": "12",').isDebugOutput, true);
  assert.equal(evidence.observeRawLine(REPORTED).isDebugOutput, true);
  assert.equal(evidence.observeRawLine('Error: real failure text').isDebugOutput, false);
});

test('the `[log_<id>, request-id: …] post … succeeded` summary is debug output', () => {
  const evidence = createClaudeUsageLimitEvidence();
  const line = '[log_345fb5, anthropic-workspace-id: "wrkspc_EXAMPLE", request-id: "req_EXAMPLE"] post https://api.anthropic.com/v1/messages?beta=true succeeded with status 200 in 612ms';
  assert.equal(evidence.observeRawLine(line).isDebugOutput, true);
});

test('the publishing boundary rejects the reported fragment for every tool', () => {
  assert.equal(isMeaningfulErrorText(REPORTED), false);
  assert.equal(extractToolErrorCore({ toolResult: { errorInfo: { message: REPORTED } } }), null);
  for (const tool of ['claude', 'codex', 'agent', 'opencode', 'gemini', 'qwen']) {
    assert.equal(formatToolExecutionFailure({ tool, toolResult: { success: false, errorInfo: { message: REPORTED } } }), `${tool.toUpperCase()} execution failed`);
  }
  assert.equal(buildToolErrorMessage({ lastMessage: REPORTED, exitCode: 137, fallback: 'Claude command failed with exit code 137 (SIGKILL)', toolLabel: 'Claude' }), 'Claude command failed with exit code 137 (SIGKILL)');
});

test('source, inspection and debug fragments are not error text', () => {
  const fragments = [REPORTED, NODE_ONE_LINE, '} catch (error) {', "} from '@features/wb/shared/product-position-search';", '}, {', ']);', '  "content-type": "text/event-stream; charset=utf-8",', "'content-type': 'text/event-stream',", '    toReadableStream: [Function: toReadableStream],', '    iterator: [AsyncGeneratorFunction: E],', '      messages: [Array ...],', '      metadata: [Object ...],', '[log_345fb5] response parsed {', '[log_345fb5, request-id: "req_EXAMPLE"] post https://api.anthropic.com/v1/messages succeeded with status 200 in 612ms', '    at processTicksAndRejections (node:internal/process/task_queues:105:5)', '    at async file:///app/src/claude.lib.mjs:812:7', `${REPORTED}\nsecond line`];
  for (const fragment of fragments) {
    assert.equal(isSourceFragmentErrorText(fragment), true, `expected ${JSON.stringify(fragment)} to be a fragment`);
    assert.equal(isMeaningfulErrorText(fragment), false, `expected ${JSON.stringify(fragment)} to be rejected`);
  }
});

test('real failure reasons are still accepted', () => {
  const reasons = ['API Error: Output blocked by content filtering policy', 'API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}', "API Error: 400 {'type': 'error'}", 'Error: ENOSPC: no space left on device, write', "TypeError: Cannot read properties of null (reading 'type')", 'SyntaxError: Unexpected token {', 'Request timed out', 'Your organization has disabled Claude subscription access for Claude Code', 'Claude command failed with exit code 137 (SIGKILL)', "You've hit your weekly limit · resets 11am (UTC)", 'Ошибка сервера', 'attempt to log in at the response 200 page failed'];
  for (const reason of reasons) {
    assert.equal(isSourceFragmentErrorText(reason), false, `expected ${JSON.stringify(reason)} to be kept`);
    assert.equal(isMeaningfulErrorText(reason), true, `expected ${JSON.stringify(reason)} to be meaningful`);
  }
  assert.equal(isSourceFragmentErrorText(null), false);
  assert.equal(isSourceFragmentErrorText(''), false);
});

test('describeExitCode names the signal used in the Claude fallback', () => {
  assert.equal(describeExitCode(137), '137 (SIGKILL)');
  assert.equal(describeExitCode(1), '1');
});
