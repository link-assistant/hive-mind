#!/usr/bin/env node
/**
 * Experiment: Reproduce the Markdown parsing failure from issue #1497
 *
 * Reconstructs the exact messages that would be sent by the /solve handler
 * and checks them for Markdown parsing issues.
 */

import { buildUserMention } from '../src/buildUserMention.lib.mjs';
import { escapeMarkdown } from '../src/telegram-markdown.lib.mjs';

// From the screenshot: user is @mbyk96, URL is elements-app issue #14
const user = {
  id: 123456789,
  username: 'mbyk96',
  first_name: 'mixa',
  last_name: 'byk',
};

const normalizedUrl = 'https://github.com/MixaByk1996/elements-app/issues/14';
const userArgs1 = [normalizedUrl, '--model', 'opus']; // First call (succeeded)
const userArgs2 = [normalizedUrl]; // Second call (failed)

const solveOverrides = ['--attach-logs', '--verbose', '--no-tool-check', '--auto-accept-invite', '--tokens-budget-start'];

function buildInfoBlock(userArgs) {
  const requester = buildUserMention({ user, parseMode: 'Markdown' });
  const userOptionsRaw = userArgs.slice(1).join(' ');
  let infoBlock = `Requested by: ${requester}\nURL: ${escapeMarkdown(normalizedUrl)}`;
  if (userOptionsRaw) infoBlock += `\n\n🛠 Options: ${escapeMarkdown(userOptionsRaw)}`;
  if (solveOverrides.length > 0) infoBlock += `${userOptionsRaw ? '\n' : '\n\n'}🔒 Locked options: ${escapeMarkdown(solveOverrides.join(' '))}`;
  return infoBlock;
}

// Test message construction for both calls
console.log('=== First call (--model opus) - SUCCEEDED ===');
const infoBlock1 = buildInfoBlock(userArgs1);
const msg1 = `🚀 Starting solve command...\n\n${infoBlock1}`;
console.log('Message:');
console.log(msg1);
console.log(`\nByte length: ${Buffer.byteLength(msg1, 'utf-8')}`);

console.log('\n=== Second call (no options) - FAILED ===');
const infoBlock2 = buildInfoBlock(userArgs2);
const msg2 = `🚀 Starting solve command...\n\n${infoBlock2}`;
console.log('Message:');
console.log(msg2);
console.log(`\nByte length: ${Buffer.byteLength(msg2, 'utf-8')}`);

// Compare the two messages character by character
console.log('\n=== Difference ===');
console.log('Message 1 length:', msg1.length);
console.log('Message 2 length:', msg2.length);

// Check for unescaped Markdown characters
function findMarkdownIssues(text) {
  const issues = [];
  // Check for unescaped _ outside of Markdown links
  let inLink = false;
  let inLinkText = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '[') inLinkText = true;
    if (text[i] === ']' && text[i + 1] === '(') {
      inLinkText = false;
      inLink = true;
    }
    if (inLink && text[i] === ')') inLink = false;

    if (!inLink && !inLinkText) {
      if (text[i] === '_' && text[i - 1] !== '\\') {
        issues.push({ pos: i, char: '_', context: text.substring(Math.max(0, i - 10), i + 10) });
      }
      if (text[i] === '*' && text[i - 1] !== '\\') {
        issues.push({ pos: i, char: '*', context: text.substring(Math.max(0, i - 10), i + 10) });
      }
      if (text[i] === '`' && text[i - 1] !== '\\') {
        issues.push({ pos: i, char: '`', context: text.substring(Math.max(0, i - 10), i + 10) });
      }
      if (text[i] === '[' && text[i - 1] !== '\\') {
        issues.push({ pos: i, char: '[', context: text.substring(Math.max(0, i - 10), i + 10) });
      }
    }
  }
  return issues;
}

console.log('\n=== Markdown issues in message 1 ===');
const issues1 = findMarkdownIssues(msg1);
console.log(issues1.length > 0 ? issues1 : 'None found');

console.log('\n=== Markdown issues in message 2 ===');
const issues2 = findMarkdownIssues(msg2);
console.log(issues2.length > 0 ? issues2 : 'None found');

// Test the duplicate URL message
console.log('\n=== Duplicate URL message ===');
const existingItem = { status: 'started' };
const statusText = existingItem.status === 'starting' || existingItem.status === 'started' ? 'being processed' : 'already in the queue';
const dupMsg = `❌ This URL is ${statusText}.\n\nURL: ${escapeMarkdown(normalizedUrl)}\nStatus: ${existingItem.status}\n\n💡 Use /solve_queue to check the queue status.`;
console.log('Message:');
console.log(dupMsg);
const dupIssues = findMarkdownIssues(dupMsg);
console.log('Issues:', dupIssues.length > 0 ? dupIssues : 'None found');

// Test the successful edit message (line 598)
console.log('\n=== Successful edit message ===');
const session = 'solve-MixaByk1996-elements-app-14';
const editMsg = `✅ Solve command started successfully!\n\n📊 Session: \`${session}\`\n\n${infoBlock1}`;
console.log('Message:');
console.log(editMsg);
const editIssues = findMarkdownIssues(editMsg);
console.log('Issues:', editIssues.length > 0 ? editIssues : 'None found');

// Now test with a user that has underscores in username
console.log('\n=== Test with underscore username ===');
const userWithUnderscores = {
  id: 987654321,
  username: 'mixa_byk_1996',
  first_name: 'mixa',
  last_name: 'byk',
};
const requesterUnder = buildUserMention({ user: userWithUnderscores, parseMode: 'Markdown' });
console.log('Mention:', requesterUnder);
const infoBlockUnder = `Requested by: ${requesterUnder}\nURL: ${escapeMarkdown(normalizedUrl)}`;
console.log('InfoBlock:', infoBlockUnder);
const msgUnder = `🚀 Starting solve command...\n\n${infoBlockUnder}`;
console.log('Full message:', msgUnder);
const underIssues = findMarkdownIssues(msgUnder);
console.log('Issues:', underIssues.length > 0 ? underIssues : 'None found');

// Now test with a user that has NO username (display name only)
console.log('\n=== Test with no username ===');
const userNoUsername = {
  id: 111222333,
  first_name: 'Test_User',
  last_name: 'Name*With*Stars',
};
const requesterNoUser = buildUserMention({ user: userNoUsername, parseMode: 'Markdown' });
console.log('Mention:', requesterNoUser);

// Test with URL containing underscores
console.log('\n=== Test with underscore URL ===');
const underscoreUrl = 'https://github.com/xlab2016/space_db_private/issues/17';
const escapedUrl = escapeMarkdown(underscoreUrl);
console.log('Escaped URL:', escapedUrl);

// Check: what if escapeMarkdown double-escapes already-escaped text?
console.log('\n=== Double-escape test ===');
const alreadyEscaped = 'space\\_db\\_private';
console.log('Already escaped:', alreadyEscaped);
console.log('Double escaped:', escapeMarkdown(alreadyEscaped));

// Test the error handler's sanitized message
console.log('\n=== Error handler sanitized message test ===');
const testError = "ENOENT: no such file or directory, open '/tmp/test_file.txt'";
const sanitized = escapeMarkdown(testError);
console.log('Original:', testError);
console.log('Sanitized:', sanitized);
// Note: this still has [ ] ( ) which are valid Markdown link chars!

// KEY INSIGHT: escapeMarkdown only escapes _ and *
// But Telegram's legacy Markdown also interprets:
// - [text](url) as links
// - `text` as inline code
// These are NOT escaped by escapeMarkdown!
console.log('\n=== KEY FINDING ===');
console.log('escapeMarkdown only escapes: _ and *');
console.log('But Telegram legacy Markdown also interprets: [] () `` ```');
console.log('If any message text contains [] or () together, they could be misinterpreted as links');
console.log('If any message text contains single `, it could be misinterpreted as code');
