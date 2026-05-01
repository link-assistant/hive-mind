#!/usr/bin/env node
// Test file for issue #1353: Auto-restart with --resume on "Request timed out" in --tool claude
// Verifies that timeout errors trigger exponential backoff retry with session preservation

import assert from 'assert';

// Import the configuration module
const { retryLimits } = await import('../src/config.lib.mjs');

console.log('Testing Request Timeout Retry Logic (Issue #1353)\n');

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
// Section 1: Timeout Retry Configuration Tests
// ============================================================
console.log('\n=== 1. Request Timeout Retry Configuration (Issue #1353) ===');

test('retryLimits has maxRequestTimeoutRetries set to 10', () => {
  assert.strictEqual(retryLimits.maxRequestTimeoutRetries, 10, `maxRequestTimeoutRetries should be 10, got: ${retryLimits.maxRequestTimeoutRetries}`);
});

test('retryLimits has initialRequestTimeoutDelayMs set to 300000 (5 minutes)', () => {
  assert.strictEqual(retryLimits.initialRequestTimeoutDelayMs, 5 * 60 * 1000, `initialRequestTimeoutDelayMs should be 300000ms (5 minutes), got: ${retryLimits.initialRequestTimeoutDelayMs}`);
});

test('retryLimits has maxRequestTimeoutDelayMs set to 3600000 (1 hour)', () => {
  assert.strictEqual(retryLimits.maxRequestTimeoutDelayMs, 60 * 60 * 1000, `maxRequestTimeoutDelayMs should be 3600000ms (1 hour), got: ${retryLimits.maxRequestTimeoutDelayMs}`);
});

test('Timeout initial delay (5 min) is longer than transient error initial delay (1 min)', () => {
  assert(retryLimits.initialRequestTimeoutDelayMs > retryLimits.initialTransientErrorDelayMs, `Timeout initial delay (${retryLimits.initialRequestTimeoutDelayMs}ms) must be longer than transient error delay (${retryLimits.initialTransientErrorDelayMs}ms) since Claude CLI already exhausted its own retries`);
});

test('Timeout max delay (1 hr) is longer than transient error max delay (30 min)', () => {
  assert(retryLimits.maxRequestTimeoutDelayMs > retryLimits.maxTransientErrorDelayMs, `Timeout max delay (${retryLimits.maxRequestTimeoutDelayMs}ms) must be longer than transient error max delay (${retryLimits.maxTransientErrorDelayMs}ms)`);
});

// ============================================================
// Section 2: Timeout Exponential Backoff Calculation Tests
// ============================================================
console.log('\n=== 2. Timeout Exponential Backoff Calculation Tests ===');

const calculateTimeoutDelay = retryCount => {
  const rawDelay = retryLimits.initialRequestTimeoutDelayMs * Math.pow(retryLimits.retryBackoffMultiplier, retryCount);
  return Math.min(rawDelay, retryLimits.maxRequestTimeoutDelayMs);
};

test('Retry 0 delay is 5 minutes (300s)', () => {
  const delay = calculateTimeoutDelay(0);
  assert.strictEqual(delay, 5 * 60 * 1000, `Retry 0 should be 300000ms (5min), got: ${delay}`);
});

test('Retry 1 delay is 10 minutes (600s)', () => {
  const delay = calculateTimeoutDelay(1);
  assert.strictEqual(delay, 10 * 60 * 1000, `Retry 1 should be 600000ms (10min), got: ${delay}`);
});

test('Retry 2 delay is 20 minutes (1200s)', () => {
  const delay = calculateTimeoutDelay(2);
  assert.strictEqual(delay, 20 * 60 * 1000, `Retry 2 should be 1200000ms (20min), got: ${delay}`);
});

test('Retry 3 delay is capped at 1 hour (5*2^3=40min < 60min, so NOT capped yet)', () => {
  const delay = calculateTimeoutDelay(3);
  assert.strictEqual(delay, 40 * 60 * 1000, `Retry 3 should be 2400000ms (40min), got: ${delay}`);
});

test('Retry 4 delay is capped at 1 hour (5*2^4=80min > 60min cap)', () => {
  // 5min * 2^4 = 5 * 16 = 80min > 60min cap
  const delay = calculateTimeoutDelay(4);
  assert.strictEqual(delay, 60 * 60 * 1000, `Retry 4 should be capped at 3600000ms (1hr), got: ${delay}`);
});

test('All delays after cap remain at 1 hour', () => {
  for (let i = 4; i < retryLimits.maxRequestTimeoutRetries; i++) {
    const delay = calculateTimeoutDelay(i);
    assert.strictEqual(delay, 60 * 60 * 1000, `Retry ${i} should be capped at 3600000ms (1hr), got: ${delay}`);
  }
});

test('No delay ever exceeds 1 hour', () => {
  for (let i = 0; i < retryLimits.maxRequestTimeoutRetries; i++) {
    const delay = calculateTimeoutDelay(i);
    assert(delay <= 60 * 60 * 1000, `Retry ${i} delay ${delay}ms exceeds 1 hour (3600000ms)`);
  }
});

// ============================================================
// Section 3: Timeout Error Pattern Detection Tests
// ============================================================
console.log('\n=== 3. Timeout Error Pattern Detection Tests ===');

// Simulate the detection logic used in claude.lib.mjs (Issue #1353)
const isRequestTimeout = (lastMessage, isRequestTimeoutFlag) => {
  return isRequestTimeoutFlag || lastMessage === 'Request timed out' || lastMessage.includes('Request timed out');
};

test('Detects exact "Request timed out" string (from result event)', () => {
  assert(isRequestTimeout('Request timed out', false), 'Should detect exact "Request timed out" as timeout');
});

test('Detects "Request timed out" in longer message', () => {
  assert(isRequestTimeout('Error: Request timed out after 600s', false), 'Should detect "Request timed out" in longer message');
});

test('Detects timeout when isRequestTimeout flag is set', () => {
  // This simulates detection that happened earlier in the loop
  assert(isRequestTimeout('', true), 'Should detect timeout when isRequestTimeout flag is true');
});

test('Does NOT false-positive on unrelated messages', () => {
  assert(!isRequestTimeout('Task completed successfully', false), 'Should not detect timeout in success message');
});

test('Does NOT false-positive on API Error: 500 without timeout text', () => {
  assert(!isRequestTimeout('API Error: 500 Internal server error', false), 'API 500 without "Request timed out" should not be timeout');
});

test('Does NOT false-positive on generic timeout messages', () => {
  // Other timeout patterns that are NOT from Claude CLI's synthetic response
  assert(!isRequestTimeout('operation timed out', false), 'Generic timeout message without exact pattern should be safe from false positive');
});

// ============================================================
// Section 4: Claude CLI Synthetic Result Format Tests
// ============================================================
console.log('\n=== 4. Claude CLI Synthetic Result Format Tests ===');

// Simulate parsing the result event from the log
const parseResultEvent = jsonStr => {
  const data = JSON.parse(jsonStr);
  const isTimeout = data.type === 'result' && data.is_error === true && (data.result === 'Request timed out' || (data.result && data.result.includes('Request timed out')));
  const hasSessionId = !!data.session_id;
  return { isTimeout, hasSessionId, sessionId: data.session_id, result: data.result };
};

// Exact format from the actual log file in this issue
const syntheticResultEvent = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: true,
  duration_ms: 415332,
  duration_api_ms: 47224,
  num_turns: 15,
  result: 'Request timed out',
  stop_reason: 'stop_sequence',
  session_id: '3af31f9f-00b4-4cc1-ba4f-a8896eb1ab16',
  total_cost_usd: 0.381,
  usage: {},
  permission_denials: [],
  uuid: '05f17007-3e27-435f-a45c-9ec4da429970',
});

test('Correctly identifies timeout from Claude CLI synthetic result event', () => {
  const parsed = parseResultEvent(syntheticResultEvent);
  assert(parsed.isTimeout, 'Should identify as timeout from is_error=true + result="Request timed out"');
});

test('Extracts session ID from synthetic result event for resume', () => {
  const parsed = parseResultEvent(syntheticResultEvent);
  assert(parsed.hasSessionId, 'Should have session_id for resume capability');
  assert.strictEqual(parsed.sessionId, '3af31f9f-00b4-4cc1-ba4f-a8896eb1ab16', 'Session ID should match');
});

test('Subtype "success" with is_error=true is a valid timeout pattern', () => {
  // This is counterintuitive: subtype=success with is_error=true is the exact pattern
  // Claude CLI emits when the request times out (synthetic response)
  const parsed = parseResultEvent(syntheticResultEvent);
  assert.strictEqual(parsed.result, 'Request timed out', 'Result should be "Request timed out"');
});

// ============================================================
// Section 5: Session Preservation Logic Tests
// ============================================================
console.log('\n=== 5. Session Preservation Logic Tests for Timeout ===');

test('Session ID should be preserved on timeout retry (when available)', () => {
  const sessionId = '3af31f9f-00b4-4cc1-ba4f-a8896eb1ab16';
  const argv = { resume: null };
  if (sessionId && !argv.resume) argv.resume = sessionId;
  assert.strictEqual(argv.resume, '3af31f9f-00b4-4cc1-ba4f-a8896eb1ab16', 'argv.resume should be set to sessionId for resume');
});

test('Existing resume session should not be overwritten on timeout retry', () => {
  const sessionId = 'new-timeout-session';
  const argv = { resume: 'existing-session-abc' };
  if (sessionId && !argv.resume) argv.resume = sessionId;
  assert.strictEqual(argv.resume, 'existing-session-abc', 'Existing resume session should not be overwritten');
});

test('No session ID on timeout should not set resume (graceful degradation)', () => {
  const sessionId = null; // Timeout happened before session ID was captured
  const argv = { resume: null };
  if (sessionId && !argv.resume) argv.resume = sessionId;
  assert.strictEqual(argv.resume, null, 'argv.resume should remain null when no sessionId available');
});

// ============================================================
// Section 6: Comparison Between Timeout and Transient Error Configs
// ============================================================
console.log('\n=== 6. Timeout vs Transient Error Config Comparison ===');

test('Timeout initial delay is 5x longer than transient error initial delay', () => {
  const ratio = retryLimits.initialRequestTimeoutDelayMs / retryLimits.initialTransientErrorDelayMs;
  assert.strictEqual(ratio, 5, `Timeout initial delay should be 5x transient error delay, got: ${ratio}x`);
});

test('Timeout max delay is 2x longer than transient error max delay', () => {
  const ratio = retryLimits.maxRequestTimeoutDelayMs / retryLimits.maxTransientErrorDelayMs;
  assert.strictEqual(ratio, 2, `Timeout max delay should be 2x transient error max delay, got: ${ratio}x`);
});

test('Both timeout and transient error use same max retry count (10)', () => {
  assert.strictEqual(retryLimits.maxRequestTimeoutRetries, retryLimits.maxTransientErrorRetries, 'Both should use 10 retries');
});

test('Both use same exponential backoff multiplier (2)', () => {
  assert.strictEqual(retryLimits.retryBackoffMultiplier, 2, 'Backoff multiplier should be 2 for both');
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
