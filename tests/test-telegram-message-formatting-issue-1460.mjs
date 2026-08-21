#!/usr/bin/env node

/**
 * Unit tests for issue #1460: /solve command rejected with "can't parse entities" error
 *
 * Tests verify that:
 * 1. buildUserMention escapes display names in Markdown mode
 * 2. Message construction with user-generated content is safe for Telegram Markdown
 * 3. makeSpecialCharsVisible and cleanNonPrintableChars work for diagnostic logging
 */

import { buildUserMention } from '../src/buildUserMention.lib.mjs';
import { escapeMarkdown, cleanNonPrintableChars, makeSpecialCharsVisible } from '../src/telegram-markdown.lib.mjs';
import { parseTelegramLegacyMarkdown } from '../src/telegram-markdown-validator.lib.mjs';

/** Assert that Telegram's legacy-Markdown parser accepts `text` and renders `expectedRendered`. */
function assertRenders(text, expectedRendered, testName) {
  const parsed = parseTelegramLegacyMarkdown(text);
  if (!parsed.ok) {
    assert(false, testName, `Telegram would reject the message: ${parsed.description}`);
    return;
  }
  assert(parsed.text === expectedRendered, testName, parsed.text === expectedRendered ? '' : `Expected rendering: ${JSON.stringify(expectedRendered)}, Got: ${JSON.stringify(parsed.text)}`);
}

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
  // Issue #2166: the label lives inside the entity, where TDLib copies bytes
  // verbatim — escaping it would show a literal backslash to the user.
  assertEqual(result, '[@my_user](https://t.me/my_user)', 'Username with underscore is left unescaped inside the link label');
  assertRenders(`Requested by: ${result}`, 'Requested by: @my_user', 'Mention with underscore is still accepted by Telegram');
}

// Test: Username without special chars (should still work)
{
  const result = buildUserMention({ user: { id: 123, username: 'simpleuser' }, parseMode: 'Markdown' });
  assertEqual(result, '[@simpleuser](https://t.me/simpleuser)', 'Username without special chars works normally');
}

// Test: Username with multiple underscores
{
  const result = buildUserMention({ user: { id: 123, username: 'my_cool_bot' }, parseMode: 'Markdown' });
  assert(!result.includes('\\'), 'Username with multiple underscores carries no backslashes', `Got: ${result}`);
  assertRenders(`Requested by: ${result}`, 'Requested by: @my_cool_bot', 'Mention with multiple underscores renders exactly as typed');
}

// Test: Display name (first_name) with underscore (no username)
{
  const result = buildUserMention({ user: { id: 123, first_name: 'John_Doe' }, parseMode: 'Markdown' });
  assert(result.includes('John_Doe') && !result.includes('\\'), 'First name with underscore is not backslash-escaped', `Got: ${result}`);
  assertRenders(`Requested by: ${result}`, 'Requested by: John_Doe', 'First name with underscore renders exactly as typed');
}

// Test: Display name with asterisk
{
  const result = buildUserMention({ user: { id: 123, first_name: 'Star*User' }, parseMode: 'Markdown' });
  assert(result.includes('Star*User') && !result.includes('\\'), 'First name with asterisk is not backslash-escaped', `Got: ${result}`);
  assertRenders(`Requested by: ${result}`, 'Requested by: Star*User', 'First name with asterisk renders exactly as typed');
}

// Issue #2166: `]` is the one character that really is dangerous in a label —
// it would close the entity early and corrupt the rest of the message.
{
  const result = buildUserMention({ user: { id: 123, first_name: 'A]B[C' }, parseMode: 'Markdown' });
  assert(!result.slice(1, result.indexOf('](')).includes(']'), 'Entity-terminating bracket is removed from the label', `Got: ${result}`);
  assertRenders(`Requested by: ${result}`, 'Requested by: ABC', 'Label with brackets still renders as a single mention');
}

// Test: MarkdownV2 mode still works (separate escaping)
{
  const result = buildUserMention({ user: { id: 123, username: 'test_user' }, parseMode: 'MarkdownV2' });
  assert(result.includes('test\\_user'), 'MarkdownV2 mode still escapes properly');
}

// Test: HTML mode is unaffected
{
  const result = buildUserMention({ user: { id: 123, username: 'test_user' }, parseMode: 'HTML' });
  assert(result.includes('@test_user'), 'HTML mode does not escape underscores (not needed)');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 2: Full message construction safety (issue #1460)
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 2: Full message construction safety');
console.log('─'.repeat(60));

// Simulate the exact scenario from the issue (with options)
{
  const user = { id: 12345, username: 'some_user' };
  const normalizedUrl = 'https://github.com/xlab2016/space_db_private/issues/17';
  const userArgs = [normalizedUrl, '--interactive-mode'];
  const solveOverrides = ['--auto-fork'];

  const requester = buildUserMention({ user, parseMode: 'Markdown' });
  const userOptionsRaw = userArgs.slice(1).join(' ');
  let infoBlock = `Requested by: ${requester}\nURL: ${escapeMarkdown(normalizedUrl)}`;
  if (userOptionsRaw) infoBlock += `\n\n🛠 Options: ${escapeMarkdown(userOptionsRaw)}`;
  if (solveOverrides.length > 0) infoBlock += `${userOptionsRaw ? '\n' : '\n\n'}🔒 Locked options: ${escapeMarkdown(solveOverrides.join(' '))}`;

  const message = `🚀 Starting solve command...\n\n${infoBlock}`;

  // Check no unescaped underscores remain in the message (outside of Markdown link syntax)
  // Extract text outside of [...](...) links
  const textOutsideLinks = message.replace(/\[[^\]]*\]\([^)]*\)/g, '');
  const unescapedUnderscores = textOutsideLinks.match(/(?<!\\)_/g);
  assert(!unescapedUnderscores, 'No unescaped underscores in message text (outside links)', unescapedUnderscores ? `Found ${unescapedUnderscores.length} unescaped underscore(s) in: ${textOutsideLinks.substring(0, 200)}` : '');
}

// Issue #1460: Options line is omitted when no options are specified
{
  const user = { id: 12345, username: 'testuser' };
  const normalizedUrl = 'https://github.com/owner/repo/issues/1';
  const userArgs = [normalizedUrl]; // no options

  const requester = buildUserMention({ user, parseMode: 'Markdown' });
  const userOptionsRaw = userArgs.slice(1).join(' ');
  let infoBlock = `Requested by: ${requester}\nURL: ${escapeMarkdown(normalizedUrl)}`;
  if (userOptionsRaw) infoBlock += `\n\n🛠 Options: ${escapeMarkdown(userOptionsRaw)}`;

  assert(!infoBlock.includes('🛠 Options'), 'Options line is omitted when no options specified', `Got: ${infoBlock}`);
  assert(infoBlock.includes('Requested by:') && infoBlock.includes('URL:'), 'Required fields still present when no options');
}

// Issue #1460: Locked options get blank line separator when no user options
{
  const user = { id: 12345, username: 'testuser' };
  const normalizedUrl = 'https://github.com/owner/repo/issues/1';
  const userArgs = [normalizedUrl]; // no user options
  const solveOverrides = ['--auto-fork'];

  const requester = buildUserMention({ user, parseMode: 'Markdown' });
  const userOptionsRaw = userArgs.slice(1).join(' ');
  let infoBlock = `Requested by: ${requester}\nURL: ${escapeMarkdown(normalizedUrl)}`;
  if (userOptionsRaw) infoBlock += `\n\n🛠 Options: ${escapeMarkdown(userOptionsRaw)}`;
  if (solveOverrides.length > 0) infoBlock += `${userOptionsRaw ? '\n' : '\n\n'}🔒 Locked options: ${escapeMarkdown(solveOverrides.join(' '))}`;

  assert(!infoBlock.includes('🛠 Options'), 'No options line when only locked overrides present');
  assert(infoBlock.includes('\n\n🔒 Locked options'), 'Locked options have blank line separator when no user options', `Got: ${infoBlock}`);
}

// Test with user who has no username (first/last name with special chars)
{
  const user = { id: 12345, first_name: 'Test_User', last_name: 'Name*Star' };
  const normalizedUrl = 'https://github.com/owner/repo/issues/1';

  const requester = buildUserMention({ user, parseMode: 'Markdown' });
  const message = `🚀 Starting solve command...\n\nRequested by: ${requester}\nURL: ${escapeMarkdown(normalizedUrl)}`;

  // Issue #2166: the display name must survive verbatim, and the whole message
  // must still be accepted by Telegram's parser.
  assert(message.includes('Test_User Name*Star') && !requester.includes('\\'), 'Special chars in first/last name are preserved verbatim in the full message', `Got: ${message.substring(0, 200)}`);
  assertRenders(message, `🚀 Starting solve command...\n\nRequested by: Test_User Name*Star\nURL: ${normalizedUrl}`, 'Full message with special chars in names is accepted by Telegram');
}

// Test with options containing underscores
{
  const userOptionsText = escapeMarkdown('--some_option --another_flag');
  assert(userOptionsText.includes('some\\_option') && userOptionsText.includes('another\\_flag'), 'Options with underscores are properly escaped');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 3: Diagnostic logging utilities
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 3: Diagnostic logging utilities');
console.log('─'.repeat(60));

// Test makeSpecialCharsVisible with typical user input
{
  const input = '/solve https://github.com/xlab2016/space_db_private/issues/17';
  const visible = makeSpecialCharsVisible(input, { maxLength: 300 });
  assertEqual(visible, input, 'Normal ASCII input renders unchanged');
}

// Test with zero-width characters
{
  const input = '/solve\u200B https://github.com/test/repo';
  const visible = makeSpecialCharsVisible(input, { maxLength: 300 });
  assert(visible.includes('[ZWSP]'), 'Zero-width space is made visible', `Got: ${visible}`);
}

// Test cleanNonPrintableChars detects hidden characters
{
  const rawInput = '/solve\u200B https://example.com';
  const cleaned = cleanNonPrintableChars(rawInput);
  assert(rawInput.length !== cleaned.length, 'Hidden character detection: length differs after cleaning');
  const diffLen = rawInput.length - cleaned.length;
  assertEqual(diffLen, 1, `Hidden character detection: found ${diffLen} hidden char(s)`);
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
