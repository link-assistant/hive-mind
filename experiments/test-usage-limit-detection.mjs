#!/usr/bin/env node
/**
 * Test script for usage limit detection
 * Tests the detectUsageLimit function with various error message patterns
 */

import { detectUsageLimit, formatUsageLimitMessage } from '../src/usage-limit.lib.mjs';

console.log('🧪 Testing Usage Limit Detection\n');

const testCases = [
  {
    name: 'Usage limit with reset time (from issue #719)',
    message: '{"type":"error","message":"You\'ve hit your usage limit. To get more access now, send a request to your admin or try again at 12:16 PM."}',
    expectedLimit: true,
    expectedTime: '12:16 PM'
  },
  {
    name: 'Turn failed with usage limit',
    message: '{"type":"turn.failed","error":{"message":"You\'ve hit your usage limit. Try again at 2:30 PM."}}',
    expectedLimit: true,
    expectedTime: '2:30 PM'
  },
  {
    name: 'Rate limit exceeded',
    message: 'Error: rate_limit_exceeded',
    expectedLimit: true,
    expectedTime: null
  },
  {
    name: 'You have exceeded your rate limit',
    message: 'You have exceeded your rate limit. Please try again later.',
    expectedLimit: true,
    expectedTime: null
  },
  {
    name: 'Hit your usage limit (short form)',
    message: 'Error: hit your usage limit',
    expectedLimit: true,
    expectedTime: null
  },
  {
    name: 'Regular error (should not match)',
    message: 'Error: Connection timeout',
    expectedLimit: false,
    expectedTime: null
  },
  {
    name: 'Context length exceeded (should not match)',
    message: 'Error: context_length_exceeded',
    expectedLimit: false,
    expectedTime: null
  }
];

let passedTests = 0;
let failedTests = 0;

for (const testCase of testCases) {
  console.log(`\n📝 Test: ${testCase.name}`);
  console.log(`   Message: ${testCase.message.substring(0, 80)}${testCase.message.length > 80 ? '...' : ''}`);

  const result = detectUsageLimit(testCase.message);

  const limitMatches = result.isUsageLimit === testCase.expectedLimit;
  const timeMatches = result.resetTime === testCase.expectedTime;

  if (limitMatches && timeMatches) {
    console.log(`   ✅ PASS`);
    console.log(`      - Detected limit: ${result.isUsageLimit}`);
    if (result.resetTime) {
      console.log(`      - Reset time: ${result.resetTime}`);
    }
    passedTests++;
  } else {
    console.log(`   ❌ FAIL`);
    console.log(`      - Expected limit: ${testCase.expectedLimit}, Got: ${result.isUsageLimit}`);
    console.log(`      - Expected time: ${testCase.expectedTime}, Got: ${result.resetTime}`);
    failedTests++;
  }
}

console.log(`\n\n📊 Test Summary:`);
console.log(`   ✅ Passed: ${passedTests}/${testCases.length}`);
console.log(`   ❌ Failed: ${failedTests}/${testCases.length}`);

if (failedTests === 0) {
  console.log(`\n🎉 All tests passed!`);
} else {
  console.log(`\n⚠️  Some tests failed!`);
  process.exit(1);
}

// Test message formatting
console.log(`\n\n🧪 Testing Usage Limit Message Formatting\n`);
console.log('Example output:');
console.log('─'.repeat(60));

const messageLines = formatUsageLimitMessage({
  tool: 'Claude',
  resetTime: '12:16 PM',
  sessionId: '019a77e4-0716-7152-8396-b642e26c3e20',
  resumeCommand: 'node solve.mjs --auto-continue https://github.com/example/repo/issues/1'
});

for (const line of messageLines) {
  console.log(line);
}

console.log('─'.repeat(60));
console.log('\n✅ Message formatting test complete\n');
