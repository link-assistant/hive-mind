#!/usr/bin/env node

import { execSync } from 'child_process';

console.log('=== Testing git commands in non-git directory ===');
console.log('Current directory:', process.cwd());

// Test 1: git describe without error suppression
console.log('\n1. Running: git describe --exact-match --tags HEAD (no error suppression)');
try {
  const result = execSync('git describe --exact-match --tags HEAD', { encoding: 'utf8' });
  console.log('Success:', result);
} catch (error) {
  console.log('Error captured:');
  console.log('  stderr:', error.stderr);
  console.log('  stdout:', error.stdout);
  console.log('  message:', error.message);
}

// Test 2: git describe with 2>/dev/null
console.log('\n2. Running: git describe --exact-match --tags HEAD 2>/dev/null');
try {
  const result = execSync('git describe --exact-match --tags HEAD 2>/dev/null', { encoding: 'utf8' });
  console.log('Success:', result);
} catch (error) {
  console.log('Error captured:');
  if (error.stderr) console.log('  stderr:', error.stderr);
  if (error.stdout) console.log('  stdout:', error.stdout);
  console.log('  message shows:', error.message.split('\n').slice(0, 3).join('\n'));
}

// Test 3: git describe with stdio redirect
console.log("\n3. Running: git describe with stdio: ['pipe', 'pipe', 'ignore']");
try {
  const result = execSync('git describe --exact-match --tags HEAD', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  console.log('Success:', result);
} catch (error) {
  console.log('Error captured (stderr suppressed):');
  console.log('  Exit code:', error.status);
  // No stderr should be visible
}

// Test 4: Check if we're in a git repo first
console.log('\n4. Checking if in git repo first');
try {
  execSync('git rev-parse --git-dir', {
    encoding: 'utf8',
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  console.log('We are in a git repository');
} catch {
  console.log('Not in a git repository - skipping git commands');
}
