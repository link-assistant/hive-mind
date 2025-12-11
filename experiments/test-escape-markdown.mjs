#!/usr/bin/env node

/**
 * Test script for escapeMarkdownV2 function
 */

/**
 * Escape special characters for Telegram's MarkdownV2 parser.
 * Preserves inline code blocks (text between backticks) without escaping.
 * @param {string} text - Text to escape
 * @returns {string} Escaped text safe for MarkdownV2 parse_mode
 */
function escapeMarkdownV2(text) {
  if (!text || typeof text !== 'string') return text;

  // Split text into parts: inline code blocks and regular text
  const parts = [];
  let lastIndex = 0;
  const codeBlockRegex = /`[^`]+`/g;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Add escaped regular text before code block
    if (match.index > lastIndex) {
      const regularText = text.substring(lastIndex, match.index);
      parts.push(regularText.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1'));
    }
    // Add unescaped code block
    parts.push(match[0]);
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last code block
  if (lastIndex < text.length) {
    const regularText = text.substring(lastIndex);
    parts.push(regularText.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1'));
  }

  return parts.join('');
}

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
