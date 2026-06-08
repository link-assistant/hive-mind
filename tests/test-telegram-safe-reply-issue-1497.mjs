#!/usr/bin/env node

/**
 * Unit tests for issue #1497: Failed to send formatted message
 *
 * Tests verify that:
 * 1. The /solve_queue text in duplicate URL message has escaped underscore
 * 2. Dynamic error messages are escaped before embedding in Markdown
 * 3. safeReply correctly falls back to plain text on Markdown parsing failure
 * 4. Messages with various special characters don't break Markdown parsing
 */

import { escapeMarkdown, cleanNonPrintableChars, makeSpecialCharsVisible } from '../src/telegram-markdown.lib.mjs';
import { buildUserMention } from '../src/buildUserMention.lib.mjs';
import { buildModelOptionDescription } from '../src/models/index.mjs';
import { initI18n, preloadAllLocales } from '../src/i18n.lib.mjs';
import { buildTelegramHelpMessage } from '../src/telegram-ui-messages.lib.mjs';
import { installTelegramFormattingFallback, isTelegramFormattingError, safeReply } from '../src/telegram-safe-reply.lib.mjs';

await initI18n();
await preloadAllLocales();

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

/**
 * Simulate Telegram's legacy Markdown parser to detect parsing issues.
 * Returns null if OK, or an error message if parsing would fail.
 *
 * Telegram's legacy Markdown rules:
 * - _ starts/ends italic (must be paired)
 * - * starts/ends bold (must be paired)
 * - ` starts/ends inline code (must be paired)
 * - [text](url) is a link
 * - Escaped chars: \_ \* \` \[ are literal
 * - Entities must not be nested
 */
function checkTelegramMarkdown(text) {
  let i = 0;
  const len = text.length;
  const openEntities = [];

  while (i < len) {
    const ch = text[i];

    // Skip escaped characters
    if (ch === '\\' && i + 1 < len && '_*`['.includes(text[i + 1])) {
      i += 2;
      continue;
    }

    // Check for inline code blocks (they consume everything until closing backtick)
    if (ch === '`') {
      const tripleBacktick = text.substring(i, i + 3) === '```';
      if (tripleBacktick) {
        const end = text.indexOf('```', i + 3);
        if (end === -1) return `Unclosed code block starting at byte ${Buffer.byteLength(text.substring(0, i))}`;
        i = end + 3;
        continue;
      }
      const end = text.indexOf('`', i + 1);
      if (end === -1) return `Unclosed inline code starting at byte ${Buffer.byteLength(text.substring(0, i))}`;
      i = end + 1;
      continue;
    }

    // Check for Markdown links [text](url)
    if (ch === '[') {
      const closeBracket = text.indexOf(']', i + 1);
      if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          i = closeParen + 1;
          continue;
        }
      }
    }

    // Check for italic/bold markers
    if (ch === '_' || ch === '*') {
      const lastOpen = openEntities.length > 0 ? openEntities[openEntities.length - 1] : null;
      if (lastOpen === ch) {
        openEntities.pop();
      } else {
        openEntities.push(ch);
      }
    }

    i++;
  }

  if (openEntities.length > 0) {
    const entity = openEntities[0] === '_' ? 'italic (_)' : 'bold (*)';
    return `Unclosed ${entity} entity - Telegram would return "can't find end of entity"`;
  }

  return null; // All good
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 1: Root cause - /solve_queue underscore (issue #1497)
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 1: Root cause - /solve_queue underscore in Markdown');
console.log('─'.repeat(60));

// Test: The EXACT failing message from issue #1497
{
  const normalizedUrl = 'https://github.com/MixaByk1996/elements-app/issues/14';
  const statusText = 'being processed';

  // OLD message (broken) - unescaped underscore
  const oldMsg = `❌ This URL is ${statusText}.\n\nURL: ${escapeMarkdown(normalizedUrl)}\nStatus: started\n\n💡 Use /solve_queue to check the queue status.`;
  const oldError = checkTelegramMarkdown(oldMsg);
  assert(oldError !== null, 'OLD message with /solve_queue has Markdown parsing issue', oldError || 'No issue detected');

  // NEW message (fixed) - escaped underscore
  const newMsg = `❌ This URL is ${statusText}.\n\nURL: ${escapeMarkdown(normalizedUrl)}\nStatus: started\n\n💡 Use /solve\\_queue to check the queue status.`;
  const newError = checkTelegramMarkdown(newMsg);
  assert(newError === null, 'NEW message with /solve\\_queue passes Markdown parsing', newError || '');
}

// Test: /solve_queue with underscore URL
{
  const url = 'https://github.com/xlab2016/space_db_private/issues/17';
  const oldMsg = `❌ This URL is being processed.\n\nURL: ${escapeMarkdown(url)}\nStatus: started\n\n💡 Use /solve_queue to check the queue status.`;
  const oldError = checkTelegramMarkdown(oldMsg);
  assert(oldError !== null, 'Message with underscore URL + /solve_queue fails Markdown', oldError || 'No issue detected');

  const newMsg = `❌ This URL is being processed.\n\nURL: ${escapeMarkdown(url)}\nStatus: started\n\n💡 Use /solve\\_queue to check the queue status.`;
  const newError = checkTelegramMarkdown(newMsg);
  assert(newError === null, 'Fixed message with underscore URL + escaped /solve\\_queue passes', newError || '');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 2: Dynamic error messages are escaped
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 2: Dynamic error messages with special characters');
console.log('─'.repeat(60));

// Test: Model validation error with [1m] (square brackets)
{
  const modelError = 'Model "sonnet" does not support [1m] context window.\n   Models supporting 1M context: opus, sonnet';
  const escapedMsg = `❌ ${escapeMarkdown(modelError)}`;
  // Note: escapeMarkdown only escapes _ and *, not [ ] - but that's by design
  // as those are rarely an issue in legacy Markdown unless paired with ()
  assert(!escapedMsg.includes('_') || escapedMsg.includes('\\_'), 'Model error underscores are escaped', `Got: ${escapedMsg}`);
}

// Test: Branch validation with underscore branch name
{
  const branchError = 'Invalid --base-branch value: branch name "feature_branch_v2" contains invalid characters';
  const escapedMsg = `❌ ${escapeMarkdown(branchError)}`;
  const error = checkTelegramMarkdown(escapedMsg);
  assert(error === null, 'Escaped branch error with underscores passes Markdown', error || '');
}

// Test: Yargs error with special characters
{
  const yargsError = 'Unknown argument: --my_custom_flag';
  const escapedMsg = `❌ Invalid options: ${escapeMarkdown(yargsError)}\n\nUse /help to see available options`;
  const error = checkTelegramMarkdown(escapedMsg);
  assert(error === null, 'Escaped yargs error with underscores passes Markdown', error || '');
}

// Test: Reject reason with special characters
{
  const rejectReason = 'Disk usage is 95% (threshold: 90%) - /dev/sda1_root is full';
  const escapedReason = escapeMarkdown(rejectReason);
  assert(!escapedReason.includes('sda1_root'), 'Reject reason underscore is escaped', `Got: ${escapedReason}`);
}

// Test: Queue waiting reason with underscore
{
  const reason = 'Claude process is already running\nMinimum interval between commands not reached (45s remaining)';
  const escapedReason = escapeMarkdown(reason);
  const error = checkTelegramMarkdown(`⏳ Waiting: ${escapedReason}`);
  assert(error === null, 'Queue waiting reason passes Markdown', error || '');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 3: Full message construction safety
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 3: Full message construction safety');
console.log('─'.repeat(60));

// Test: Starting message with all components
{
  const user = { id: 123, username: 'test_user_123' };
  const requester = buildUserMention({ user, parseMode: 'Markdown' });
  const url = 'https://github.com/my_org/my_repo/issues/42';
  const userOptionsRaw = '--model opus --tool claude';
  const solveOverrides = ['--attach-logs', '--verbose', '--no-tool-check'];

  let infoBlock = `Requested by: ${requester}\nURL: ${escapeMarkdown(url)}`;
  if (userOptionsRaw) infoBlock += `\n\n🛠 Options: ${escapeMarkdown(userOptionsRaw)}`;
  if (solveOverrides.length > 0) infoBlock += `\n🔒 Locked options: ${escapeMarkdown(solveOverrides.join(' '))}`;

  const msg = `🚀 Starting solve command...\n\n${infoBlock}`;
  const error = checkTelegramMarkdown(msg);
  assert(error === null, 'Full starting message with underscore username/URL passes Markdown', error || '');
}

// Test: Starting message with user that has no username (display name with underscores)
{
  const user = { id: 456, first_name: 'Test_User', last_name: 'Name_With_Underscores' };
  const requester = buildUserMention({ user, parseMode: 'Markdown' });
  const url = 'https://github.com/owner/repo/issues/1';

  const msg = `🚀 Starting solve command...\n\nRequested by: ${requester}\nURL: ${escapeMarkdown(url)}`;
  const error = checkTelegramMarkdown(msg);
  assert(error === null, 'Message with underscore display name passes Markdown', error || '');
}

// Test: Session name with underscores in backticks
{
  const session = 'solve-my_org-my_repo-42';
  const msg = `✅ Solve command started successfully!\n\n📊 Session: \`${session}\``;
  const error = checkTelegramMarkdown(msg);
  // Underscores inside backticks are safe (inline code)
  assert(error === null, 'Session name with underscores in backticks is safe', error || '');
}

// Test: Error output in triple backticks
{
  const errorOutput = "Error: ENOENT: no such file or directory, open '/tmp/test_file.txt'";
  const msg = `❌ Error executing solve command:\n\n\`\`\`\n${errorOutput}\n\`\`\``;
  const error = checkTelegramMarkdown(msg);
  assert(error === null, 'Error output in code block is safe', error || '');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 4: safeReply plain text fallback behavior
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 4: safeReply plain text fallback stripping');
console.log('─'.repeat(60));

// Simulate the plain text stripping that safeReply does
function stripMarkdown(text) {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\\_/g, '_')
    .replace(/\\\*/g, '*')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

// Test: Link stripping
{
  const markdown = 'Requested by: [@test\\_user](https://t.me/test_user)';
  const plain = stripMarkdown(markdown);
  assert(plain.includes('@test_user (https://t.me/test_user)'), 'Links are converted to text + URL', `Got: ${plain}`);
}

// Test: Escaped underscores are unescaped
{
  const markdown = 'Use /solve\\_queue to check status';
  const plain = stripMarkdown(markdown);
  assertEqual(plain, 'Use /solve_queue to check status', 'Escaped underscores are restored in plain text');
}

// Test: Bold text stripping
{
  const markdown = 'This is *bold* text';
  const plain = stripMarkdown(markdown);
  assertEqual(plain, 'This is bold text', 'Bold markers are stripped');
}

// Test: Inline code stripping
{
  const markdown = 'Session: `solve-my-repo-1`';
  const plain = stripMarkdown(markdown);
  assertEqual(plain, 'Session: solve-my-repo-1', 'Inline code backticks are stripped');
}

// Test: Complex message with all formatting
{
  const markdown = '🚀 Starting solve command...\n\nRequested by: [@user\\_name](https://t.me/user_name)\nURL: https://github.com/my\\_org/my\\_repo/issues/1\n\n🛠 Options: --model opus';
  const plain = stripMarkdown(markdown);
  assert(!plain.includes('\\_'), 'All escaped underscores restored in complex message', `Got: ${plain}`);
  assert(!plain.includes(']('), 'All links converted in complex message', `Got: ${plain}`);
}

// Test: safeReply warns and falls back to useful plain text on formatting errors
{
  const calls = [];
  const ctx = {
    reply: async (text, options = {}) => {
      calls.push({ text, options });
      if (calls.length === 1) throw new Error("400: Bad Request: can't parse entities: Can't find end of the entity");
      return { ok: true };
    },
  };
  await safeReply(ctx, '*Broken help message', { fallbackLocale: 'ru' });
  assertEqual(calls.length, 2, 'safeReply retries once as plain text');
  assertEqual(calls[0].options.parse_mode, 'Markdown', 'First attempt uses Markdown');
  assertEqual(calls[1].options.parse_mode, undefined, 'Fallback removes parse mode');
  assert(calls[1].text.includes('Обнаружена ошибка форматирования'), 'Fallback warns in user locale');
  assert(calls[1].text.includes('Broken help message'), 'Fallback includes original message content as plain text');
}

// Test: message length errors are handled as Telegram length-limit errors, not formatting errors
{
  const error = new Error('400: Bad Request: message is too long');
  assert(!isTelegramFormattingError(error), 'Telegram message length errors are not classified as formatting errors');
}

// Test: Russian /help exceeds Telegram's 4096-character sendMessage limit and is split safely
{
  const message = buildTelegramHelpMessage({
    locale: 'ru',
    chatId: -1002975819706,
    chatType: 'supergroup',
    chatTitle: 'Pull Request from Hive Mind',
    topicId: 32470,
    solveEnabled: true,
    taskEnabled: true,
    hiveEnabled: true,
    solveOverrides: ['--attach-logs', '--verbose', '--no-tool-check', '--disable-report-issue'],
    hiveOverrides: ['--all-issues', '--once', '--skip-issues-with-prs', '--attach-logs', '--verbose', '--no-tool-check', '--disable-report-issue'],
    showLimitsEnabled: true,
    isolationBackend: 'screen',
    modelDescription: buildModelOptionDescription(),
    restrictedMode: true,
    authorized: true,
  });
  assert(message.length > 4096, 'Russian /help reproduces the Telegram message length limit');

  const calls = [];
  const ctx = {
    reply: async (text, options = {}) => {
      calls.push({ text, options });
      if (text.length > 4096) throw new Error('400: Bad Request: message is too long');
      return { message_id: calls.length };
    },
  };

  await safeReply(ctx, message, { fallbackLocale: 'ru' });
  assert(calls.length > 1, 'safeReply splits oversized localized help into multiple messages');
  assert(
    calls.every(call => call.text.length <= 4096),
    'Every split help chunk stays within Telegram sendMessage limit'
  );
  assert(
    calls.every(call => call.options.parse_mode === 'Markdown'),
    'Split help chunks keep Markdown formatting'
  );
  assert(
    calls.every(call => checkTelegramMarkdown(call.text) === null),
    'Every split help chunk is valid Telegram Markdown'
  );
}

// Test: automatic Telegram client wrapper retries sendMessage/editMessageText
{
  const calls = [];
  const telegram = {
    sendMessage: async (chatId, text, options = {}) => {
      calls.push({ method: 'sendMessage', chatId, text, options });
      if (calls.length === 1) throw new Error("400: Bad Request: can't parse entities");
      return { ok: true };
    },
    editMessageText: async (chatId, messageId, inlineMessageId, text, options = {}) => {
      calls.push({ method: 'editMessageText', chatId, messageId, inlineMessageId, text, options });
      if (calls.length === 3) throw new Error("400: Bad Request: can't parse entities");
      return { ok: true };
    },
  };
  installTelegramFormattingFallback(telegram, { fallbackLocale: 'ru', verbose: true });
  await telegram.sendMessage(1, '*Broken send', { parse_mode: 'Markdown' });
  await telegram.editMessageText(1, 2, undefined, '*Broken edit', { parse_mode: 'Markdown' });

  assertEqual(calls.length, 4, 'send and edit each retry once');
  assertEqual(calls[1].options.parse_mode, undefined, 'send fallback removes parse mode');
  assertEqual(calls[3].options.parse_mode, undefined, 'edit fallback removes parse mode');
  assert(calls[1].text.includes('Обнаружена ошибка форматирования'), 'send fallback warns');
  assert(calls[3].text.includes('Обнаружена ошибка форматирования'), 'edit fallback warns');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 5: Regression - original issue #1460 scenarios still safe
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 5: Regression - issue #1460 scenarios');
console.log('─'.repeat(60));

// Test: User "S 19" with potential username like @s_19
{
  const user = { id: 789, username: 's_19' };
  const requester = buildUserMention({ user, parseMode: 'Markdown' });
  const url = 'https://github.com/xlab2016/space_db_private/issues/17';
  const infoBlock = `Requested by: ${requester}\nURL: ${escapeMarkdown(url)}\n\n🛠 Options: ${escapeMarkdown('--interactive-mode')}`;
  const msg = `🚀 Starting solve command...\n\n${infoBlock}`;
  const error = checkTelegramMarkdown(msg);
  assert(error === null, 'Issue #1460 scenario (underscore username + underscore URL) passes', error || '');
}

// ═══════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('═'.repeat(60));

if (failed > 0) {
  process.exit(1);
}
