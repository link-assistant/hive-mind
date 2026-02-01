// Test for invisible characters in the URL
// The issue might be caused by copy-pasting from Telegram which adds special chars

// Original URL from the issue
const originalUrl = 'https://github.com/VisageDvachevsky/StoryGraph/issues';

// Check each character
console.log('Character analysis of the URL:');
console.log('URL:', originalUrl);
console.log('\nCharacter by character:');
for (let i = 0; i < originalUrl.length; i++) {
  const char = originalUrl[i];
  const code = char.charCodeAt(0);
  if (code < 32 || code > 126) {
    console.log(`  Position ${i}: '${char}' (code: ${code} = 0x${code.toString(16)}) <-- NON-ASCII!`);
  }
}

// The issue mentions special unprintable characters
console.log('\n\nPossible scenario:');
console.log('-'.repeat(60));
console.log('When user copies URL from Telegram or browser, invisible');
console.log('characters like Zero-Width Space (U+200B), Zero-Width');
console.log('Non-Joiner (U+200C), or Byte Order Mark (U+FEFF) may be');
console.log('included.');
console.log('');
console.log("These characters don't break URL parsing but DO break");
console.log("Telegram's Markdown parser when included in messages.");

// Simulate URL with zero-width space
console.log('\n\nSimulating URL with Zero-Width Space:');
const urlWithZWS = 'https://github.com/VisageDvachevsky/StoryGraph\u200B/issues';
console.log('URL with ZWS:', urlWithZWS);
console.log('URL length:', urlWithZWS.length);

// Build error message with this problematic URL
import { parseGitHubUrl } from '../../src/github.lib.mjs';

const parsed = parseGitHubUrl(urlWithZWS);
console.log('\nParsed result:', JSON.stringify(parsed, null, 2));

// The issue is that parseGitHubUrl may normalize the URL but
// the original text from ctx.message.text still contains the invisible chars
console.log('\n\nKey insight:');
console.log('-'.repeat(60));
console.log('1. User sends: /hive https://...issues (with invisible char)');
console.log('2. parseCommandArgs extracts the URL from message text');
console.log('3. The URL may contain invisible chars from copy-paste');
console.log('4. validateGitHubUrl checks the URL but the error message');
console.log('   includes the ORIGINAL url from message text');
console.log('5. When this error message is sent back via Telegram with');
console.log('   parse_mode: "Markdown", the invisible char causes parsing');
console.log('   failure because it breaks the markdown structure.');
