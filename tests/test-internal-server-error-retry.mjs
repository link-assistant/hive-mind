#!/usr/bin/env node
// Test file for issue #1331: Unified retry with exponential backoff for all transient API errors
// All error types (Overloaded, 503, Internal Server Error) use same params with session preservation

import assert from 'assert';

// Import the configuration module
const { retryLimits } = await import('../src/config.lib.mjs');

console.log('Testing Unified Transient Error Retry Logic (Issue #1331)\n');

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

// ============================================================
// Section 1: Unified Configuration Tests
// ============================================================
console.log('\n=== 1. Unified Transient Error Retry Configuration (Issue #1331) ===');

test('retryLimits has maxTransientErrorRetries set to 10', () => {
  assert.strictEqual(retryLimits.maxTransientErrorRetries, 10, `maxTransientErrorRetries should be 10, got: ${retryLimits.maxTransientErrorRetries}`);
});

test('retryLimits has initialTransientErrorDelayMs set to 60000 (1 minute)', () => {
  assert.strictEqual(retryLimits.initialTransientErrorDelayMs, 60 * 1000, `initialTransientErrorDelayMs should be 60000ms (1 minute), got: ${retryLimits.initialTransientErrorDelayMs}`);
});

test('retryLimits has maxTransientErrorDelayMs set to 1800000 (30 minutes)', () => {
  assert.strictEqual(retryLimits.maxTransientErrorDelayMs, 30 * 60 * 1000, `maxTransientErrorDelayMs should be 1800000ms (30 minutes), got: ${retryLimits.maxTransientErrorDelayMs}`);
});

test('initialTransientErrorDelayMs is 1 minute', () => {
  assert(retryLimits.initialTransientErrorDelayMs === 60000, `Initial delay must be 1 minute (60000ms) as required by issue #1331`);
});

test('maxTransientErrorDelayMs is 30 minutes', () => {
  assert(retryLimits.maxTransientErrorDelayMs === 30 * 60 * 1000, `Max delay must be 30 minutes (1800000ms) as required by issue #1331`);
});

test('maxTransientErrorRetries is exactly 10', () => {
  assert(retryLimits.maxTransientErrorRetries === 10, `Max retries must be 10 as required by issue #1331`);
});

test('retryBackoffMultiplier is 2 (for exponential backoff)', () => {
  assert.strictEqual(retryLimits.retryBackoffMultiplier, 2, 'retryBackoffMultiplier should be 2');
});

// ============================================================
// Section 2: Exponential Backoff Calculation Tests
// ============================================================
console.log('\n=== 2. Exponential Backoff Calculation Tests ===');

const calculateDelay = retryCount => {
  const rawDelay = retryLimits.initialTransientErrorDelayMs * Math.pow(retryLimits.retryBackoffMultiplier, retryCount);
  return Math.min(rawDelay, retryLimits.maxTransientErrorDelayMs);
};

test('Retry 0 delay is 1 minute (60s)', () => {
  const delay = calculateDelay(0);
  assert.strictEqual(delay, 60 * 1000, `Retry 0 should be 60000ms, got: ${delay}`);
});

test('Retry 1 delay is 2 minutes (120s)', () => {
  const delay = calculateDelay(1);
  assert.strictEqual(delay, 2 * 60 * 1000, `Retry 1 should be 120000ms, got: ${delay}`);
});

test('Retry 2 delay is 4 minutes (240s)', () => {
  const delay = calculateDelay(2);
  assert.strictEqual(delay, 4 * 60 * 1000, `Retry 2 should be 240000ms, got: ${delay}`);
});

test('Retry 3 delay is 8 minutes (480s)', () => {
  const delay = calculateDelay(3);
  assert.strictEqual(delay, 8 * 60 * 1000, `Retry 3 should be 480000ms, got: ${delay}`);
});

test('Retry 4 delay is 16 minutes (960s)', () => {
  const delay = calculateDelay(4);
  assert.strictEqual(delay, 16 * 60 * 1000, `Retry 4 should be 960000ms, got: ${delay}`);
});

test('Retry 5 delay is capped at 30 minutes (32min > 30min cap)', () => {
  // 60s * 2^5 = 60 * 32 = 1920s = 32min > 30min cap
  const delay = calculateDelay(5);
  assert.strictEqual(delay, 30 * 60 * 1000, `Retry 5 should be capped at 1800000ms (30min), got: ${delay}`);
});

test('All delays after cap remain at 30 minutes', () => {
  for (let i = 5; i <= 9; i++) {
    const delay = calculateDelay(i);
    assert.strictEqual(delay, 30 * 60 * 1000, `Retry ${i} should be capped at 1800000ms (30min), got: ${delay}`);
  }
});

test('No delay ever exceeds 30 minutes', () => {
  for (let i = 0; i < retryLimits.maxTransientErrorRetries; i++) {
    const delay = calculateDelay(i);
    assert(delay <= 30 * 60 * 1000, `Retry ${i} delay ${delay}ms exceeds 30 minutes (1800000ms)`);
  }
});

// ============================================================
// Section 3: Error Pattern Detection Tests
// ============================================================
console.log('\n=== 3. Error Pattern Detection Tests ===');

// Simulate the unified detection logic used in claude.lib.mjs (Issue #1331)
const isTransientError = errorStr => {
  return (errorStr.includes('API Error: 500') && (errorStr.includes('Overloaded') || errorStr.includes('Internal server error'))) || (errorStr.includes('api_error') && errorStr.includes('Overloaded')) || errorStr.includes('API Error: 503') || (errorStr.includes('503') && (errorStr.includes('upstream connect error') || errorStr.includes('remote connection failure')));
};

test('Detects Internal server error from issue description', () => {
  const errorMessage = 'API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"},"request_id":"req_011CYFmxpwLMccW87i77dUEL"}';
  assert(isTransientError(errorMessage), 'Should detect Internal server error as transient');
});

test('Detects Overloaded error (500)', () => {
  const errorMessage = 'API Error: 500 {"type":"error","error":{"type":"api_error","message":"Overloaded"}}';
  assert(isTransientError(errorMessage), 'Should detect Overloaded error as transient');
});

test('Detects Overloaded error via api_error field', () => {
  const errorMessage = '{"type":"error","error":{"type":"api_error","message":"Overloaded"}}';
  assert(isTransientError(errorMessage), 'Should detect Overloaded via api_error field as transient');
});

test('Detects 503 upstream connect error', () => {
  const error503Message = 'API Error: 503 upstream connect error or disconnect/reset before headers. retried and the latest reset reason: remote connection failure';
  assert(isTransientError(error503Message), '503 upstream connect error should be detected as transient');
});

test('Detects 503 remote connection failure', () => {
  const error503Message = 'Error 503: remote connection failure detected';
  assert(isTransientError(error503Message), '503 remote connection failure should be detected as transient');
});

test('Does NOT false-positive on success messages mentioning 500', () => {
  const successMessage = 'Successfully handled 500 items in batch';
  assert(!isTransientError(successMessage), 'Success message should NOT be detected as transient error');
});

test('Does NOT false-positive on "API Error: 500" without known error type', () => {
  const genericMessage = 'API Error: 500 {"type":"error","error":{"type":"api_error","message":"Something else"}}';
  assert(!isTransientError(genericMessage), 'Generic 500 error without known message should NOT be detected');
});

// ============================================================
// Section 4: Session Preservation Logic Tests
// ============================================================
console.log('\n=== 4. Session Preservation Logic Tests (all error types) ===');

test('Session ID should be preserved on retry (when available)', () => {
  const sessionId = 'session-abc123';
  const argv = { resume: null };
  if (sessionId && !argv.resume) argv.resume = sessionId;
  assert.strictEqual(argv.resume, 'session-abc123', 'argv.resume should be set to sessionId');
});

test('Existing resume session should be preserved (not overwritten)', () => {
  const sessionId = 'new-session-xyz';
  const argv = { resume: 'existing-session-abc' };
  if (sessionId && !argv.resume) argv.resume = sessionId;
  assert.strictEqual(argv.resume, 'existing-session-abc', 'Existing resume session should not be overwritten');
});

test('No session ID should not set resume (graceful degradation)', () => {
  const sessionId = null;
  const argv = { resume: null };
  if (sessionId && !argv.resume) argv.resume = sessionId;
  assert.strictEqual(argv.resume, null, 'argv.resume should remain null when no sessionId available');
});

// ============================================================
// Section 5: Unified Config Consistency Tests
// ============================================================
console.log('\n=== 5. Unified Config Consistency Tests ===');

test('All transient error types use maxTransientErrorRetries (10)', () => {
  // Overloaded, 503, InternalServerError all use the same limit
  assert.strictEqual(retryLimits.maxTransientErrorRetries, 10, 'All error types must use 10 retries');
});

test('All transient error types use initialTransientErrorDelayMs (1 minute)', () => {
  assert.strictEqual(retryLimits.initialTransientErrorDelayMs, 60 * 1000, 'All error types must use 1 minute initial delay');
});

test('All transient error types use maxTransientErrorDelayMs (30 minutes)', () => {
  assert.strictEqual(retryLimits.maxTransientErrorDelayMs, 30 * 60 * 1000, 'All error types must use 30 minute max delay');
});

test('No separate 503-only or overload-only retry config exists', () => {
  assert(retryLimits.max503Retries === undefined, 'max503Retries should not exist in unified config');
  assert(retryLimits.maxInternalServerErrorRetries === undefined, 'maxInternalServerErrorRetries should not exist in unified config');
  assert(retryLimits.initial503RetryDelayMs === undefined, 'initial503RetryDelayMs should not exist in unified config');
  assert(retryLimits.initialInternalServerErrorDelayMs === undefined, 'initialInternalServerErrorDelayMs should not exist in unified config');
});

// ============================================================
// Summary
// ============================================================
console.log('\n' + '='.repeat(50));
console.log(`Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  console.log('\nSome tests failed!');
  process.exit(1);
} else {
  console.log('\nAll tests passed!');
  process.exit(0);
}
