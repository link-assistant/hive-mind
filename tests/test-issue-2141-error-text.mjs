#!/usr/bin/env node

/**
 * Issue #2141: "AGENT execution failed with Agent reported error: [object Object]"
 *
 * The agent CLI (`@link-assistant/agent` 0.25.x) emits `NamedError.toObject()`
 * payloads — `{"type":"error","error":{"name":"…","data":{"message":"…"}}}` —
 * and every adapter interpolated that object straight into a template literal,
 * so the published failure reason was `[object Object]` and the real cause was
 * lost (no `--attach-logs`, no log, nothing to diagnose).
 *
 * These tests lock the readable rendering in place for the shared helper, for
 * each tool adapter that consumes it, and for the downstream failure-message
 * formatter that publishes the reason to GitHub.
 */

import { strict as assert } from 'assert';

import { stringifyErrorValue, firstErrorText, isPlaceholderErrorText } from '../src/error-text.lib.mjs';
import { extractAgentErrorText, detectAgentErrorsInOutput, detectFatalAgentLogRecord } from '../src/agent.lib.mjs';
import { buildPrePullRequestFailureComment } from '../src/solve.pre-pr-failure-notifier.lib.mjs';
import { extractToolErrorCore, formatToolExecutionFailure, isMeaningfulErrorText } from '../src/lib.mjs';
import { parseQwenStreamJsonOutput } from '../src/qwen.lib.mjs';

let failures = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  ❌ ${name}`);
    console.log(`     ${error?.message || error}`);
  }
};

const assertReadable = (value, label) => {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.ok(!value.includes('[object Object]'), `${label} must not contain [object Object] (got: ${value})`);
  assert.ok(value.trim().length > 0, `${label} must not be empty`);
};

console.log('\nIssue #2141 — structured error payloads must render as readable text\n');

console.log('stringifyErrorValue');

test('renders the agent NamedError shape {name, data:{message}}', () => {
  const rendered = stringifyErrorValue({ name: 'RetryTimeoutExceededError', data: { message: 'Retry timeout exceeded after 10 attempts' } });
  assertReadable(rendered, 'rendered');
  assert.ok(rendered.includes('RetryTimeoutExceededError'), rendered);
  assert.ok(rendered.includes('Retry timeout exceeded after 10 attempts'), rendered);
});

test('keeps the error name when data carries no message', () => {
  const rendered = stringifyErrorValue({ name: 'ProviderModelNotFoundError', data: { providerID: 'formal-ai', modelID: 'gpt-5' } });
  assertReadable(rendered, 'rendered');
  assert.ok(rendered.includes('ProviderModelNotFoundError'), rendered);
});

test('unwraps a nested {error:{…}} envelope', () => {
  const rendered = stringifyErrorValue({ type: 'error', error: { name: 'UnknownError', data: { message: 'boom' } } });
  assertReadable(rendered, 'rendered');
  assert.ok(rendered.includes('boom'), rendered);
});

test('passes strings through and handles Error instances', () => {
  assert.equal(stringifyErrorValue('  plain failure  '), 'plain failure');
  assert.ok(stringifyErrorValue(new TypeError('bad input')).includes('bad input'));
});

test('returns the fallback for empty, null and placeholder payloads', () => {
  assert.equal(stringifyErrorValue(null, { fallback: 'none' }), 'none');
  assert.equal(stringifyErrorValue(undefined, { fallback: 'none' }), 'none');
  assert.equal(stringifyErrorValue({}, { fallback: 'none' }), 'none');
  assert.equal(stringifyErrorValue('', { fallback: 'none' }), 'none');
});

test('never throws on circular payloads', () => {
  const circular = { type: 'error' };
  circular.self = circular;
  const rendered = stringifyErrorValue(circular, { fallback: 'unknown' });
  assert.equal(typeof rendered, 'string');
  assert.ok(!rendered.includes('[object Object]'), rendered);
});

test('truncates very long payloads', () => {
  const rendered = stringifyErrorValue({ message: 'x'.repeat(5000) }, { maxLength: 100 });
  assert.ok(rendered.length < 200, `expected truncation, got ${rendered.length} chars`);
  assert.ok(rendered.includes('truncated'), rendered);
});

test('firstErrorText picks the first readable candidate', () => {
  assert.equal(firstErrorText([null, '', { name: 'Boom' }], { fallback: 'none' }), 'Boom');
  assert.equal(firstErrorText([null, ''], { fallback: 'none' }), 'none');
});

test('isPlaceholderErrorText recognises the [object Object] symptom', () => {
  assert.equal(isPlaceholderErrorText('[object Object]'), true);
  assert.equal(isPlaceholderErrorText('real failure'), false);
});

console.log('\nagent adapter (src/agent.lib.mjs)');

// Verbatim shape produced by @link-assistant/agent 0.25.5 `outputJsonEvent('error', { error: props.error })`.
const AGENT_ERROR_RECORD = {
  type: 'error',
  timestamp: 1785000000000,
  sessionID: 'ses_2141',
  error: { name: 'RetryTimeoutExceededError', data: { message: 'Retry timeout exceeded' } },
};

test('extractAgentErrorText renders the streamed error object', () => {
  const rendered = extractAgentErrorText(AGENT_ERROR_RECORD, JSON.stringify(AGENT_ERROR_RECORD));
  assertReadable(rendered, 'rendered');
  assert.ok(rendered.includes('RetryTimeoutExceededError'), rendered);
});

test('detectAgentErrorsInOutput reports a readable match for NDJSON output', () => {
  const output = `{"type":"log","level":"info","message":"starting"}\n${JSON.stringify(AGENT_ERROR_RECORD)}\n`;
  const detection = detectAgentErrorsInOutput(output);
  assert.equal(detection.detected, true, 'error must be detected');
  assertReadable(detection.match, 'detection.match');
  assert.ok(detection.match.includes('RetryTimeoutExceededError'), detection.match);
});

test('detectAgentErrorsInOutput still ignores non-error records', () => {
  const detection = detectAgentErrorsInOutput('{"type":"tool","state":{"status":"completed","output":"Permission denied"}}');
  assert.equal(detection.detected, false);
});

test('the published failure reason no longer degrades to [object Object]', () => {
  const detection = detectAgentErrorsInOutput(JSON.stringify(AGENT_ERROR_RECORD));
  const message = `Agent reported error: ${detection.match}`;
  assertReadable(message, 'failure reason');
});

console.log('\nsilent startup failure (agent CLI exits 0 without an error event)');

// Verbatim record from `agent --model nonexistent-provider/nope` with agent CLI 0.25.5
// (docs/case-studies/issue-2141/raw/agent-0.25.5-unknown-model-stdout.ndjson).
const FATAL_LOG_RECORD = {
  type: 'log',
  level: 'error',
  service: 'session.prompt',
  error: 'ProviderModelNotFoundError',
  hint: 'Check that the model exists in the provider',
  message: 'Failed to initialize specified model - NOT falling back to default (explicit provider specified)',
};

test('detectFatalAgentLogRecord reports the startup failure readably', () => {
  const detected = detectFatalAgentLogRecord(FATAL_LOG_RECORD);
  assertReadable(detected, 'fatal log text');
  assert.ok(detected.includes('ProviderModelNotFoundError'), detected);
  assert.ok(detected.includes('Check that the model exists in the provider'), detected);
});

test('detectFatalAgentLogRecord ignores ordinary log noise', () => {
  assert.equal(detectFatalAgentLogRecord({ type: 'log', level: 'error', service: 'tool', message: 'bash exited 1' }), null);
  assert.equal(detectFatalAgentLogRecord({ type: 'log', level: 'info', message: 'ProviderModelNotFoundError mentioned in prose' }), null);
  assert.equal(detectFatalAgentLogRecord(null), null);
  assert.equal(detectFatalAgentLogRecord({ type: 'error', error: 'boom' }), null);
});

console.log('\nqwen adapter (src/qwen.lib.mjs)');

test('qwen error events render structured payloads readably', () => {
  const state = parseQwenStreamJsonOutput(JSON.stringify({ type: 'error', error: { name: 'ProviderAuthError', data: { message: 'invalid api key' } } }));
  assert.ok(state.errors.length > 0, 'expected an error entry');
  assertReadable(state.errors[0].message, 'qwen error message');
  assert.ok(state.errors[0].message.includes('invalid api key'), state.errors[0].message);
});

console.log('\ndownstream failure formatting (src/lib.mjs)');

test('isMeaningfulErrorText rejects [object Object]', () => {
  assert.equal(isMeaningfulErrorText('[object Object]'), false);
});

test('extractToolErrorCore drops a core polluted by [object Object]', () => {
  const core = extractToolErrorCore({ toolResult: { errorInfo: { message: 'Agent reported error: [object Object]' } } });
  assert.equal(core, null, `expected null, got ${core}`);
});

test('formatToolExecutionFailure never publishes [object Object]', () => {
  const message = formatToolExecutionFailure({ tool: 'agent', toolResult: { errorInfo: { message: 'Agent reported error: [object Object]' } } });
  assert.equal(message, 'AGENT execution failed');
  assertReadable(message, 'failure message');
});

test('formatToolExecutionFailure keeps a readable core', () => {
  const message = formatToolExecutionFailure({ tool: 'agent', toolResult: { errorInfo: { message: 'Agent reported error: RetryTimeoutExceededError: Retry timeout exceeded' } } });
  assert.equal(message, 'AGENT execution failed with Agent reported error: RetryTimeoutExceededError: Retry timeout exceeded');
});

console.log('\nfailure notification (src/solve.pre-pr-failure-notifier.lib.mjs)');

test('the failure comment explains how to make the next run diagnosable', () => {
  const body = buildPrePullRequestFailureComment({
    reason: 'AGENT execution failed',
    owner: 'link-assistant',
    repo: 'hive-mind',
    issueNumber: 2141,
    argv: { tool: 'agent', model: 'formal-ai' },
    logAttachmentAttempted: false,
  });
  assert.ok(body.includes('--attach-logs'), 'must name the flag');
  assert.ok(body.includes('--verbose'), 'must recommend verbose output for the next run');
  assert.ok(!body.includes('[object Object]'), body);
});

console.log('');

if (failures > 0) {
  console.error(`❌ ${failures} test(s) failed`);
  process.exit(1);
}

console.log('✅ All issue #2141 error-text tests passed');
