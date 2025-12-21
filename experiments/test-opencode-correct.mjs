#!/usr/bin/env node

// Test script to verify opencode works with correct model name

import { execSync } from 'child_process';

console.log('Testing opencode with correct model name...');
console.log('');

// Test 1: Using opencode/grok-code model with message as argument
console.log('Test 1: Message as argument with opencode/grok-code');
try {
  const result = execSync('opencode run -m opencode/grok-code "What is 2+2? Just answer with the number."', {
    encoding: 'utf-8',
    timeout: 30000
  });
  console.log('✅ Test 1 passed');
  console.log('Response:', result);
} catch (error) {
  console.error('❌ Test 1 failed:', error.message);
  if (error.stderr) console.error('Stderr:', error.stderr.toString());
  if (error.stdout) console.error('Stdout:', error.stdout.toString());
}

console.log('');
console.log('Test 2: Using piped message');
try {
  const result = execSync(
    'echo "What is the capital of France? Answer in one word." | opencode run -m opencode/grok-code',
    {
      encoding: 'utf-8',
      timeout: 30000
    }
  );
  console.log('✅ Test 2 passed');
  console.log('Response:', result);
} catch (error) {
  console.error('❌ Test 2 failed:', error.message);
  if (error.stderr) console.error('Stderr:', error.stderr.toString());
  if (error.stdout) console.error('Stdout:', error.stdout.toString());
}
