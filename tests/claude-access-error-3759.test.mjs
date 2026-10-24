/**
 * @hive-mind-test-suite default
 * Issue #3759: an opaque body concatenated with an SDK 403 summary became the failure reason.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { replay, SESSION_ID } from '../experiments/issue-3759/replay.mjs';
import { formatToolExecutionFailure, isMeaningfulErrorText } from '../src/lib.mjs';
import { createClaudeUsageLimitEvidence } from '../src/claude.usage-limit-sources.lib.mjs';
import { resolveClaudeAccessError } from '../src/claude.access-error.lib.mjs';
import { formatSubscriptionErrorReport } from '../src/subscription-error.lib.mjs';
import { parseSubscriptionBlockFromLog, formatSubscriptionBlockedSection } from '../src/subscription-block-telegram.lib.mjs';

const rawLines = JSON.parse(readFileSync(new URL('../docs/case-studies/issue-3759/data/replay.json', import.meta.url), 'utf8'));
const init = { type: 'system', subtype: 'init', session_id: SESSION_ID, model: 'claude-opus-5-5' };
const working = { type: 'assistant', message: { content: [{ type: 'text', text: 'Taking screenshots.' }] } };
const warning = { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', utilization: 0.99, resetsAt: 1792886400, rateLimitType: 'seven_day' } };
const cancelled = 'Your subscription has ended because it was cancelled.';
const transcript = text => [JSON.stringify({ type: 'assistant', isApiErrorMessage: true, error: 'billing_error', message: { model: '<synthetic>', content: [{ type: 'text', text }] } })];

test('replay the incident: missing result, exit 1, 403, and 99% warning', { timeout: 15000 }, async () => {
  const { result, calls, logs } = await replay({ events: [init, working, warning], rawLines });
  assert.equal(result.success, false);
  assert.equal(result.limitReached, false);
  assert.ok(result.subscriptionError, 'HTTP access refusal must reach the shared access report');
  assert.equal(result.subscriptionError.apiErrorStatus, 403);
  assert.match(result.errorInfo.message, /HTTP 403/);
  assert.match(result.subscriptionError.reason, /cancelled|expired/);
  assert.match(result.subscriptionError.reason, /does not identify|not.*confirm|unknown/);
  assert.equal(calls, 1);
  assert.ok(logs.some(line => /Access-error cross-check/.test(line)));
  const report = formatSubscriptionErrorReport(result.subscriptionError, { sessionId: SESSION_ID, committed: true, resumeCommand: 'solve --resume session' });
  const section = formatSubscriptionBlockedSection(parseSubscriptionBlockFromLog(report.join('\n')));
  assert.match(section, /403/);
  assert.match(section, /cancelled|expired/);
  assert.match(section, /renew|reactivate/i);
  assert.doesNotMatch(formatToolExecutionFailure({ tool: 'claude', toolResult: result }), /7zUsXZ/);
});

for (const newline of [true, false]) {
  test(`an explicit cancellation in the transcript supplies the diagnosis (newline=${newline})`, { timeout: 15000 }, async () => {
    const { result } = await replay({ events: [init, working, warning], rawLines, transcript: transcript(cancelled), newline });
    assert.equal(result.subscriptionError?.kind, 'billing');
    assert.equal(result.subscriptionError.message, cancelled);
    assert.equal(result.errorInfo.message, cancelled);
    assert.equal(result.limitReached, false);
  });
}

test('the shared error boundary rejects pure and concatenated opaque dumps for every tool', () => {
  for (const message of [rawLines[0], 'A'.repeat(160)]) {
    assert.equal(isMeaningfulErrorText(message), false);
    for (const tool of ['claude', 'codex', 'agent', 'opencode', 'gemini', 'qwen']) {
      assert.equal(formatToolExecutionFailure({ tool, toolResult: { errorInfo: { message } } }), `${tool.toUpperCase()} execution failed`);
    }
  }
});

test('SDK summary is debug output even when concatenated with a base64 body', () => {
  const evidence = createClaudeUsageLimitEvidence();
  assert.equal(evidence.observeRawLine(rawLines[0]).isDebugOutput, true);
  assert.equal(evidence.snapshot().debugApiError?.status, 403);
  assert.equal(evidence.snapshot().debugApiError?.requestId, 'req_011CgMM7s2E3s8XGWrwAMd1U');
});

test('a successful terminal result never becomes an access failure', { timeout: 15000 }, async () => {
  const { result } = await replay({ events: [init, { type: 'result', subtype: 'success', is_error: false, result: 'Done.' }], rawLines, exitCode: 0 });
  assert.equal(result.success, true);
  assert.equal(result.subscriptionError, undefined);
});

for (const stderr of [true, false]) {
  for (const newline of [true, false]) {
    test(`SDK response block alone survives arbitrary stream chunks (stderr=${stderr}, newline=${newline})`, { timeout: 15000 }, async () => {
      const { result, calls } = await replay({ events: stderr ? [] : [init, working], rawLines: rawLines.slice(1), stderr, newline });
      assert.equal(result.subscriptionError?.kind, 'access_denied');
      assert.equal(result.subscriptionError.code, null, 'do not invent a provider error code');
      assert.equal(calls, 1);
    });
  }
}

test('a bare 403 without a response block is recovered from the concatenated summary', { timeout: 15000 }, async () => {
  const { result } = await replay({ events: [init, working], rawLines: [rawLines[0]], newline: false });
  assert.equal(result.subscriptionError?.kind, 'access_denied');
});

test('ordinary prose and a file permission error remain meaningful', () => {
  assert.equal(isMeaningfulErrorText('EACCES: permission denied opening a file'), true);
  assert.equal(isMeaningfulErrorText('API Error: 400 prompt is too long'), true);
});

test('a subsequent assistant turn clears a recovered SDK access error', () => {
  const evidence = createClaudeUsageLimitEvidence();
  for (const line of rawLines) evidence.observeRawLine(line);
  assert.equal(evidence.snapshot().debugApiError.status, 403);
  evidence.observeEvent(working);
  assert.equal(evidence.snapshot().debugApiError, null);
});

test('unrelated endpoints and non-access failures are not subscription failures', async () => {
  const evidence = createClaudeUsageLimitEvidence();
  for (const line of rawLines.slice(1)) evidence.observeRawLine(line.replace('api.anthropic.com/v1/messages', 'example.com/file'));
  assert.equal(evidence.snapshot().debugApiError, null);
  for (const status of [400, 401, 429, 500, 529]) {
    assert.equal(await resolveClaudeAccessError({ evidence: { debugApiError: { status } } }), null);
  }
  assert.equal(await resolveClaudeAccessError({ lastMessage: 'EACCES: permission denied opening a file' }), null);
});

test('a readable provider error takes precedence over a bare SDK 403', async () => {
  const evidence = { debugApiError: { status: 403 }, apiErrorText: 'API Error: model is unavailable' };
  assert.equal(await resolveClaudeAccessError({ evidence }), null);
  assert.equal(await resolveClaudeAccessError({ evidence: { debugApiError: { status: 403 } }, transcript: { found: true, text: 'API Error: model is unavailable' } }), null);
});

for (const mode of ['json', 'br']) {
  test(`an actual Claude CLI mock-403 trace retains the explicit cancellation (${mode})`, { timeout: 15000 }, async () => {
    const trace = readFileSync(new URL(`../docs/case-studies/issue-3759/data/probe-${mode}-stdout.log`, import.meta.url), 'utf8');
    const { result, calls } = await replay({ rawLines: trace.trimEnd().split('\n') });
    assert.equal(result.success, false);
    assert.equal(result.subscriptionError?.kind, 'billing');
    assert.match(result.subscriptionError.message, /subscription has ended because it was cancelled/);
    assert.equal(calls, 1);
  });
}
