#!/usr/bin/env node

/**
 * Experiment to test 503 error detection and retry logic
 * This simulates the error patterns we expect to see from Anthropic API
 */

console.log('🧪 Testing 503 error detection logic...\n');

// Test patterns that should be detected as 503 errors
const testPatterns = [
  {
    name: 'Direct API Error 503',
    text: 'API Error: 503 upstream connect error or disconnect/reset before headers. reset reason: remote connection failure, transport failure reason: delayed connect error: Connection refused',
    shouldMatch: true,
  },
  {
    name: '503 with upstream connect error',
    text: 'Error: 503 upstream connect error or disconnect/reset before headers',
    shouldMatch: true,
  },
  {
    name: '503 with remote connection failure',
    text: 'Connection failed: 503 remote connection failure',
    shouldMatch: true,
  },
  {
    name: 'Normal 500 overload error (should not match 503 logic)',
    text: 'API Error: 500 Overloaded api_error',
    shouldMatch: false,
  },
  {
    name: 'Normal text with 503 in it (should not match)',
    text: 'HTTP status code 503 is a server error',
    shouldMatch: false,
  },
];

// Simulate the detection logic from claude.lib.mjs
function detect503Error(text) {
  return text.includes('API Error: 503') || (text.includes('503') && text.includes('upstream connect error')) || (text.includes('503') && text.includes('remote connection failure'));
}

// Test each pattern
let passed = 0;
let failed = 0;

for (const pattern of testPatterns) {
  const detected = detect503Error(pattern.text);
  const result = detected === pattern.shouldMatch;

  console.log(`Test: ${pattern.name}`);
  console.log(`  Expected: ${pattern.shouldMatch ? 'MATCH' : 'NO MATCH'}`);
  console.log(`  Got: ${detected ? 'MATCH' : 'NO MATCH'}`);
  console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'}`);
  console.log();

  if (result) {
    passed++;
  } else {
    failed++;
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}\n`);

// Test exponential backoff calculation
console.log('🧪 Testing exponential backoff calculation...\n');

const initial503RetryDelayMs = 5 * 60 * 1000; // 5 minutes
const retryBackoffMultiplier = 2;
const max503Retries = 3;

console.log('Retry delays:');
for (let retryCount = 0; retryCount < max503Retries; retryCount++) {
  const delay = initial503RetryDelayMs * Math.pow(retryBackoffMultiplier, retryCount);
  const delayMinutes = Math.round(delay / (1000 * 60));
  console.log(`  Retry ${retryCount + 1}: ${delayMinutes} minutes (${delay}ms)`);
}

console.log('\n✅ All tests completed!');

process.exit(failed > 0 ? 1 : 0);
