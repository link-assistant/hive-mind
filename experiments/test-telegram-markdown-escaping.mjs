#!/usr/bin/env node

/**
 * Test script to verify Markdown escaping for Telegram messages
 * This tests the fix for issue #580 where URLs with underscores caused parsing errors
 */

/**
 * Escape special characters for Telegram's legacy Markdown parser.
 * In Telegram's Markdown, these characters need escaping: _ * [ ] ( ) ~ ` > # + - = | { } . !
 * However, for plain text (not inside markup), we primarily need to escape _ and *
 * to prevent them from being interpreted as formatting.
 *
 * @param {string} text - Text to escape
 * @returns {string} Escaped text safe for Markdown parse_mode
 */
function escapeMarkdown(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }
  // Escape underscore and asterisk which are the most common issues in URLs
  // These can cause "Can't find end of entity" errors when Telegram tries to parse them
  return text.replace(/_/g, '\\_').replace(/\*/g, '\\*');
}

// Test cases
const testCases = [
  {
    name: 'URL with underscores (the bug from issue #580)',
    input: 'https://github.com/andchir/llm_game/issues/1',
    expected: 'https://github.com/andchir/llm\\_game/issues/1',
  },
  {
    name: 'URL with multiple underscores',
    input: 'https://github.com/test_repo/test_project/issues/123',
    expected: 'https://github.com/test\\_repo/test\\_project/issues/123',
  },
  {
    name: 'URL with asterisks',
    input: 'https://example.com/**/path/**',
    expected: 'https://example.com/\\*\\*/path/\\*\\*',
  },
  {
    name: 'URL with both underscores and asterisks',
    input: 'https://example.com/test_path/**/file_name.txt',
    expected: 'https://example.com/test\\_path/\\*\\*/file\\_name.txt',
  },
  {
    name: 'Plain URL without special characters',
    input: 'https://github.com/owner/repo/issues/1',
    expected: 'https://github.com/owner/repo/issues/1',
  },
  {
    name: 'Empty string',
    input: '',
    expected: '',
  },
  {
    name: 'Null value',
    input: null,
    expected: null,
  },
  {
    name: 'Undefined value',
    input: undefined,
    expected: undefined,
  },
];

console.log('🧪 Testing Markdown escaping function...\n');

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const result = escapeMarkdown(testCase.input);
  const success = result === testCase.expected;

  if (success) {
    console.log(`✅ PASS: ${testCase.name}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${testCase.name}`);
    console.log(`   Input:    ${JSON.stringify(testCase.input)}`);
    console.log(`   Expected: ${JSON.stringify(testCase.expected)}`);
    console.log(`   Got:      ${JSON.stringify(result)}`);
    failed++;
  }
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

// Test the actual message construction that was failing
console.log('\n🔍 Testing actual message construction from the bug report:\n');

const testUsername = 'drakonard';
const testUrl = 'https://github.com/andchir/llm_game/issues/1';
const testOptions = '--auto-fork --auto-continue --attach-logs --verbose --no-tool-check';
const solveOverrides = ['--auto-fork', '--auto-continue', '--attach-logs', '--verbose', '--no-tool-check'];

const escapedUrl = escapeMarkdown(testUrl);
const userMention = `[@${testUsername}](https://t.me/${testUsername})`;

let statusMsg = `🚀 Starting solve command...\nRequested by: ${userMention}\nURL: ${escapedUrl}\nOptions: ${testOptions}`;
if (solveOverrides.length > 0) {
  statusMsg += `\n🔒 Locked options: ${solveOverrides.join(' ')}`;
}

console.log('Generated message:');
console.log('─'.repeat(80));
console.log(statusMsg);
console.log('─'.repeat(80));

console.log('\n✅ Message construction successful!');
console.log('   The URL has been properly escaped:', escapedUrl);
console.log('   This should prevent the "Can\'t find end of entity" error.');

if (failed === 0) {
  console.log('\n🎉 All tests passed!');
  process.exit(0);
} else {
  console.log(`\n❌ ${failed} test(s) failed!`);
  process.exit(1);
}
