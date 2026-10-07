/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyRetryableError } from '../src/tool-retry.lib.mjs';
import { detectSubscriptionError } from '../src/subscription-error.lib.mjs';

test('Codex cybersecurity refusal is terminal and carries rephrase/tool guidance', () => {
  const refusal = classifyRetryableError('This content was flagged for possible cybersecurity risk. If this seems wrong, try rephrasing your request.');
  assert.equal(refusal.isRetryable, false);
  assert.equal(refusal.isCapacity, false);
  assert.equal(refusal.isModelRefusal, true);
  assert.match(refusal.guidance, /--tool claude/);
  assert.match(refusal.guidance, /rephrase/);
});

test('Codex 401 is a login-required failure that stops the shared queue', () => {
  const error = detectSubscriptionError({ tool: 'codex', message: 'Codex authentication failed - 401 Unauthorized' });
  assert.equal(error?.kind, 'login_required');
  assert.equal(classifyRetryableError('Codex authentication failed - 401 Unauthorized').isSubscriptionError, true);
  assert.equal(detectSubscriptionError({ tool: 'claude', message: 'Codex authentication failed - 401 Unauthorized' }), null);
  assert.equal(detectSubscriptionError({ tool: 'codex', message: 'PR #401 Unauthorized route test' }), null);
});
