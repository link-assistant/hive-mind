/**
 * @hive-mind-test-suite default
 *
 * Issue #4053: replay the reported Claude Code failure through executeClaudeCommand.
 * Claude Code 2.1.x emitted
 *   { type: "result", is_error: true, error: "authentication_failed", api_error_status: 403,
 *     result: "Failed to authenticate. API Error: 403 Attention Required! | Cloudflare" }
 * during a status.claude.com authentication incident; before the fix the run stopped on
 * the first occurrence. It is now re-checked by retrying (session preserved), and only a
 * persistent failure is reported, with the number of retries.
 */
// The replay harness reads these at import time; opt into two quick auth retries.
process.env.HIVE_MIND_MAX_AUTH_FAILURE_RETRIES = '2';
process.env.HIVE_MIND_INITIAL_AUTH_FAILURE_RETRY_DELAY_MS = '1';
process.env.HIVE_MIND_MAX_AUTH_FAILURE_RETRY_DELAY_MS = '1';
process.env.HIVE_MIND_PROVIDER_STATUS_CHECK = 'false';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { SUBSCRIPTION_BLOCKED_MARKER, formatSubscriptionErrorReport } from '../src/subscription-error.lib.mjs';

const { replay, SESSION_ID } = await import('../experiments/issue-3759/replay.mjs');

const CLOUDFLARE = 'Failed to authenticate. API Error: 403 Attention Required! | Cloudflare';
const init = { type: 'system', subtype: 'init', session_id: SESSION_ID, model: 'claude-opus-5-5' };
const cloudflareResult = { type: 'result', subtype: 'success', is_error: true, error: 'authentication_failed', api_error_status: 403, result: CLOUDFLARE, session_id: SESSION_ID };
const revokedResult = { ...cloudflareResult, api_error_status: 401, result: 'OAuth token revoked. Please run /login' };

test('a Cloudflare 403 reported as authentication_failed is retried before the run stops', { timeout: 30000 }, async () => {
  const { result, calls, logs } = await replay({ events: [init, cloudflareResult] });
  assert.equal(calls, 3, 'the first attempt plus two re-checks');
  assert.equal(result.success, false);
  assert.ok(result.subscriptionError, 'a persistent failure is still reported as an access error');
  assert.equal(result.subscriptionError.verification.retries, 2);
  assert.ok(logs.some(line => line.includes('Unconfirmed access error')));
  assert.ok(!logs.some(line => line.includes(SUBSCRIPTION_BLOCKED_MARKER)), 'no /hive stop marker while the error is only unconfirmed');
  assert.ok(logs.some(line => /Retry 1\/2/.test(line)));
  assert.ok(logs.some(line => /authentication failure persisted/.test(line)));
  assert.match(formatSubscriptionErrorReport(result.subscriptionError, { tool: 'claude' }).join('\n'), /Retried: 2 time\(s\)/);
});

test('an explicit "OAuth token revoked" still stops at once', { timeout: 30000 }, async () => {
  const { result, calls, logs } = await replay({ events: [init, revokedResult] });
  assert.equal(calls, 1);
  assert.equal(result.subscriptionError?.verifiable, false);
  assert.ok(logs.some(line => line.startsWith(SUBSCRIPTION_BLOCKED_MARKER)));
});

test('the real Claude Code 2.1.323 stream for a Cloudflare 403 page is re-checked, not a confirmed block', { timeout: 30000 }, async () => {
  // Recorded by experiments/issue-4053-probe-cloudflare-403.mjs: the code is on the assistant event, not on the result.
  const recorded = await readFile(new URL('../docs/case-studies/issue-4053/data/probe/claude-2.1.323-cloudflare-403-stream.jsonl', import.meta.url), 'utf8');
  const events = recorded
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
  assert.equal(events.find(event => event.type === 'assistant')?.error, 'authentication_failed');
  const { result, calls, logs } = await replay({ events });
  assert.equal(calls, 3);
  assert.equal(result.subscriptionError?.verification?.retries, 2);
  assert.ok(!logs.some(line => line.includes(SUBSCRIPTION_BLOCKED_MARKER)));
});
