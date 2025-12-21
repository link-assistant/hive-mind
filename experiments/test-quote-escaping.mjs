#!/usr/bin/env node

/**
 * Test script to verify quote escaping in PR titles
 * Tests various edge cases that could cause shell parsing issues
 */

import fs from 'fs/promises';
import { execSync } from 'child_process';

const testCases = [
  {
    name: 'Simple apostrophe',
    title:
      "[WIP] We should fail on private repository with --auto-fork only if we don't have direct permissions to the repository"
  },
  {
    name: 'Multiple apostrophes',
    title: "[WIP] It's important that we don't break user's workflows"
  },
  {
    name: 'Double quotes',
    title: '[WIP] Add "smart" quote handling for titles'
  },
  {
    name: 'Mixed quotes',
    title: `[WIP] Fix issue with "don't" and other quotes`
  },
  {
    name: 'Backticks',
    title: '[WIP] Add support for `code` in titles'
  },
  {
    name: 'Special characters',
    title: '[WIP] Handle $variables and ${expressions} in titles'
  },
  {
    name: 'Newlines and special chars',
    title: '[WIP] Test & verify <special> characters'
  }
];

console.log('Testing quote escaping for PR titles...\n');

let passedTests = 0;
let failedTests = 0;

for (const testCase of testCases) {
  try {
    console.log(`Testing: ${testCase.name}`);
    console.log(`  Title: ${testCase.title}`);

    // Write title to temp file (mimicking the actual implementation)
    const prTitleFile = `/tmp/pr-title-test-${Date.now()}.txt`;
    await fs.writeFile(prTitleFile, testCase.title);

    // Test the command substitution approach
    const command = `echo "$(cat '${prTitleFile}')"`;
    const output = execSync(command, { encoding: 'utf8' });

    // Clean up
    await fs.unlink(prTitleFile).catch(() => {});

    // Verify the output matches the input
    const trimmedOutput = output.trim();
    if (trimmedOutput === testCase.title) {
      console.log(`  ✅ PASSED: Output matches input`);
      passedTests++;
    } else {
      console.log(`  ❌ FAILED: Output doesn't match`);
      console.log(`     Expected: ${testCase.title}`);
      console.log(`     Got: ${trimmedOutput}`);
      failedTests++;
    }
  } catch (error) {
    console.log(`  ❌ FAILED with error: ${error.message}`);
    failedTests++;
  }
  console.log('');
}

console.log('\n' + '='.repeat(60));
console.log(`Test Results: ${passedTests} passed, ${failedTests} failed`);
console.log('='.repeat(60));

if (failedTests === 0) {
  console.log('\n✅ All tests passed! Quote escaping is working correctly.');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed. Quote escaping needs improvement.');
  process.exit(1);
}
