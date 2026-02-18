#!/usr/bin/env node
// Test file for issue #1331: Auto-resume on Internal Server Error with session preservation
// Tests the retry configuration and detection logic for 500 Internal server error

import assert from 'assert';

// Import the configuration module
const { retryLimits } = await import('../src/config.lib.mjs');

console.log('Testing Internal Server Error Retry Logic (Issue #1331)\n');

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
// Section 1: Configuration Tests
// ============================================================
console.log('\n=== 1. Internal Server Error Retry Configuration (Issue #1331) ===');

test('retryLimits has maxInternalServerErrorRetries set to 10', () => {
  assert.strictEqual(retryLimits.maxInternalServerErrorRetries, 10, `maxInternalServerErrorRetries should be 10, got: ${retryLimits.maxInternalServerErrorRetries}`);
});

test('retryLimits has initialInternalServerErrorDelayMs set to 60000 (1 minute)', () => {
  assert.strictEqual(retryLimits.initialInternalServerErrorDelayMs, 60 * 1000, `initialInternalServerErrorDelayMs should be 60000ms (1 minute), got: ${retryLimits.initialInternalServerErrorDelayMs}`);
});

test('retryLimits has maxInternalServerErrorDelayMs set to 1800000 (30 minutes)', () => {
  assert.strictEqual(retryLimits.maxInternalServerErrorDelayMs, 30 * 60 * 1000, `maxInternalServerErrorDelayMs should be 1800000ms (30 minutes), got: ${retryLimits.maxInternalServerErrorDelayMs}`);
});

test('retryLimits initialInternalServerErrorDelayMs is 1 minute', () => {
  assert(retryLimits.initialInternalServerErrorDelayMs === 60000, `Initial delay must be 1 minute (60000ms) as required by issue #1331`);
});

test('retryLimits maxInternalServerErrorDelayMs is 30 minutes', () => {
  assert(retryLimits.maxInternalServerErrorDelayMs === 30 * 60 * 1000, `Max delay must be 30 minutes (1800000ms) as required by issue #1331`);
});

test('retryLimits maxInternalServerErrorRetries is at most 10', () => {
  assert(retryLimits.maxInternalServerErrorRetries <= 10, `Max retries must not exceed 10 as required by issue #1331`);
});

// ============================================================
// Section 2: Exponential Backoff Calculation Tests
// ============================================================
console.log('\n=== 2. Exponential Backoff Calculation Tests ===');

const calculateDelay = retryCount => {
  const rawDelay = retryLimits.initialInternalServerErrorDelayMs * Math.pow(retryLimits.retryBackoffMultiplier, retryCount);
  return Math.min(rawDelay, retryLimits.maxInternalServerErrorDelayMs);
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
  for (let i = 0; i < retryLimits.maxInternalServerErrorRetries; i++) {
    const delay = calculateDelay(i);
    assert(delay <= 30 * 60 * 1000, `Retry ${i} delay ${delay}ms exceeds 30 minutes (1800000ms)`);
  }
});

// ============================================================
// Section 3: Error Pattern Detection Tests
// ============================================================
console.log('\n=== 3. Error Pattern Detection Tests ===');

// These simulate the detection logic used in claude.lib.mjs (Issue #1331)
const isInternalServerErrorMessage = message => {
  return message.includes('API Error: 500') && message.includes('Internal server error') && !message.includes('Overloaded');
};

const isOverloadedErrorMessage = message => {
  return (message.includes('API Error: 500') && message.includes('Overloaded')) || (message.includes('api_error') && message.includes('Overloaded'));
};

test('Detects Internal server error from issue description', () => {
  const errorMessage = 'API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"},"request_id":"req_011CYFmxpwLMccW87i77dUEL"}';
  assert(isInternalServerErrorMessage(errorMessage), 'Should detect Internal server error');
  assert(!isOverloadedErrorMessage(errorMessage), 'Should NOT classify as overload error');
});

test('Detects Internal server error from error event', () => {
  const errorMessage = '{"type":"error","error":{"type":"api_error","message":"Internal server error"}}';
  const fullMessage = `API Error: 500 ${errorMessage}`;
  assert(isInternalServerErrorMessage(fullMessage), 'Should detect Internal server error in error event');
});

test('Does NOT detect Overloaded error as Internal server error', () => {
  const overloadedMessage = 'API Error: 500 {"type":"error","error":{"type":"api_error","message":"Overloaded"}}';
  assert(!isInternalServerErrorMessage(overloadedMessage), 'Overloaded error should NOT be detected as Internal server error');
  assert(isOverloadedErrorMessage(overloadedMessage), 'Overloaded error should be detected as overload error');
});

test('Does NOT detect 503 error as Internal server error', () => {
  const error503Message = 'API Error: 503 upstream connect error or disconnect/reset before headers. retried and the latest reset reason: remote connection failure';
  assert(!isInternalServerErrorMessage(error503Message), '503 error should NOT be detected as Internal server error');
});

test('Does NOT false-positive on success messages mentioning 500', () => {
  const successMessage = 'Successfully handled 500 items in batch';
  assert(!isInternalServerErrorMessage(successMessage), 'Success message should NOT be detected as Internal server error');
});

test('Does NOT false-positive on "API Error: 500" without "Internal server error"', () => {
  // Some other 500 error without specific message
  const genericMessage = 'API Error: 500 {"type":"error","error":{"type":"api_error","message":"Something else"}}';
  assert(!isInternalServerErrorMessage(genericMessage), 'Generic 500 error without "Internal server error" text should NOT be detected');
});

// ============================================================
// Section 4: Session Preservation Logic Tests
// ============================================================
console.log('\n=== 4. Session Preservation Logic Tests ===');

test('Session ID should be preserved on retry (when available)', () => {
  // Simulate the session preservation logic
  const sessionId = 'session-abc123';
  const argv = { resume: null };

  // When Internal server error occurs and we have a session ID
  if (sessionId && !argv.resume) {
    argv.resume = sessionId;
  }

  assert.strictEqual(argv.resume, 'session-abc123', 'argv.resume should be set to sessionId');
});

test('Existing resume session should be preserved (not overwritten)', () => {
  // When already resuming and Internal server error occurs
  const sessionId = 'new-session-xyz';
  const argv = { resume: 'existing-session-abc' };

  // When Internal server error occurs and we're already resuming
  if (sessionId && !argv.resume) {
    argv.resume = sessionId; // This should NOT run since argv.resume is already set
  }

  assert.strictEqual(argv.resume, 'existing-session-abc', 'Existing resume session should not be overwritten');
});

test('No session ID should not set resume (graceful degradation)', () => {
  // When Internal server error occurs but no session ID was captured
  const sessionId = null;
  const argv = { resume: null };

  if (sessionId && !argv.resume) {
    argv.resume = sessionId;
  }

  assert.strictEqual(argv.resume, null, 'argv.resume should remain null when no sessionId available');
});

// ============================================================
// Section 5: Regression Tests for Existing Error Types
// ============================================================
console.log('\n=== 5. Regression Tests for Existing Error Types ===');

test('Existing 503 error config is unchanged', () => {
  assert.strictEqual(retryLimits.max503Retries, 3, '503 max retries should still be 3');
  assert.strictEqual(retryLimits.initial503RetryDelayMs, 5 * 60 * 1000, '503 initial delay should still be 5 minutes');
});

test('Existing retryBackoffMultiplier is unchanged', () => {
  assert.strictEqual(retryLimits.retryBackoffMultiplier, 2, 'retryBackoffMultiplier should still be 2');
});

test('maxInternalServerErrorRetries is greater than max503Retries', () => {
  assert(retryLimits.maxInternalServerErrorRetries > retryLimits.max503Retries, `Internal server error retries (${retryLimits.maxInternalServerErrorRetries}) should be more than 503 retries (${retryLimits.max503Retries})`);
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
