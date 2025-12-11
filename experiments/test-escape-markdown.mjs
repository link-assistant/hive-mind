#!/usr/bin/env node

/**
 * Test script for escapeMarkdownV2 function
 */

import { escapeMarkdownV2 } from '../src/telegram-markdown.lib.mjs';

// Test cases
const testCases = [
  {
    input: 'No access token found in Claude credentials. Please use `/solve` or `/hive` commands to trigger re-authentication of Claude.',
    expected: 'No access token found in Claude credentials\\. Please use `/solve` or `/hive` commands to trigger re\\-authentication of Claude\\.'
  },
  {
    input: 'Claude authentication expired. Please use `/solve` or `/hive` commands to trigger re-authentication of Claude.',
    expected: 'Claude authentication expired\\. Please use `/solve` or `/hive` commands to trigger re\\-authentication of Claude\\.'
  },
  {
    input: 'Some text with special characters: . - !',
    expected: 'Some text with special characters: \\. \\- \\!'
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

let allPassed = true;
testCases.forEach((testCase, index) => {
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

console.log(allPassed ? '✓ All tests passed!' : '✗ Some tests failed!');
process.exit(allPassed ? 0 : 1);
