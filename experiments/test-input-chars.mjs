#!/usr/bin/env node

// THEORY: The user's input message contains invisible/special characters
// that get into the response message and cause Telegram Markdown parsing to fail.
//
// For example, if the user copy-pasted the URL from somewhere, it might contain:
// - Zero-width spaces (ZWSP, U+200B)
// - Zero-width joiners (ZWJ, U+200D)
// - Right-to-left marks (U+200F)
// - Non-breaking spaces (U+00A0)
// - Em dashes that look like double dashes
//
// BUT: the code already has cleanNonPrintableChars on the URL (line 533 in validateGitHubUrl)
// So the URL SHOULD be cleaned.
//
// HOWEVER: What about the rest of ctx.message.text?
// parseCommandArgs takes ctx.message.text and splits into args
// The URL (args[0]) gets cleaned via cleanNonPrintableChars in validateGitHubUrl
// But args[1:] (the options) are NOT cleaned!
//
// What if the user's input had an em-dash (—) before "interactive-mode"?
// The code already handles this: normalizedArgsText = argsText.replace(/—/g, '--');
//
// But what about OTHER invisible characters in the options text?
// The userOptionsText = userArgs.slice(1).join(' ')
// This text goes DIRECTLY into the Markdown message without cleaning!

// Let me check: does the user's Telegram display name get cleaned?
// buildUserMention uses ctx.from which has first_name, last_name
// These are NOT cleaned of non-printable characters!
//
// WHAT IF the user "S 19" has invisible characters in their display name?!
// For example: "S\u200B19" or "S\u00A019" or "S\u200D19"
//
// In Telegram's Markdown, these invisible characters could cause the parser
// to miscount byte offsets and fail to find entity boundaries!

function escapeMarkdown(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/_/g, '\\_').replace(/\*/g, '\\*');
}

function buildUserMentionOriginal({ first_name, id }) {
  const displayName = first_name || String(id);
  const link = `tg://user?id=${id}`;
  return `[${displayName}](${link})`;
}

// Test with various invisible characters in the display name
const testNames = [
  { desc: 'Normal "S 19"', first_name: 'S 19' },
  { desc: 'With ZWSP: "S\\u200B19"', first_name: 'S\u200B19' },
  { desc: 'With ZWJ: "S\\u200D19"', first_name: 'S\u200D19' },
  { desc: 'With ZWNJ: "S\\u200C19"', first_name: 'S\u200C19' },
  { desc: 'With NBSP: "S\\u00A019"', first_name: 'S\u00A019' },
  { desc: 'With Hangul filler: "Sㅤ19"', first_name: 'Sㅤ19' },
  { desc: 'With BOM: "S\\uFEFF19"', first_name: 'S\uFEFF19' },
  // What if the name contains underscores or asterisks?
  { desc: 'With underscore: "S_19"', first_name: 'S_19' },
  { desc: 'With asterisk: "S*19"', first_name: 'S*19' },
];

const normalizedUrl = 'https://github.com/xlab2016/space_db_private/issues/17';

for (const { desc, first_name } of testNames) {
  const requester = buildUserMentionOriginal({ first_name, id: 1234567890 });
  const msg = `🚀 Starting solve command...\n\nRequested by: ${requester}\nURL: ${escapeMarkdown(normalizedUrl)}\n\n🛠 Options: --interactive-mode`;
  const buf = Buffer.from(msg);

  // Find any unescaped special Markdown characters
  const issues = [];
  let inLink = false;
  for (let i = 0; i < msg.length; i++) {
    if (msg[i] === '[') inLink = true;
    if (msg[i] === ')' && inLink) inLink = false;

    if (msg[i] === '_' && (i === 0 || msg[i - 1] !== '\\') && !inLink) {
      issues.push(`Unescaped _ at char ${i}, byte ${Buffer.byteLength(msg.substring(0, i))}`);
    }
    if (msg[i] === '*' && (i === 0 || msg[i - 1] !== '\\') && !inLink) {
      issues.push(`Unescaped * at char ${i}, byte ${Buffer.byteLength(msg.substring(0, i))}`);
    }
  }

  console.log(`\n${desc}:`);
  console.log(`  Mention: ${requester}`);
  console.log(`  Name bytes: ${Buffer.byteLength(first_name)}, display: "${first_name}"`);
  console.log(`  Message bytes: ${buf.length}`);
  if (issues.length > 0) {
    console.log(`  ⚠️  ISSUES: ${issues.join(', ')}`);
  }
  if (buf.length >= 133) {
    console.log(`  Byte 133: "${String.fromCharCode(buf[133])}" (0x${buf[133].toString(16)})`);
  }
}

// NOW THE KEY TEST: What if the display name contains an underscore?
// "[S_19](tg://user?id=1234567890)"
// Inside the [] of a Markdown link, the _ would be treated as an italic marker!
// Telegram would see [S and then _19] and try to create italic from _ to ]
// But ] is not a valid end of italic entity...

console.log('\n\n=== CRITICAL TEST: Underscore in display name inside link ===');
const nameWithUnderscore = 'S_19';
const mention = `[${nameWithUnderscore}](tg://user?id=1234567890)`;
console.log(`Mention: ${mention}`);
console.log('Telegram legacy Markdown would interpret _ as italic start inside [...]');
console.log('This would create: [S <italic>19](tg://user?id=1234567890)</italic>');
console.log('Which is malformed Markdown!');

// But wait - the user shown in the screenshot is "S 19" with a SPACE, not underscore
// However, what if Telegram renders the display name differently than what we see?
// Or what if the space is actually a non-printable character?

console.log('\n\n=== What if the space is not a regular space? ===');
// Check different space-like characters
const spaceChars = [
  { desc: 'Regular space', char: ' ', code: 0x20 },
  { desc: 'NBSP', char: '\u00A0', code: 0xa0 },
  { desc: 'Narrow NBSP', char: '\u202F', code: 0x202f },
  { desc: 'En space', char: '\u2002', code: 0x2002 },
  { desc: 'Em space', char: '\u2003', code: 0x2003 },
  { desc: 'Thin space', char: '\u2009', code: 0x2009 },
  { desc: 'Hair space', char: '\u200A', code: 0x200a },
  { desc: 'Ideographic space', char: '\u3000', code: 0x3000 },
];

for (const { desc, char } of spaceChars) {
  const name = `S${char}19`;
  const m = buildUserMentionOriginal({ first_name: name, id: 1234567890 });
  const msg = `🚀 Starting solve command...\n\nRequested by: ${m}\nURL: ${escapeMarkdown(normalizedUrl)}\n\n🛠 Options: --interactive-mode`;
  const buf = Buffer.from(msg);
  console.log(`${desc}: mention="${m}", msg bytes=${buf.length}`);
}
