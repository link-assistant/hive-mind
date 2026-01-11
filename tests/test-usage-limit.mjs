#!/usr/bin/env node

/**
 * Test suite for usage-limit.lib.mjs
 * Tests usage limit detection and formatting functionality
 * Related issue: https://github.com/link-assistant/hive-mind/issues/942
 */

import { isUsageLimitError, extractResetTime, detectUsageLimit, formatUsageLimitMessage, parseUsageLimitJson } from '../src/usage-limit.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('\x1b[32m\u2713 PASSED\x1b[0m');
    testsPassed++;
  } catch (error) {
    console.log(`\x1b[31m\u2717 FAILED: ${error.message}\x1b[0m`);
    testsFailed++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected "${expected}", got "${actual}"`);
  }
}

function assertTrue(value, message) {
  if (!value) {
    throw new Error(`${message}: expected truthy value`);
  }
}

function assertFalse(value, message) {
  if (value) {
    throw new Error(`${message}: expected falsy value`);
  }
}

// === isUsageLimitError tests ===

runTest('isUsageLimitError: detects "limit reached"', () => {
  assertTrue(isUsageLimitError('Limit reached'), 'Should detect limit reached');
});

runTest('isUsageLimitError: detects Claude-style "resets" message', () => {
  assertTrue(isUsageLimitError('Limit reached · resets 8pm (Europe/Berlin) · turn on /extra-usage'), 'Should detect Claude resets message');
});

runTest('isUsageLimitError: detects usage limit exceeded', () => {
  assertTrue(isUsageLimitError('You have exceeded your rate limit'), 'Should detect rate limit exceeded');
});

runTest('isUsageLimitError: detects session limit reached', () => {
  assertTrue(isUsageLimitError('Session limit reached'), 'Should detect session limit');
});

runTest('isUsageLimitError: returns false for null/undefined', () => {
  assertFalse(isUsageLimitError(null), 'Should return false for null');
  assertFalse(isUsageLimitError(undefined), 'Should return false for undefined');
  assertFalse(isUsageLimitError(''), 'Should return false for empty string');
});

runTest('isUsageLimitError: returns false for normal messages', () => {
  assertFalse(isUsageLimitError('Build completed successfully'), 'Should not detect success message');
  assertFalse(isUsageLimitError('Error: file not found'), 'Should not detect file error');
});

// === extractResetTime tests ===

runTest('extractResetTime: extracts time from "resets 8pm" format', () => {
  const time = extractResetTime('Limit reached · resets 8pm (Europe/Berlin)');
  assertEqual(time, '8:00 PM', 'Should extract 8:00 PM');
});

runTest('extractResetTime: extracts time from "resets 5:00am" format', () => {
  const time = extractResetTime('Limit resets 5:00am');
  assertEqual(time, '5:00 AM', 'Should extract 5:00 AM');
});

runTest('extractResetTime: extracts time from "try again at" format', () => {
  const time = extractResetTime('Please try again at 12:16 PM');
  assertEqual(time, '12:16 PM', 'Should extract 12:16 PM');
});

runTest('extractResetTime: extracts time from 24-hour format', () => {
  const time = extractResetTime('Resets at 17:00');
  assertEqual(time, '5:00 PM', 'Should convert 17:00 to 5:00 PM');
});

runTest('extractResetTime: returns null for no time', () => {
  const time = extractResetTime('Rate limit exceeded');
  assertEqual(time, null, 'Should return null when no time found');
});

runTest('extractResetTime: returns null for invalid input', () => {
  assertEqual(extractResetTime(null), null, 'Should return null for null');
  assertEqual(extractResetTime(undefined), null, 'Should return null for undefined');
});

// === detectUsageLimit tests ===

runTest('detectUsageLimit: returns combined info', () => {
  const result = detectUsageLimit('Limit reached · resets 8pm (Europe/Berlin)');
  assertTrue(result.isUsageLimit, 'Should detect usage limit');
  assertEqual(result.resetTime, '8:00 PM', 'Should extract reset time');
});

runTest('detectUsageLimit: no reset time for non-limit message', () => {
  const result = detectUsageLimit('Build completed');
  assertFalse(result.isUsageLimit, 'Should not detect as limit');
  assertEqual(result.resetTime, null, 'Should not have reset time');
});

// === formatUsageLimitMessage tests (Issue #942 core fix) ===

runTest('formatUsageLimitMessage: includes session ID and resume command', () => {
  const lines = formatUsageLimitMessage({
    tool: 'Claude',
    resetTime: '8:00 PM',
    sessionId: '4c549ec6-3204-4312-b8e2-5f04113b2f86',
    resumeCommand: './solve.mjs "https://example.com" --resume 4c549ec6-3204-4312-b8e2-5f04113b2f86',
  });

  const message = lines.join('\n');
  assertTrue(message.includes('Usage Limit Reached'), 'Should include header');
  assertTrue(message.includes('Claude'), 'Should include tool name');
  assertTrue(message.includes('8:00 PM'), 'Should include reset time');
  assertTrue(message.includes('4c549ec6-3204-4312-b8e2-5f04113b2f86'), 'Should include session ID');
  assertTrue(message.includes('--resume'), 'Should include resume command');
});

runTest('formatUsageLimitMessage: handles missing reset time', () => {
  const lines = formatUsageLimitMessage({
    tool: 'Claude',
    resetTime: null,
    sessionId: 'test-session',
    resumeCommand: './solve.mjs --resume test-session',
  });

  const message = lines.join('\n');
  assertTrue(message.includes('wait for the limit to reset'), 'Should show wait message');
});

runTest('formatUsageLimitMessage: handles missing session ID', () => {
  const lines = formatUsageLimitMessage({
    tool: 'Claude',
    resetTime: '5:00 AM',
    sessionId: null,
    resumeCommand: null,
  });

  const message = lines.join('\n');
  assertFalse(message.includes('--resume'), 'Should not include resume command without session');
});

// === formatUsageLimitMessage tests for dual command format ===

runTest('formatUsageLimitMessage: includes both interactive and autonomous commands', () => {
  const lines = formatUsageLimitMessage({
    tool: 'Claude',
    resetTime: '8:00 PM',
    sessionId: 'abc123',
    interactiveResumeCommand: '(cd "/tmp/work" && claude --resume abc123)',
    autonomousResumeCommand: '(cd "/tmp/work" && claude --resume abc123 --output-format stream-json --dangerously-skip-permissions -p "Continue.")',
  });

  const message = lines.join('\n');
  assertTrue(message.includes('Interactive mode'), 'Should include Interactive mode label');
  assertTrue(message.includes('Autonomous mode'), 'Should include Autonomous mode label');
  assertTrue(message.includes('--dangerously-skip-permissions'), 'Should include autonomous command flags');
});

runTest('formatUsageLimitMessage: backwards compatible with legacy resumeCommand', () => {
  const lines = formatUsageLimitMessage({
    tool: 'Claude',
    resetTime: '8:00 PM',
    sessionId: 'abc123',
    resumeCommand: '(cd "/tmp/work" && claude --resume abc123)',
  });

  const message = lines.join('\n');
  assertTrue(message.includes('Interactive mode'), 'Should include Interactive mode label');
  assertTrue(message.includes('claude --resume'), 'Should include legacy resume command');
});

runTest('formatUsageLimitMessage: handles only interactive command', () => {
  const lines = formatUsageLimitMessage({
    tool: 'Claude',
    resetTime: '8:00 PM',
    sessionId: 'abc123',
    interactiveResumeCommand: '(cd "/tmp/work" && claude --resume abc123)',
    autonomousResumeCommand: null,
  });

  const message = lines.join('\n');
  assertTrue(message.includes('Interactive mode'), 'Should include Interactive mode label');
  assertFalse(message.includes('Autonomous mode'), 'Should NOT include Autonomous mode without command');
});

runTest('formatUsageLimitMessage: handles only autonomous command', () => {
  const lines = formatUsageLimitMessage({
    tool: 'Claude',
    resetTime: '8:00 PM',
    sessionId: 'abc123',
    interactiveResumeCommand: null,
    autonomousResumeCommand: '(cd "/tmp/work" && claude --resume abc123 --output-format stream-json --dangerously-skip-permissions -p "Continue.")',
  });

  const message = lines.join('\n');
  assertFalse(message.includes('Interactive mode'), 'Should NOT include Interactive mode without command');
  assertTrue(message.includes('Autonomous mode'), 'Should include Autonomous mode label');
});

// === parseUsageLimitJson tests ===

runTest('parseUsageLimitJson: parses error type JSON', () => {
  const json = JSON.stringify({
    type: 'error',
    message: 'Limit reached · resets 8pm',
  });
  const result = parseUsageLimitJson(json);
  assertEqual(result.type, 'error', 'Should parse error type');
  assertTrue(result.limitInfo.isUsageLimit, 'Should detect limit');
});

runTest('parseUsageLimitJson: parses turn.failed type JSON', () => {
  const json = JSON.stringify({
    type: 'turn.failed',
    error: {
      message: 'Usage limit exceeded',
    },
  });
  const result = parseUsageLimitJson(json);
  assertEqual(result.type, 'turn.failed', 'Should parse turn.failed type');
  assertTrue(result.limitInfo.isUsageLimit, 'Should detect limit');
});

runTest('parseUsageLimitJson: returns null for non-limit errors', () => {
  const json = JSON.stringify({
    type: 'error',
    message: 'File not found',
  });
  const result = parseUsageLimitJson(json);
  assertEqual(result, null, 'Should return null for non-limit error');
});

runTest('parseUsageLimitJson: returns null for invalid JSON', () => {
  const result = parseUsageLimitJson('not json');
  assertEqual(result, null, 'Should return null for invalid JSON');
});

// === Summary ===

console.log('\n' + '='.repeat(50));
console.log(`Test results: ${testsPassed} passed, ${testsFailed} failed`);
console.log('='.repeat(50));

if (testsFailed > 0) {
  process.exit(1);
}
