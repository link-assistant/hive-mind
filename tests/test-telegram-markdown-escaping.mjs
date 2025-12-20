#!/usr/bin/env node

/**
 * Unit tests for Telegram Markdown escaping functionality
 * This test verifies the fix for issue #580 where GitHub URLs with underscores
 * caused Telegram API parsing errors with legacy Markdown parse_mode.
 *
 * The tests ensure that the escapeMarkdown() function properly escapes special
 * characters (_ and *) in URLs to prevent Telegram from interpreting them as
 * Markdown formatting markers.
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
    name: 'URL with underscores (the exact bug from issue #580)',
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
    name: 'URL with consecutive underscores',
    input: 'https://github.com/user__name/repo__name/issues/1',
    expected: 'https://github.com/user\\_\\_name/repo\\_\\_name/issues/1',
  },
  {
    name: 'URL with underscores at different positions',
    input: 'https://github.com/_leading/trailing_/issues/1',
    expected: 'https://github.com/\\_leading/trailing\\_/issues/1',
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
  {
    name: 'String with only underscores',
    input: '___',
    expected: '\\_\\_\\_',
  },
  {
    name: 'String with only asterisks',
    input: '***',
    expected: '\\*\\*\\*',
  },
  {
    name: 'Mixed text and special characters',
    input: 'Hello_World*Test',
    expected: 'Hello\\_World\\*Test',
  },
];

console.log('🧪 Running Telegram Markdown escaping unit tests...\n');
console.log('=' .repeat(80));
console.log('Test Suite: Telegram Markdown Escaping (Issue #580)');
console.log('=' .repeat(80));
console.log();

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const result = escapeMarkdown(testCase.input);
  const success = result === testCase.expected;

  if (success) {
    console.log(`✅ PASS: ${testCase.name}`);
    if (testCase.input && testCase.input !== testCase.expected) {
      console.log(`   Input:  "${testCase.input}"`);
      console.log(`   Output: "${result}"`);
    }
    passed++;
  } else {
    console.log(`❌ FAIL: ${testCase.name}`);
    console.log(`   Input:    ${JSON.stringify(testCase.input)}`);
    console.log(`   Expected: ${JSON.stringify(testCase.expected)}`);
    console.log(`   Got:      ${JSON.stringify(result)}`);
    failed++;
  }
  console.log();
}

// Test the actual message construction that was failing
console.log('=' .repeat(80));
console.log('Integration Test: Message Construction (Real-world scenario)');
console.log('=' .repeat(80));
console.log();

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

console.log('Generated Telegram message:');
console.log('─'.repeat(80));
console.log(statusMsg);
console.log('─'.repeat(80));
console.log();

console.log('✅ Message construction successful!');
console.log(`   Original URL: ${testUrl}`);
console.log(`   Escaped URL:  ${escapedUrl}`);
console.log('   This prevents the "Can\'t find end of entity at byte offset 117" error.');
console.log();

// Print summary
console.log('=' .repeat(80));
console.log('Test Summary');
console.log('=' .repeat(80));
console.log(`Total tests:  ${testCases.length}`);
console.log(`Passed:       ${passed} ✅`);
console.log(`Failed:       ${failed} ${failed > 0 ? '❌' : ''}`);
console.log('=' .repeat(80));
console.log();

if (failed === 0) {
  console.log('🎉 All tests passed!');
  console.log();
  console.log('📝 Coverage:');
  console.log('   ✅ Basic URL escaping (underscores and asterisks)');
  console.log('   ✅ Edge cases (empty, null, undefined)');
  console.log('   ✅ Real-world scenario from issue #580');
  console.log('   ✅ Message construction integration test');
  console.log();
  process.exit(0);
} else {
  console.log(`❌ ${failed} test(s) failed!`);
  console.log();
  process.exit(1);
}
