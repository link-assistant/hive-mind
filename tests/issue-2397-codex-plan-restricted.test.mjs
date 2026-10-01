#!/usr/bin/env node
/**
 * Issue #2397: a lapsed ChatGPT plan must be reported as a plan problem.
 *
 * When the ChatGPT Pro subscription behind `codex login` ended mid-run, Codex
 * failed with
 *
 *   The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.
 *
 * (an HTTP 400 `invalid_request_error` from the Responses API). Nothing recognised
 * it, so the pull request only said "CODEX execution failed with ..." and gave no
 * hint that the subscription had to be renewed.
 *
 * Run with: node tests/issue-2397-codex-plan-restricted.test.mjs
 */

import assert from 'node:assert/strict';
import { detectSubscriptionError, formatSubscriptionErrorSummary, SUBSCRIPTION_ERROR_KINDS } from '../src/subscription-error.lib.mjs';
import { extractToolErrorCore, formatToolExecutionFailure } from '../src/lib.mjs';
import { isUsageLimitError } from '../src/usage-limit.lib.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}: ${error.message}`);
    failed++;
  }
}

const CODEX_MESSAGE = "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.";

test('the Codex ChatGPT-account model rejection is classified as plan restricted', () => {
  const info = detectSubscriptionError({ message: CODEX_MESSAGE, tool: 'codex' });
  assert.ok(info, 'expected a subscription classification');
  assert.equal(info.kind, SUBSCRIPTION_ERROR_KINDS.PLAN_RESTRICTED);
  assert.equal(info.tool, 'codex');
});

test('solve.mjs failure path classifies the rendered tool failure the same way', () => {
  // Mirrors src/solve.mjs: detectSubscriptionError({ message: extractToolErrorCore(...) || toolFailureMessage, tool }).
  const toolResult = { success: false, errorInfo: { message: CODEX_MESSAGE } };
  const toolFailureMessage = formatToolExecutionFailure({ tool: 'codex', toolResult });
  assert.equal(toolFailureMessage, `CODEX execution failed with ${CODEX_MESSAGE}`);
  const info = detectSubscriptionError({ message: extractToolErrorCore({ toolResult }) || toolFailureMessage, tool: 'codex' });
  assert.equal(info?.kind, SUBSCRIPTION_ERROR_KINDS.PLAN_RESTRICTED);
  // Even the already-prefixed message (what reached the comment on #76) is recognised.
  assert.equal(detectSubscriptionError({ message: toolFailureMessage, tool: 'codex' })?.kind, SUBSCRIPTION_ERROR_KINDS.PLAN_RESTRICTED);
});

test('guidance names the subscription page so a lapsed plan can be renewed', () => {
  const info = detectSubscriptionError({ message: CODEX_MESSAGE, tool: 'codex' });
  const guidance = info.guidance.join('\n');
  assert.match(guidance, /https:\/\/chatgpt\.com\/codex\/settings\/usage/);
  assert.match(guidance, /renew/i);
  assert.match(guidance, /--model/);
  assert.match(guidance, /codex login/);
});

test('summary used in the PR comment states the plan problem', () => {
  const info = detectSubscriptionError({ message: CODEX_MESSAGE, tool: 'codex' });
  const summary = formatSubscriptionErrorSummary(info, { tool: 'codex' });
  assert.match(summary, /^CODEX stopped: Current plan does not allow this request/);
  assert.match(summary, /not supported when using Codex with a ChatGPT account/);
});

test('the message is not mistaken for a usage limit', () => {
  assert.equal(isUsageLimitError(CODEX_MESSAGE), false);
});

test('the Codex rule does not fire for another tool', () => {
  assert.equal(detectSubscriptionError({ message: CODEX_MESSAGE, tool: 'claude' }), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
