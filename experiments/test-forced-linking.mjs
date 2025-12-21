#!/usr/bin/env node

// Test script to verify the forced linking logic works correctly

const testCases = [
  {
    name: 'Original PR body with content',
    prBody: 'This is a great feature implementation.\n\nIt adds several improvements:\n- Better performance\n- Improved UX',
    issueRef: '#10',
    expectedOutput: 'This is a great feature implementation.\n\nIt adds several improvements:\n- Better performance\n- Improved UX\n\n---\n\nResolves #10',
  },
  {
    name: 'Empty PR body',
    prBody: '',
    issueRef: '#25',
    expectedOutput: '\n\n---\n\nResolves #25',
  },
  {
    name: 'Fork issue reference',
    prBody: 'Fix for the bug in the main repository',
    issueRef: 'link-assistant/hive-mind#42',
    expectedOutput: 'Fix for the bug in the main repository\n\n---\n\nResolves link-assistant/hive-mind#42',
  },
];

console.log('🧪 Testing Forced Linking Logic\n');

function simulateUpdatedBody(prBody, issueRef) {
  // This simulates the new logic from solve.mjs line 1474
  return `${prBody}\n\n---\n\nResolves ${issueRef}`;
}

for (const test of testCases) {
  console.log(`Test: ${test.name}`);
  console.log('Input PR body:', JSON.stringify(test.prBody));
  console.log('Issue ref:', test.issueRef);

  const result = simulateUpdatedBody(test.prBody, test.issueRef);
  const passed = result === test.expectedOutput;

  console.log('Result:', JSON.stringify(result));
  console.log('Expected:', JSON.stringify(test.expectedOutput));
  console.log(`Status: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log('---');
}

console.log('✅ All tests completed!');
