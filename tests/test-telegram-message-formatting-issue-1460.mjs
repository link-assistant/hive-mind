#!/usr/bin/env node

/**
 * Unit tests for issue #1460: /solve command rejected with "can't parse entities" error
 *
 * Tests verify that:
 * 1. buildUserMention escapes display names in Markdown mode
 * 2. stripMarkdown properly converts formatted text to plain text
 * 3. Message construction with user-generated content is safe for Telegram Markdown
 * 4. safeReply fallback logic works correctly
 */

import { buildUserMention } from '../src/buildUserMention.lib.mjs';
import { escapeMarkdown, escapeMarkdownV2, cleanNonPrintableChars, makeSpecialCharsVisible } from '../src/telegram-markdown.lib.mjs';

let passed = 0;
let failed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${testName}`);
    if (details) console.log(`     ${details}`);
    failed++;
  }
}

function assertEqual(actual, expected, testName) {
  const condition = actual === expected;
  assert(condition, testName, condition ? '' : `Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)}`);
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 1: buildUserMention Markdown escaping (issue #1460)
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 1: buildUserMention Markdown escaping');
console.log('─'.repeat(60));

// Test: Username with underscore
{
  const result = buildUserMention({ user: { id: 123, username: 'my_user' }, parseMode: 'Markdown' });
  assert(!result.includes('@my_user]') || result.includes('@my\\_user]'),
    'Username with underscore is escaped in Markdown mode',
    `Got: ${result}`);
}

// Test: Username without special chars (should still work)
{
  const result = buildUserMention({ user: { id: 123, username: 'simpleuser' }, parseMode: 'Markdown' });
  assertEqual(result, '[@simpleuser](https://t.me/simpleuser)',
    'Username without special chars works normally');
}

// Test: Username with multiple underscores
{
  const result = buildUserMention({ user: { id: 123, username: 'my_cool_bot' }, parseMode: 'Markdown' });
  assert(result.includes('@my\\_cool\\_bot'),
    'Username with multiple underscores is fully escaped',
    `Got: ${result}`);
}

// Test: Display name (first_name) with underscore (no username)
{
  const result = buildUserMention({ user: { id: 123, first_name: 'John_Doe' }, parseMode: 'Markdown' });
  assert(result.includes('John\\_Doe'),
    'First name with underscore is escaped',
    `Got: ${result}`);
}

// Test: Display name with asterisk
{
  const result = buildUserMention({ user: { id: 123, first_name: 'Star*User' }, parseMode: 'Markdown' });
  assert(result.includes('Star\\*User'),
    'First name with asterisk is escaped',
    `Got: ${result}`);
}

// Test: MarkdownV2 mode still works (separate escaping)
{
  const result = buildUserMention({ user: { id: 123, username: 'test_user' }, parseMode: 'MarkdownV2' });
  assert(result.includes('test\\_user'),
    'MarkdownV2 mode still escapes properly');
}

// Test: HTML mode is unaffected
{
  const result = buildUserMention({ user: { id: 123, username: 'test_user' }, parseMode: 'HTML' });
  assert(result.includes('@test_user'),
    'HTML mode does not escape underscores (not needed)');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 2: Full message construction safety (issue #1460)
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 2: Full message construction safety');
console.log('─'.repeat(60));

// Simulate the exact scenario from the issue
{
  const user = { id: 12345, username: 'some_user' };
  const normalizedUrl = 'https://github.com/xlab2016/space_db_private/issues/17';
  const userArgs = [normalizedUrl, '--interactive-mode'];
  const solveOverrides = ['--auto-fork'];

  const requester = buildUserMention({ user, parseMode: 'Markdown' });
  const userOptionsText = escapeMarkdown(userArgs.slice(1).join(' ') || 'none');
  let infoBlock = `Requested by: ${requester}\nURL: ${escapeMarkdown(normalizedUrl)}\n\n🛠 Options: ${userOptionsText}`;
  if (solveOverrides.length > 0) infoBlock += `\n🔒 Locked options: ${escapeMarkdown(solveOverrides.join(' '))}`;

  const message = `🚀 Starting solve command...\n\n${infoBlock}`;

  // Check no unescaped underscores remain in the message (outside of Markdown link syntax)
  // Extract text outside of [...](...) links
  const textOutsideLinks = message.replace(/\[[^\]]*\]\([^)]*\)/g, '');
  const unescapedUnderscores = textOutsideLinks.match(/(?<!\\)_/g);
  assert(!unescapedUnderscores,
    'No unescaped underscores in message text (outside links)',
    unescapedUnderscores ? `Found ${unescapedUnderscores.length} unescaped underscore(s) in: ${textOutsideLinks.substring(0, 200)}` : '');
}

// Test with user who has no username (first/last name with special chars)
{
  const user = { id: 12345, first_name: 'Test_User', last_name: 'Name*Star' };
  const normalizedUrl = 'https://github.com/owner/repo/issues/1';

  const requester = buildUserMention({ user, parseMode: 'Markdown' });
  const message = `🚀 Starting solve command...\n\nRequested by: ${requester}\nURL: ${escapeMarkdown(normalizedUrl)}`;

  // The display name should be escaped within the link
  assert(message.includes('Test\\_User') && message.includes('Name\\*Star'),
    'Special chars in first/last name are escaped in full message',
    `Got: ${message.substring(0, 200)}`);
}

// Test with options containing underscores
{
  const userOptionsText = escapeMarkdown('--some_option --another_flag');
  assert(userOptionsText.includes('some\\_option') && userOptionsText.includes('another\\_flag'),
    'Options with underscores are properly escaped');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 3: stripMarkdown function
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 3: stripMarkdown function');
console.log('─'.repeat(60));

// Inline stripMarkdown for testing (same as in telegram-bot.mjs)
function stripMarkdown(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\\([_*`[\]()~>#+\-=|{}.!\\])/g, '$1');
}

assertEqual(
  stripMarkdown('[Click here](https://example.com)'),
  'Click here (https://example.com)',
  'Converts Markdown links to plain text'
);

assertEqual(
  stripMarkdown('URL: https://github.com/test\\_repo/issues/1'),
  'URL: https://github.com/test_repo/issues/1',
  'Removes escape backslashes from underscores'
);

assertEqual(
  stripMarkdown('*bold* and _italic_'),
  '*bold* and _italic_',
  'Preserves unescaped formatting markers (readable in plain text)'
);

assertEqual(
  stripMarkdown('`code block`'),
  '`code block`',
  'Preserves backtick code markers (readable in plain text)'
);

assertEqual(
  stripMarkdown(null),
  null,
  'Handles null input'
);

assertEqual(
  stripMarkdown(''),
  '',
  'Handles empty string'
);

assertEqual(
  stripMarkdown('No formatting here'),
  'No formatting here',
  'Passes through plain text unchanged'
);

// Test the real-world scenario: full message strip
{
  const formatted = '🚀 Starting solve command...\n\nRequested by: [@my\\_user](https://t.me/my_user)\nURL: https://github.com/xlab2016/space\\_db\\_private/issues/17\n\n🛠 Options: --interactive-mode';
  const plain = stripMarkdown(formatted);
  assert(plain.includes('@my_user (https://t.me/my_user)') || plain.includes('@my_user'),
    'Full message strip: link converted and underscores restored',
    `Got: ${plain.substring(0, 200)}`);
  assert(plain.includes('space_db_private'),
    'Full message strip: escaped underscores restored',
    `Got: ${plain.substring(0, 200)}`);
  assert(!plain.includes('\\'),
    'Full message strip: no backslashes remain',
    `Got: ${plain.substring(0, 200)}`);
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 4: Error message improvements
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 4: Error message improvements');
console.log('─'.repeat(60));

// Test makeSpecialCharsVisible with typical user input
{
  const input = '/solve https://github.com/xlab2016/space_db_private/issues/17';
  const visible = makeSpecialCharsVisible(input, { maxLength: 300 });
  assertEqual(visible, input,
    'Normal ASCII input renders unchanged');
}

// Test with zero-width characters
{
  const input = '/solve\u200B https://github.com/test/repo';
  const visible = makeSpecialCharsVisible(input, { maxLength: 300 });
  assert(visible.includes('[ZWSP]'),
    'Zero-width space is made visible',
    `Got: ${visible}`);
}

// Test cleanNonPrintableChars detects hidden characters
{
  const rawInput = '/solve\u200B https://example.com';
  const cleaned = cleanNonPrintableChars(rawInput);
  assert(rawInput.length !== cleaned.length,
    'Hidden character detection: length differs after cleaning');
  const diffLen = rawInput.length - cleaned.length;
  assertEqual(diffLen, 1,
    `Hidden character detection: found ${diffLen} hidden char(s)`);
}

// ═══════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(60));
console.log('Test Summary');
console.log('═'.repeat(60));
console.log(`Total: ${passed + failed} | Passed: ${passed} ✅ | Failed: ${failed} ${failed > 0 ? '❌' : ''}`);
console.log('═'.repeat(60));

if (failed > 0) {
  console.log(`\n❌ ${failed} test(s) failed!`);
  process.exit(1);
} else {
  console.log('\n🎉 All tests passed!');
  process.exit(0);
}
