#!/usr/bin/env node

// Test script for --continue-only-on-feedback option
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

console.log('🧪 Testing --continue-only-on-feedback option validation...\n');

const tests = [
  {
    name: 'Valid: PR URL with --continue-only-on-feedback',
    command: './solve.mjs https://github.com/link-assistant/hive-mind/pull/153 --continue-only-on-feedback --dry-run',
    shouldSucceed: true
  },
  {
    name: 'Valid: Issue URL with --auto-continue and --continue-only-on-feedback',
    command:
      './solve.mjs https://github.com/link-assistant/hive-mind/issues/144 --auto-continue --continue-only-on-feedback --dry-run',
    shouldSucceed: true
  },
  {
    name: 'Invalid: Issue URL without --auto-continue but with --continue-only-on-feedback',
    command: './solve.mjs https://github.com/link-assistant/hive-mind/issues/144 --continue-only-on-feedback --dry-run',
    shouldSucceed: false
  },
  {
    name: 'Valid: Issue URL without any special options (baseline)',
    command: './solve.mjs https://github.com/link-assistant/hive-mind/issues/144 --dry-run',
    shouldSucceed: true
  }
];

let passedTests = 0;
let totalTests = tests.length;

for (const test of tests) {
  try {
    console.log(`Testing: ${test.name}`);
    const { stdout, stderr } = await execAsync(test.command, { timeout: 30000 });

    if (test.shouldSucceed) {
      console.log('✅ Test passed - command succeeded as expected');
      passedTests++;
    } else {
      console.log('❌ Test failed - command succeeded but should have failed');
      console.log('Stdout:', stdout);
      console.log('Stderr:', stderr);
    }
  } catch (error) {
    if (!test.shouldSucceed) {
      console.log('✅ Test passed - command failed as expected');
      console.log('Error message:', error.message.split('\n')[0]);
      passedTests++;
    } else {
      console.log('❌ Test failed - command failed but should have succeeded');
      console.log('Error:', error.message);
    }
  }
  console.log('');
}

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('🎉 All tests passed!');
  process.exit(0);
} else {
  console.log('❌ Some tests failed');
  process.exit(1);
}
