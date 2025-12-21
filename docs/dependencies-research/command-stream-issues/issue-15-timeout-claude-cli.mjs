#!/usr/bin/env node

/**
 * Issue #15: Claude CLI timeout problem
 *
 * The Claude CLI command `timeout 30 claude -p hi` fails with exit code 124 (timeout)
 * but `claude -p hi` works fine. This suggests the command takes longer than 30 seconds
 * to complete, possibly due to initialization overhead or waiting for input.
 *
 * Reproduction:
 * - `timeout 30 claude -p hi` -> Exit code 124
 * - `claude -p hi` -> Works but may take a while
 *
 * Expected fix: Either increase timeout or use a different validation approach
 * that doesn't rely on timeout or uses exec with proper timeout handling.
 */

import { $ } from 'bun';

console.log('=== Issue #15: Claude CLI Timeout Problem ===\n');

console.log('🔍 Testing timeout behavior...\n');

// Test 1: Short timeout (current approach)
console.log('Test 1: timeout 30 claude -p hi');
try {
  const result = await $`timeout 30 claude -p hi`;
  console.log('✅ Success! Exit code:', result.code);
  console.log('Output:', result.stdout?.toString().trim() || 'No output');
} catch (error) {
  console.log('❌ Failed with exit code:', error.code);
  console.log('Stderr:', error.stderr?.toString().trim() || 'No error output');
}

console.log('\n---\n');

// Test 2: Longer timeout
console.log('Test 2: timeout 60 claude -p hi');
try {
  const result = await $`timeout 60 claude -p hi`;
  console.log('✅ Success! Exit code:', result.code);
  console.log('Output:', result.stdout?.toString().trim() || 'No output');
} catch (error) {
  console.log('❌ Failed with exit code:', error.code);
  console.log('Stderr:', error.stderr?.toString().trim() || 'No error output');
}

console.log('\n---\n');

// Test 3: Alternative validation approach - check if claude command exists
console.log('Test 3: which claude (alternative validation)');
try {
  const result = await $`which claude`;
  console.log('✅ Claude CLI found at:', result.stdout?.toString().trim());
} catch (error) {
  console.log('❌ Claude CLI not found');
}

console.log('\n---\n');

// Test 4: Version check (might be faster)
console.log('Test 4: claude --version');
try {
  const result = await $`timeout 10 claude --version`;
  console.log('✅ Version check success! Exit code:', result.code);
  console.log('Output:', result.stdout?.toString().trim() || 'No output');
} catch (error) {
  console.log('❌ Version check failed with exit code:', error.code);
  console.log('Stderr:', error.stderr?.toString().trim() || 'No error output');
}

console.log('\n---\n');

// Test 5: Help check (might be faster)
console.log('Test 5: claude --help');
try {
  const result = await $`timeout 10 claude --help`;
  console.log('✅ Help check success! Exit code:', result.code);
  console.log('Output length:', result.stdout?.toString().length || 0);
} catch (error) {
  console.log('❌ Help check failed with exit code:', error.code);
  console.log('Stderr:', error.stderr?.toString().trim() || 'No error output');
}

console.log('\n=== Recommended Solution ===');
console.log('1. Use longer timeout (60-120 seconds) for the current validation');
console.log('2. OR use "which claude" + "claude --version" for faster validation');
console.log('3. OR use Node.js exec with better timeout control');
