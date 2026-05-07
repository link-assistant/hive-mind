#!/usr/bin/env node

// Reconstruct the EXACT message that triggered byte offset 133 error
// User: "S 19" (no username, just first_name)
// URL: https://github.com/xlab2016/space_db_private/issues/17

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

// User "S 19" - likely first_name="S" and has a user id
// Or could be first_name="S 19" or first_name="S", last_name="19"
// We don't know the exact Telegram user ID, so let's try variations

const normalizedUrl = 'https://github.com/xlab2016/space_db_private/issues/17';

// The original code: URL was escaped
// userOptionsText was NOT escaped in original
// solveOverrides were NOT escaped in original

// Test with user "S 19" as first_name only (no username)
for (const userInfo of [
  { first_name: 'S 19', id: 1234567890 },
  { first_name: 'S', last_name: '19', id: 1234567890 },
  { first_name: 'S', id: 1234567890 },
]) {
  const requester = buildUserMentionOriginal(userInfo);
  const userOptionsText1 = '--interactive-mode'; // NOT escaped in original
  const userOptionsText2 = 'none'; // NOT escaped in original

  const msg1 = `🚀 Starting solve command...\n\nRequested by: ${requester}\nURL: ${escapeMarkdown(normalizedUrl)}\n\n🛠 Options: ${userOptionsText1}`;
  const msg2 = `🚀 Starting solve command...\n\nRequested by: ${requester}\nURL: ${escapeMarkdown(normalizedUrl)}\n\n🛠 Options: ${userOptionsText2}`;

  const buf1 = Buffer.from(msg1);
  const buf2 = Buffer.from(msg2);

  console.log(`\n=== User: ${JSON.stringify(userInfo)} ===`);
  console.log(`Mention: ${requester}`);
  console.log(`\nWith --interactive-mode:`);
  console.log(`Message: ${msg1}`);
  console.log(`Byte length: ${buf1.length}`);
  if (buf1.length > 133) {
    console.log(`Byte 133: "${String.fromCharCode(buf1[133])}" (0x${buf1[133].toString(16)})`);
    // Show surrounding context
    const start = Math.max(0, 125);
    const end = Math.min(buf1.length, 145);
    console.log(`Context bytes [${start}-${end}]: "${buf1.slice(start, end).toString()}"`);
  }

  console.log(`\nWithout --interactive-mode (options: none):`);
  console.log(`Message: ${msg2}`);
  console.log(`Byte length: ${buf2.length}`);
  if (buf2.length > 133) {
    console.log(`Byte 133: "${String.fromCharCode(buf2[133])}" (0x${buf2[133].toString(16)})`);
    const start = Math.max(0, 125);
    const end = Math.min(buf2.length, 145);
    console.log(`Context bytes [${start}-${end}]: "${buf2.slice(start, end).toString()}"`);
  }

  // Find ALL underscores (not escaped) in the message
  console.log('\nUnescaped underscores in message:');
  for (let i = 0; i < msg1.length; i++) {
    if (msg1[i] === '_' && (i === 0 || msg1[i - 1] !== '\\')) {
      const byteOffset = Buffer.byteLength(msg1.substring(0, i));
      console.log(`  Position ${i}, byte offset ${byteOffset}: "...${msg1.substring(Math.max(0, i - 10), i + 10)}..."`);
    }
  }
}

// WAIT - the error is byte offset 133 in BOTH cases (with and without --interactive-mode)
// This means the failing text is the SAME up to byte 133 in both messages
// The difference (options text) comes AFTER the error point

// But also - the error occurred and went to the error handler.
// The error handler itself builds a message with parse_mode: 'Markdown'
// Could the error be in the ERROR HANDLER message, not the original /solve message?

// NO - because the error handler message would be different for different Update IDs.
// The byte offset 133 is from the ORIGINAL API call that failed.

// Let me check: does the URL itself have unescaped underscores inside a Markdown link?
// The requester mention is a Markdown link: [S 19](tg://user?id=1234567890)
// The URL in URL: is escaped with escapeMarkdown

// Actually - wait. Could the issue be that the `requester` Markdown link
// contains the entire URL structure, and Telegram's Markdown parser
// gets confused by something in the message?

// Let me check if there are solveOverrides that add unescaped content
console.log('\n\n=== CHECKING LOCKED OPTIONS ===');
// solveOverrides come from environment variable SOLVE_OVERRIDES
// If the server has overrides like --model opus, they'd be added unescaped
// Example: --model opus --attach-logs --verbose
const solveOverrides = ['--model', 'opus', '--attach-logs', '--verbose', '--no-tool-check', '--auto-accept-invite', '--tokens-budget-stats'];
const overridesText = solveOverrides.join(' ');

for (const userInfo of [{ first_name: 'S 19', id: 1234567890 }]) {
  const requester = buildUserMentionOriginal(userInfo);
  const userOptionsText = '--interactive-mode';

  // Original code with overrides (NOT escaped)
  let infoBlock = `Requested by: ${requester}\nURL: ${escapeMarkdown(normalizedUrl)}\n\n🛠 Options: ${userOptionsText}`;
  infoBlock += `\n🔒 Locked options: ${overridesText}`;

  const msg = `🚀 Starting solve command...\n\n${infoBlock}`;
  const buf = Buffer.from(msg);

  console.log(`\nWith overrides:`);
  console.log(`Message:\n${msg}`);
  console.log(`\nByte length: ${buf.length}`);

  // Find ALL unescaped underscores
  console.log('\nAll underscores (escaped and unescaped):');
  for (let i = 0; i < msg.length; i++) {
    if (msg[i] === '_') {
      const escaped = i > 0 && msg[i - 1] === '\\';
      const byteOffset = Buffer.byteLength(msg.substring(0, i));
      console.log(`  Char pos ${i}, byte offset ${byteOffset}: ${escaped ? 'ESCAPED' : 'UNESCAPED'}: "...${msg.substring(Math.max(0, i - 15), Math.min(msg.length, i + 15))}..."`);
    }
  }
}

// Check what's at byte offset 133 for each scenario
console.log('\n\n=== BYTE OFFSET 133 ANALYSIS ===');
// The 🚀 emoji is 4 bytes in UTF-8
// Let's count precisely

const testUser = { first_name: 'S 19', id: 1234567890 };
const requester = buildUserMentionOriginal(testUser);
const urlEscaped = escapeMarkdown(normalizedUrl);

// WITHOUT overrides
const msgNoOverrides = `🚀 Starting solve command...\n\nRequested by: ${requester}\nURL: ${urlEscaped}\n\n🛠 Options: --interactive-mode`;
const bufNoOverrides = Buffer.from(msgNoOverrides);
console.log(`\nMessage without overrides (${bufNoOverrides.length} bytes):`);
console.log(msgNoOverrides);

// Let's find byte 133 precisely
let byteCount = 0;
for (let i = 0; i < msgNoOverrides.length; i++) {
  const charBytes = Buffer.byteLength(msgNoOverrides[i]);
  if (byteCount <= 133 && byteCount + charBytes > 133) {
    console.log(`\nByte offset 133 falls at character index ${i}: "${msgNoOverrides[i]}"`);
    console.log(`Context: "...${msgNoOverrides.substring(Math.max(0, i - 20), Math.min(msgNoOverrides.length, i + 20))}..."`);
    break;
  }
  byteCount += charBytes;
}

// Let's also check: what if the URL was NOT escaped (bug)?
const msgUnescapedUrl = `🚀 Starting solve command...\n\nRequested by: ${requester}\nURL: ${normalizedUrl}\n\n🛠 Options: --interactive-mode`;
const bufUnescapedUrl = Buffer.from(msgUnescapedUrl);
console.log(`\n\nMessage with UNESCAPED URL (${bufUnescapedUrl.length} bytes):`);
console.log(msgUnescapedUrl);

byteCount = 0;
for (let i = 0; i < msgUnescapedUrl.length; i++) {
  const charBytes = Buffer.byteLength(msgUnescapedUrl[i]);
  if (byteCount <= 133 && byteCount + charBytes > 133) {
    console.log(`\nByte offset 133 falls at character index ${i}: "${msgUnescapedUrl[i]}"`);
    console.log(`Context: "...${msgUnescapedUrl.substring(Math.max(0, i - 20), Math.min(msgUnescapedUrl.length, i + 20))}..."`);
    break;
  }
  byteCount += charBytes;
}
