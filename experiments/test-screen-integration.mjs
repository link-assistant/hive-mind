#!/usr/bin/env node
// Integration test for start-screen command

import { execSync } from 'child_process';
import { parseGitHubUrl } from '../src/github.lib.mjs';

console.log('Testing start-screen integration...\n');

// Test 1: Check if screen is installed
console.log('1. Checking if GNU screen is installed...');
try {
  const screenVersion = execSync('screen --version', { encoding: 'utf8' });
  console.log(`   ✓ Screen is installed: ${screenVersion.trim()}`);
} catch (error) {
  console.log('   ✗ Screen is NOT installed. Please install it:');
  console.log('     Ubuntu/Debian: sudo apt-get install screen');
  console.log('     macOS: brew install screen');
  process.exit(1);
}

// Test 2: Verify command parses URLs correctly
console.log('\n2. Testing URL parsing and screen name generation...');
const testUrls = [
  {
    url: 'https://github.com/veb86/zcadvelecAI/issues/2',
    expectedOwner: 'veb86',
    expectedRepo: 'zcadvelecAI',
    expectedNumber: 2,
    expectedType: 'issue',
  },
  {
    url: 'https://github.com/link-assistant/hive-mind',
    expectedOwner: 'link-assistant',
    expectedRepo: 'hive-mind',
    expectedNumber: null,
    expectedType: 'repo',
  },
];

let allPassed = true;
for (const test of testUrls) {
  const parsed = parseGitHubUrl(test.url);
  const passed = parsed.owner === test.expectedOwner && parsed.repo === test.expectedRepo && (test.expectedNumber === null ? !parsed.hasOwnProperty('number') : parsed.number === test.expectedNumber) && parsed.type === test.expectedType;

  console.log(`   ${test.url}`);
  console.log(`     Owner: ${parsed.owner} (expected: ${test.expectedOwner})`);
  console.log(`     Repo: ${parsed.repo} (expected: ${test.expectedRepo})`);
  console.log(`     Type: ${parsed.type} (expected: ${test.expectedType})`);
  if (test.expectedNumber) {
    console.log(`     Issue: ${parsed.number} (expected: ${test.expectedNumber})`);
  }
  console.log(`     Result: ${passed ? '✓ PASSED' : '✗ FAILED'}`);
  allPassed = allPassed && passed;
}

// Test 3: Test command execution (without actually running in screen due to TTY requirement)
console.log('\n3. Testing command argument parsing...');
const commandTests = [
  {
    args: ['solve', 'https://github.com/test/repo/issues/1', '--dry-run'],
    expectedCommand: 'solve',
    expectedUrl: 'https://github.com/test/repo/issues/1',
    expectedOptions: ['--dry-run'],
  },
  {
    args: ['hive', 'https://github.com/test/repo', '--dry-run', '--verbose'],
    expectedCommand: 'hive',
    expectedUrl: 'https://github.com/test/repo',
    expectedOptions: ['--dry-run', '--verbose'],
  },
];

for (const test of commandTests) {
  console.log(`   Testing: ${test.args.join(' ')}`);

  // Simulate argument parsing
  const command = test.args[0];
  let githubUrl = null;
  const options = [];

  for (let i = 1; i < test.args.length; i++) {
    const arg = test.args[i];
    if (arg.includes('github.com') || (!githubUrl && !arg.startsWith('--'))) {
      githubUrl = arg;
    } else {
      options.push(arg);
    }
  }

  const passed = command === test.expectedCommand && githubUrl === test.expectedUrl && JSON.stringify(options) === JSON.stringify(test.expectedOptions);

  console.log(`     Command: ${command} (expected: ${test.expectedCommand})`);
  console.log(`     URL: ${githubUrl} (expected: ${test.expectedUrl})`);
  console.log(`     Options: ${JSON.stringify(options)} (expected: ${JSON.stringify(test.expectedOptions)})`);
  console.log(`     Result: ${passed ? '✓ PASSED' : '✗ FAILED'}`);
  allPassed = allPassed && passed;
}

// Summary
console.log('\n' + '='.repeat(50));
if (allPassed) {
  console.log('All integration tests PASSED! ✓');
  process.exit(0);
} else {
  console.log('Some integration tests FAILED! ✗');
  process.exit(1);
}
