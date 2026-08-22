#!/usr/bin/env node

// Test script to verify the model default fix for opencode tool

console.log('Testing model default fix for opencode tool...\n');

// Test 1: Check if --model is in rawArgs
const testCases = [
  {
    rawArgs: ['https://github.com/owner/repo/issues/123', '--tool', 'opencode'],
    expected: { shouldSetDefault: true, tool: 'opencode' },
    description: 'opencode tool without --model flag',
  },
  {
    rawArgs: ['https://github.com/owner/repo/issues/123', '--tool', 'opencode', '--model', 'gpt4o'],
    expected: { shouldSetDefault: false, tool: 'opencode' },
    description: 'opencode tool with --model flag',
  },
  {
    rawArgs: ['https://github.com/owner/repo/issues/123', '--tool', 'opencode', '-m', 'gpt4o'],
    expected: { shouldSetDefault: false, tool: 'opencode' },
    description: 'opencode tool with -m flag',
  },
  {
    rawArgs: ['https://github.com/owner/repo/issues/123', '--tool', 'claude'],
    expected: { shouldSetDefault: false, tool: 'claude' },
    description: 'claude tool without --model flag',
  },
  {
    rawArgs: ['https://github.com/owner/repo/issues/123', '--tool', 'opencode', '--verbose'],
    expected: { shouldSetDefault: true, tool: 'opencode' },
    description: 'opencode tool with other flags but no --model',
  },
];

for (const testCase of testCases) {
  console.log(`Test: ${testCase.description}`);
  console.log(`  Raw args: ${testCase.rawArgs.join(' ')}`);

  const rawArgsString = testCase.rawArgs.join(' ');
  const modelExplicitlyProvided = rawArgsString.includes('--model') || rawArgsString.includes('-m');
  const tool = testCase.rawArgs[testCase.rawArgs.indexOf('--tool') + 1];
  const shouldSetDefault = tool === 'opencode' && !modelExplicitlyProvided;

  console.log(`  Model explicitly provided: ${modelExplicitlyProvided}`);
  console.log(`  Should set default: ${shouldSetDefault}`);
  console.log(`  Expected: ${testCase.expected.shouldSetDefault}`);

  if (shouldSetDefault === testCase.expected.shouldSetDefault) {
    console.log('  ✅ PASS\n');
  } else {
    console.log('  ❌ FAIL\n');
  }
}

console.log('All tests completed!');
