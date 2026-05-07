#!/usr/bin/env node

// Simulate the exact message that was sent when the error occurred
// URL: https://github.com/xlab2016/space_db_private/issues/17
// Command: /solve https://github.com/xlab2016/space_db_private/issues/17

function escapeMarkdown(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/_/g, '\\_').replace(/\*/g, '\\*');
}

function buildUserMentionOriginal({ username, first_name, last_name, id }) {
  let displayName;
  if (username) {
    displayName = `@${username}`;
  } else {
    const raw = [first_name, last_name];
    const trimmedAll = raw.map(n => (typeof n === 'string' ? n.trim() : n));
    const cleaned = trimmedAll.filter(n => typeof n === 'string' && n.length > 0);
    displayName = cleaned.length > 0 ? cleaned.join(' ') : String(id);
  }
  const link = username ? `https://t.me/${username}` : `tg://user?id=${id}`;
  return `[${displayName}](${link})`;
}

// We need to figure out who the user was. Let's test both scenarios.
const normalizedUrl = 'https://github.com/xlab2016/space_db_private/issues/17';

// In the original code, URL was already escaped:
const escapedUrl = escapeMarkdown(normalizedUrl);

// Scenario 1: User with normal username
const requester1 = buildUserMentionOriginal({ username: 'someuser', id: 12345 });
const msg1 = `🚀 Starting solve command...\n\nRequested by: ${requester1}\nURL: ${escapedUrl}\n\n🛠 Options: none`;
console.log('=== Scenario 1: Normal username ===');
console.log(msg1);
console.log(`Byte length: ${Buffer.byteLength(msg1)}`);
console.log(`Byte offset 133 char: "${msg1[133]}" at position 133`);

// Show what byte 133 points to
const buf1 = Buffer.from(msg1);
console.log(`Byte at offset 133: 0x${buf1[133].toString(16)} = "${String.fromCharCode(buf1[133])}"`);
// Show context around byte 133
console.log(`Around byte 133: "...${msg1.substring(120, 150)}..."`);
console.log();

// Scenario 2: User with underscore in display name (no username)
const requester2 = buildUserMentionOriginal({ first_name: 'Some_User', id: 12345 });
const msg2 = `🚀 Starting solve command...\n\nRequested by: ${requester2}\nURL: ${escapedUrl}\n\n🛠 Options: none`;
console.log('=== Scenario 2: Display name with underscore ===');
console.log(msg2);
console.log(`Byte length: ${Buffer.byteLength(msg2)}`);

// Scenario 3: --interactive-mode option
const msg3_options = '--interactive-mode';
const msg3 = `🚀 Starting solve command...\n\nRequested by: ${requester1}\nURL: ${escapedUrl}\n\n🛠 Options: ${msg3_options}`;
console.log('\n=== Scenario 3: With --interactive-mode option ===');
console.log(msg3);
console.log(`Byte length: ${Buffer.byteLength(msg3)}`);
const buf3 = Buffer.from(msg3);
console.log(`Byte at offset 133: 0x${buf3[133].toString(16)} = "${String.fromCharCode(buf3[133])}"`);
console.log(`Around byte 133: "...${msg3.substring(120, 150)}..."`);

// Scenario 4: What if the user's first command included --interactive-mode AND URL has underscores
// AND the userOptionsText was NOT escaped?
const msg4_userOptions = '--interactive-mode'; // Note: contains no underscores, but has dashes
const msg4 = `🚀 Starting solve command...\n\nRequested by: ${requester1}\nURL: ${escapedUrl}\n\n🛠 Options: ${msg4_userOptions}`;
console.log('\n=== Scenario 4: URL already escaped, options with dashes ===');
console.log(msg4);

// Scenario 5: What if the userArgs parsing produces something with underscores?
// Let's check: /solve https://github.com/xlab2016/space_db_private/issues/17 --interactive-mode
// userArgs = parseCommandArgs(ctx.message.text)
// userArgs[0] = URL, userArgs.slice(1) = ['--interactive-mode']
// userOptionsText = '--interactive-mode'
// No underscores in options text, so escapeMarkdown wouldn't help here

// The REAL question: What exactly fails at byte offset 133?
// Let's check what message the bot actually tried to send

// Wait - the URL WAS already escaped in original code. But what about the user mention?
// Let's check if the requester's username had underscores

// Try with a username that has underscores
const requester5 = buildUserMentionOriginal({ username: 'my_cool_bot', id: 12345 });
const msg5 = `🚀 Starting solve command...\n\nRequested by: ${requester5}\nURL: ${escapedUrl}\n\n🛠 Options: none`;
console.log('\n=== Scenario 5: Username with underscore ===');
console.log(msg5);
const buf5 = Buffer.from(msg5);
console.log(`Byte length: ${Buffer.byteLength(msg5)}`);
console.log(`Byte at offset 133: 0x${buf5[133].toString(16)} = "${String.fromCharCode(buf5[133])}"`);
console.log(`Around byte 133: "...${msg5.substring(120, 150)}..."`);

// Check: the URL in the ORIGINAL code was `escapeMarkdown(normalizedUrl)`.
// BUT WAIT - Was escapeMarkdown already present in the ORIGINAL code? Let me check.
// The original code line was:
// let infoBlock = `Requested by: ${requester}\nURL: ${escapeMarkdown(normalizedUrl)}\n\n🛠 Options: ${userOptionsText}`;
// YES, escapeMarkdown was already there for the URL!

// So the URL underscores were ALREADY escaped. The question is - what WASN'T escaped?
// Let's look at what userOptionsText could contain...
// userArgs = parseCommandArgs('/solve https://github.com/xlab2016/space_db_private/issues/17 --interactive-mode')
// userArgs[0] = the URL, userArgs.slice(1) = ['--interactive-mode']
// userOptionsText = '--interactive-mode' → no underscores

// Actually, let's reconsider - maybe the issue is NOT in the /solve response message at all.
// Maybe the error comes from a later message update (executeAndUpdateMessage)?
// Or from the error handler itself?

// Let's think about this differently. The error says byte offset 133.
// In Telegram Markdown, underscores create italic. If there's an odd number of underscores,
// Telegram can't find the closing underscore and errors.

// But in the original code, the URL was already escaped. So what else could cause this?

// IMPORTANT INSIGHT: What if the error happens NOT in the initial /solve response,
// but in a LATER message edit (executeAndUpdateMessage) where the AI's output
// contains unescaped Markdown?

console.log('\n=== KEY INSIGHT ===');
console.log('The error might not be from the /solve command response itself.');
console.log('It could be from executeAndUpdateMessage() where AI output with');
console.log('unescaped Markdown gets sent via editMessageText with parse_mode: Markdown');
