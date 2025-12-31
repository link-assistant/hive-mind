#!/usr/bin/env node

// Test script to verify opencode works with grok-code-fast-1 model

import { execSync } from 'child_process';

console.log('Testing opencode with grok-code-fast-1 model...');
console.log('');

// Test 1: Simple echo command
console.log('Test 1: Simple message test');
try {
  const result = execSync('echo "What is 2+2?" | opencode run -m opencode/grok-code', {
    encoding: 'utf-8',
    timeout: 30000,
  });
  console.log('✅ Test 1 passed');
  console.log('Response:', result.substring(0, 200));
} catch (error) {
  console.error('❌ Test 1 failed:', error.message);
  console.error('Stderr:', error.stderr?.toString());
  console.error('Stdout:', error.stdout?.toString());
}

console.log('');
console.log('Test 2: Message as argument');
try {
  const result = execSync('opencode run -m opencode/grok-code "What is the capital of France?"', {
    encoding: 'utf-8',
    timeout: 30000,
  });
  console.log('✅ Test 2 passed');
  console.log('Response:', result.substring(0, 200));
} catch (error) {
  console.error('❌ Test 2 failed:', error.message);
  console.error('Stderr:', error.stderr?.toString());
  console.error('Stdout:', error.stdout?.toString());
}
