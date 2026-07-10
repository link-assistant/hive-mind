#!/usr/bin/env node
// Test file for issue #1949: "Retry-able results should not lead to switching to
// fallback model selected by solve command."
//
// Background
// ----------
// When a tool run hits a *transient*, retryable condition the solver retries the
// same session. Previously a server-wide "Overloaded" (HTTP 529) was classified as
// a model-*capacity* problem (isCapacity: true), which made
// maybeSwitchToFallbackModel() mutate the user's chosen `--model` (e.g. opus ->
// opus-4-7) on every overload. That is wrong: 529 is a transient server overload,
// not a signal that the *model* is full. The requested model should stay stable and
// be retried; Claude Code's own `--fallback-model` flag handles per-request
// fallback without us rewriting the user's `--model`.
//
// This test pins three guarantees from issue #1949:
//   (R1) A retryable/transient error (overload/timeout/429/socket) is classified
//        with isCapacity === false and does NOT switch `--model`.
//        A genuine model-capacity error (isCapacity === true) still switches.
//   (R2) Warnings render the resolved full model ID alongside the alias, e.g.
//        "opus (claude-opus-4-8)" — never a bare ambiguous "opus".
//
// Reference: confusion in PR #1947's comment ("what does opus mean?").

import assert from 'assert';
import { classifyRetryableError, formatModelWithResolvedId, maybeSwitchToFallbackModel } from '../src/tool-retry.lib.mjs';
import { resolveModelId } from '../src/models/index.mjs';

console.log('Testing overload → no --model switch (Issue #1949)\n');

let passed = 0;
let failed = 0;

const test = (name, fn) => {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${error.message}`);
    failed++;
  }
};

// Async variant for the maybeSwitchToFallbackModel cases.
const testAsync = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${error.message}`);
    failed++;
  }
};

// A log() stub that records every (message, opts) pair so we can assert on what the
// user would actually see.
const makeLogSpy = () => {
  const calls = [];
  const log = async (message, opts = {}) => {
    calls.push({ message, opts });
  };
  log.calls = calls;
  log.text = () => calls.map(c => c.message).join('\n');
  return log;
};

// ============================================================
// Section 1: Classification — overload is transient, not capacity
// ============================================================
console.log('=== 1. Overload (529) is transient, not a capacity error ===');

const OVERLOAD_CASES = ['Overloaded', 'API Error: 529 Overloaded', 'overloaded_error', 'Error: Overloaded (overloaded_error)'];

for (const message of OVERLOAD_CASES) {
  test(`retryable but NOT capacity: "${message.slice(0, 48)}"`, () => {
    const result = classifyRetryableError(message);
    assert.strictEqual(result.isRetryable, true, `"${message}" must be retryable`);
    assert.strictEqual(result.isCapacity, false, `"${message}" must NOT be a capacity error (Issue #1949)`);
  });
}

test('genuine "selected model is at capacity" IS a capacity error', () => {
  // This is the one case that legitimately warrants switching the model: the API
  // explicitly says the selected model is full. It must keep isCapacity: true.
  const result = classifyRetryableError('The selected model is at capacity. Please try again.');
  assert.strictEqual(result.isRetryable, true);
  assert.strictEqual(result.isCapacity, true, 'genuine capacity error must keep isCapacity true');
});

// ============================================================
// Section 2: maybeSwitchToFallbackModel keeps the model on transient errors
// ============================================================
console.log('\n=== 2. Transient errors do NOT switch --model ===');

await testAsync('overload does NOT switch argv.model (stays opus)', async () => {
  const argv = { model: 'opus', fallbackModel: 'opus-4-7' };
  const log = makeLogSpy();
  const result = await maybeSwitchToFallbackModel({ tool: 'claude', argv, log, errorMessage: 'API Error: 529 Overloaded' });
  assert.strictEqual(result.switched, false, 'overload must not switch the model');
  assert.strictEqual(argv.model, 'opus', 'argv.model must remain the user-requested model');
});

await testAsync('overload logs a verbose "Keeping requested model" note with resolved ID', async () => {
  const argv = { model: 'opus', fallbackModel: 'opus-4-7' };
  const log = makeLogSpy();
  await maybeSwitchToFallbackModel({ tool: 'claude', argv, log, errorMessage: 'Overloaded' });
  const text = log.text();
  assert.ok(text.includes('Keeping requested model'), `expected a keep-model note, got:\n${text}`);
  // R2: the note shows the resolved full ID, not a bare "opus".
  assert.ok(text.includes(`opus (${resolveModelId('opus', 'claude')})`), `expected resolved id in keep note, got:\n${text}`);
});

await testAsync('rate-limit (429) does NOT switch argv.model', async () => {
  const argv = { model: 'opus', fallbackModel: 'opus-4-7' };
  const log = makeLogSpy();
  const result = await maybeSwitchToFallbackModel({
    tool: 'claude',
    argv,
    log,
    errorMessage: 'API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited',
  });
  assert.strictEqual(result.switched, false);
  assert.strictEqual(argv.model, 'opus');
});

await testAsync('socket-closed (timeout family) does NOT switch argv.model', async () => {
  const argv = { model: 'opus', fallbackModel: 'opus-4-7' };
  const log = makeLogSpy();
  const result = await maybeSwitchToFallbackModel({
    tool: 'claude',
    argv,
    log,
    errorMessage: 'API Error: The socket connection was closed unexpectedly.',
  });
  assert.strictEqual(result.switched, false);
  assert.strictEqual(argv.model, 'opus');
});

// ============================================================
// Section 3: Genuine capacity errors STILL switch, with resolved IDs in the warning
// ============================================================
console.log('\n=== 3. Genuine capacity errors still switch (with resolved IDs) ===');

await testAsync('"selected model is at capacity" switches opus -> fallback', async () => {
  const argv = { model: 'opus', fallbackModel: 'opus-4-7' };
  const log = makeLogSpy();
  const result = await maybeSwitchToFallbackModel({
    tool: 'claude',
    argv,
    log,
    errorMessage: 'The selected model is at capacity. Please try again.',
  });
  assert.strictEqual(result.switched, true, 'genuine capacity must switch the model');
  assert.strictEqual(argv.model, 'opus-4-7', 'argv.model must move to the configured fallback');
});

await testAsync('switch warning shows BOTH resolved model IDs (R2)', async () => {
  const argv = { model: 'opus', fallbackModel: 'opus-4-7' };
  const log = makeLogSpy();
  await maybeSwitchToFallbackModel({
    tool: 'claude',
    argv,
    log,
    errorMessage: 'The selected model is at capacity.',
  });
  const warning = log.calls.find(c => String(c.message).includes('Switching to fallback model'));
  assert.ok(warning, 'expected a switch warning to be logged');
  assert.ok(warning.message.includes(`opus (${resolveModelId('opus', 'claude')})`), `warning must show requested resolved id, got: ${warning.message}`);
  assert.ok(warning.message.includes(`opus-4-7 (${resolveModelId('opus-4-7', 'claude')})`), `warning must show fallback resolved id, got: ${warning.message}`);
  assert.strictEqual(warning.opts.level, 'warning', 'switch should be logged at warning level');
});

// ============================================================
// Section 4: formatModelWithResolvedId helper (R2)
// ============================================================
console.log('\n=== 4. formatModelWithResolvedId renders alias + resolved id ===');

test('alias "opus" renders with its resolved full id', () => {
  const out = formatModelWithResolvedId('opus', 'claude');
  assert.strictEqual(out, `opus (${resolveModelId('opus', 'claude')})`, `unexpected: ${out}`);
});

test('a model that equals its resolved id renders without duplication', () => {
  const full = resolveModelId('opus', 'claude'); // e.g. claude-opus-4-8
  const out = formatModelWithResolvedId(full, 'claude');
  assert.strictEqual(out, full, `fully-resolved id should not be wrapped, got: ${out}`);
});

// ============================================================
// Section 5: Multi-level fallback chain (Issue #2037 review)
// ============================================================
console.log('\n=== 5. Multi-level fallback chain walks closest-first ===');

await testAsync('repeated codex capacity errors walk gpt-5.6-sol -> terra -> luna -> gpt-5.5 -> gpt-5.4', async () => {
  // No explicit fallback pin: argv.fallbackModel starts unset, mirroring a run that
  // relies on the built-in default chain.
  const argv = { model: 'gpt-5.6-sol' };
  const log = makeLogSpy();
  const path = [argv.model];
  for (let i = 0; i < 6; i++) {
    const result = await maybeSwitchToFallbackModel({
      tool: 'codex',
      argv,
      log,
      errorMessage: 'Selected model is at capacity. Please try a different model.',
    });
    if (!result.switched) break;
    path.push(argv.model);
  }
  assert.deepStrictEqual(path, ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4']);
});

await testAsync('an explicit --fallback-model pin is honoured exactly and never walked past', async () => {
  // _fallbackModelExplicit = true => the user pinned gpt-5.5, so after switching to
  // it a second capacity error must NOT step further down the chain.
  const argv = { model: 'gpt-5.6-sol', fallbackModel: 'gpt-5.5', _fallbackModelExplicit: true };
  const log = makeLogSpy();
  const first = await maybeSwitchToFallbackModel({ tool: 'codex', argv, log, errorMessage: 'Selected model is at capacity. Please try a different model.' });
  assert.strictEqual(first.switched, true);
  assert.strictEqual(argv.model, 'gpt-5.5', 'first switch jumps straight to the pinned model');
  const second = await maybeSwitchToFallbackModel({ tool: 'codex', argv, log, errorMessage: 'Selected model is at capacity. Please try a different model.' });
  assert.strictEqual(second.switched, false, 'must not walk past an explicit pin');
  assert.strictEqual(argv.model, 'gpt-5.5');
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
console.log('\n✅ All overload / no-model-switch tests passed (Issue #1949)');
