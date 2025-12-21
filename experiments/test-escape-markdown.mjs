#!/usr/bin/env node

/**
 * Test script for escapeMarkdownV2 function
 */

import { escapeMarkdownV2 } from '../src/telegram-markdown.lib.mjs';

// Test cases with default behavior (preserveCodeBlocks: false - full escape)
const testCasesDefault = [
  {
    input: 'Some text with special characters: . - !',
    expected: 'Some text with special characters: \\. \\- \\!'
  },
  {
    input: 'Text with `code` in the middle',
    expected: 'Text with \\`code\\` in the middle'
  },
  {
    input: 'Multiple `code1` and `code2` blocks',
    expected: 'Multiple \\`code1\\` and \\`code2\\` blocks'
  },
  {
    input: 'Backslash \\ test',
    expected: 'Backslash \\\\ test'
  }
];

// Test cases with preserveCodeBlocks: true (preserving inline code)
const testCasesWithPreserve = [
  {
    input:
      'No access token found in Claude credentials. Please use `/solve` or `/hive` commands to trigger re-authentication of Claude.',
    expected:
      'No access token found in Claude credentials\\. Please use `/solve` or `/hive` commands to trigger re\\-authentication of Claude\\.'
  },
  {
    input:
      'Claude authentication expired. Please use `/solve` or `/hive` commands to trigger re-authentication of Claude.',
    expected:
      'Claude authentication expired\\. Please use `/solve` or `/hive` commands to trigger re\\-authentication of Claude\\.'
  },
  {
    input: 'Text with `code` in the middle',
    expected: 'Text with `code` in the middle'
  },
  {
    input: 'Multiple `code1` and `code2` blocks',
    expected: 'Multiple `code1` and `code2` blocks'
  }
];

console.log('Testing escapeMarkdownV2 function:\n');
console.log('=== Tests with default behavior (preserveCodeBlocks: false - full escape) ===\n');

let allPassed = true;
testCasesDefault.forEach((testCase, index) => {
  const result = escapeMarkdownV2(testCase.input);
  const passed = result === testCase.expected;
  allPassed = allPassed && passed;

  console.log(`Test ${index + 1}: ${passed ? '✓ PASSED' : '✗ FAILED'}`);
  console.log(`Input:    ${testCase.input}`);
  console.log(`Expected: ${testCase.expected}`);
  console.log(`Got:      ${result}`);
  if (!passed) {
    console.log(`Diff: Expected and Got are different`);
  }
  console.log('');
});

console.log('=== Tests with preserveCodeBlocks: true (preserving inline code) ===\n');

testCasesWithPreserve.forEach((testCase, index) => {
  const result = escapeMarkdownV2(testCase.input, { preserveCodeBlocks: true });
  const passed = result === testCase.expected;
  allPassed = allPassed && passed;

  console.log(`Test ${index + testCasesDefault.length + 1}: ${passed ? '✓ PASSED' : '✗ FAILED'}`);
  console.log(`Input:    ${testCase.input}`);
  console.log(`Expected: ${testCase.expected}`);
  console.log(`Got:      ${result}`);
  if (!passed) {
    console.log(`Diff: Expected and Got are different`);
  }
  console.log('');
});

console.log(allPassed ? '✓ All tests passed!' : '✗ Some tests failed!');
process.exit(allPassed ? 0 : 1);
