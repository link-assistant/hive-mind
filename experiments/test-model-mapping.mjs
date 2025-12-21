#!/usr/bin/env node

// Test script to verify the opencode model mapping (standalone)

const mapModelToId = model => {
  const modelMap = {
    gpt4: 'openai/gpt-4',
    gpt4o: 'openai/gpt-4o',
    claude: 'anthropic/claude-3-5-sonnet',
    sonnet: 'anthropic/claude-3-5-sonnet',
    opus: 'anthropic/claude-3-opus',
    gemini: 'google/gemini-pro',
    grok: 'opencode/grok-code',
    'grok-code': 'opencode/grok-code',
    'grok-code-fast-1': 'opencode/grok-code'
  };

  return modelMap[model] || model;
};

console.log('Testing opencode model mapping fixes...\n');

// Test model mappings
const testCases = [
  { input: 'grok', expected: 'opencode/grok-code' },
  { input: 'grok-code', expected: 'opencode/grok-code' },
  { input: 'grok-code-fast-1', expected: 'opencode/grok-code' },
  { input: 'sonnet', expected: 'anthropic/claude-3-5-sonnet' },
  { input: 'opus', expected: 'anthropic/claude-3-opus' },
  { input: 'gpt4o', expected: 'openai/gpt-4o' }
];

console.log('Model mapping tests:');
let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const result = mapModelToId(testCase.input);
  if (result === testCase.expected) {
    console.log(`✅ ${testCase.input} -> ${result}`);
    passed++;
  } else {
    console.log(`❌ ${testCase.input} -> ${result} (expected: ${testCase.expected})`);
    failed++;
  }
}

console.log(`\nTest Results: ${passed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('\n✅ All model mapping tests passed!');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
}
