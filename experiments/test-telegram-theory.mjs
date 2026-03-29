#!/usr/bin/env node

// Let me approach this from a completely different angle.
//
// What if the \_ escaping in the URL is the CAUSE of the problem?
//
// Telegram legacy Markdown:
// - \_ is supposed to output a literal underscore
// - But what if the escaped underscore interacts with other parts of the message?
//
// The message has TWO escaped underscores: space\_db\_private
// These create: space[literal_]db[literal_]private
// Between the two escaped underscores, the parser might see:
//   \_db\_ -> literal _ + "db" + literal _
//
// This should be fine in Telegram's parser...
//
// OR: What if the backslash itself causes issues?
// What if Telegram's parser, when seeing \_ in the URL text,
// doesn't properly escape and instead creates a mess?
//
// ACTUALLY - let me check something else entirely.
// The error might NOT be in the /solve response message at all.
// It could be that the /solve command triggers executeStartScreen,
// which runs the actual solve process, and then tries to EDIT the message
// with the result. The result could contain unescaped Markdown.

// Let me check executeAndUpdateMessage flow:
// 1. ctx.reply("🚀 Starting...") -> succeeds
// 2. executeStartScreen() -> runs start-screen command
// 3. safeEdit(result) -> calls editMessageText with parse_mode: 'Markdown'
//
// If step 2 produces output with underscores (like "screen session: solve-space_db_private")
// then step 3 would fail with a parsing error.
//
// But wait - if step 1 succeeds and step 3 fails, the error in step 3
// is caught by safeEdit's try/catch (just logs it, doesn't throw).
// So it wouldn't reach the global error handler.
//
// Unless... the error happens at step 1 itself.
// If step 1 fails, no startingMessage is returned, and calling
// executeAndUpdateMessage with undefined startingMessage would crash.
//
// Actually, looking at the code again (line 1025):
// const startingMessage = await safeReply(ctx, ...)
// (in our modified code) or
// const startingMessage = await ctx.reply(...) (in original code)
//
// If ctx.reply fails with a parsing error in the original code,
// the error propagates UP to the global error handler.
// The global error handler catches it, detects it's a parsing error,
// and shows the error message with debug info.
//
// So the error IS from the /solve response message (step 1).
// The byte offset 133 points to something in THAT message.

// Let me now check: what does the error message look like?
// The user saw: "❌ A message formatting error occurred."
// This matches the original error handler for isTelegramParsingError.

// OK so the conclusion is:
// 1. The /solve command constructs a message with parse_mode: 'Markdown'
// 2. The message is rejected by Telegram at byte offset 133
// 3. The error handler catches it and shows the debug info

// Now, the message looks like:
// 🚀 Starting solve command...
//
// Requested by: [DISPLAY_NAME](LINK_URL)
// URL: https://github.com/xlab2016/space\_db\_private/issues/17
//
// 🛠 Options: --interactive-mode

// The escaped underscores (\_ ) in the URL are at specific byte offsets.
// Let me calculate exactly where the escaped underscores are.

function escapeMarkdown(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/_/g, '\\_').replace(/\*/g, '\\*');
}

// We don't know the exact user info. But we know byte offset 133 is consistent.
// Let me try many user ID lengths and find which matches byte 133 on an underscore.

const normalizedUrl = 'https://github.com/xlab2016/space_db_private/issues/17';
const escapedUrl = escapeMarkdown(normalizedUrl);

console.log('Escaped URL:', escapedUrl);
console.log('Positions of \\_ in escaped URL:');
for (let i = 0; i < escapedUrl.length; i++) {
  if (escapedUrl[i] === '\\' && escapedUrl[i + 1] === '_') {
    console.log(`  Position ${i}-${i + 1}: \\_`);
  }
}

// Now let's find what user ID would put byte offset 133 at one of the \_
// For user without username (display name only, like "S 19"):
for (let idLen = 6; idLen <= 15; idLen++) {
  const id = '1'.repeat(idLen);
  const displayName = 'S 19';
  const link = `tg://user?id=${id}`;
  const requester = `[${displayName}](${link})`;

  const prefix = `🚀 Starting solve command...\n\nRequested by: ${requester}\nURL: `;
  const prefixBytes = Buffer.byteLength(prefix);

  // Where does the URL start in bytes?
  console.log(`\nID length ${idLen}: prefix bytes = ${prefixBytes}`);

  // The first \_ in the escaped URL is at position 29 (space\_db)
  const firstBackslashPos = escapedUrl.indexOf('\\');
  const firstBackslashByte = prefixBytes + firstBackslashPos;
  const firstUnderscoreByte = firstBackslashByte + 1;

  console.log(`  First \\_ in URL at message byte offset: ${firstBackslashByte}-${firstUnderscoreByte}`);

  if (firstBackslashByte === 133 || firstUnderscoreByte === 133) {
    console.log(`  ✅ MATCH! Byte 133 aligns with escaped underscore!`);
  }

  // Also check the second \_
  const secondBackslashPos = escapedUrl.indexOf('\\', firstBackslashPos + 2);
  if (secondBackslashPos >= 0) {
    const secondBackslashByte = prefixBytes + secondBackslashPos;
    const secondUnderscoreByte = secondBackslashByte + 1;
    console.log(`  Second \\_ in URL at message byte offset: ${secondBackslashByte}-${secondUnderscoreByte}`);
    if (secondBackslashByte === 133 || secondUnderscoreByte === 133) {
      console.log(`  ✅ MATCH! Byte 133 aligns with second escaped underscore!`);
    }
  }
}

// Also try with username
console.log('\n\n--- With @username ---');
for (let usernameLen = 3; usernameLen <= 25; usernameLen++) {
  const username = 'x'.repeat(usernameLen);
  const displayName = `@${username}`;
  const link = `https://t.me/${username}`;
  const requester = `[${displayName}](${link})`;

  const prefix = `🚀 Starting solve command...\n\nRequested by: ${requester}\nURL: `;
  const prefixBytes = Buffer.byteLength(prefix);

  const firstBackslashPos = escapedUrl.indexOf('\\');
  const firstBackslashByte = prefixBytes + firstBackslashPos;
  const firstUnderscoreByte = firstBackslashByte + 1;

  if (firstBackslashByte === 133 || firstUnderscoreByte === 133) {
    console.log(`Username ${usernameLen} chars: First \\_ at byte ${firstBackslashByte}-${firstUnderscoreByte} - MATCH!`);
  }

  const secondBackslashPos = escapedUrl.indexOf('\\', firstBackslashPos + 2);
  if (secondBackslashPos >= 0) {
    const secondBackslashByte = prefixBytes + secondBackslashPos;
    const secondUnderscoreByte = secondBackslashByte + 1;
    if (secondBackslashByte === 133 || secondUnderscoreByte === 133) {
      console.log(`Username ${usernameLen} chars: Second \\_ at byte ${secondBackslashByte}-${secondUnderscoreByte} - MATCH!`);
    }
  }
}

// Try with usernames containing underscores (which would make displayName have underscores)
console.log('\n\n--- With @username containing underscores ---');
for (const username of ['x_y', 'xx_yy', 'xxx_yyy', 'xxxx_yyyy', 'test_user', 'my_bot_v2']) {
  const displayName = `@${username}`;
  const link = `https://t.me/${username}`;
  const requester = `[${displayName}](${link})`;

  const msg = `🚀 Starting solve command...\n\nRequested by: ${requester}\nURL: ${escapedUrl}\n\n🛠 Options: --interactive-mode`;
  const buf = Buffer.from(msg);

  // Find positions of unescaped underscores
  let byteCount = 0;
  for (let i = 0; i < msg.length; i++) {
    const charBytes = Buffer.byteLength(msg.charAt(i));
    if (msg.charAt(i) === '_' && (i === 0 || msg.charAt(i - 1) !== '\\')) {
      if (byteCount === 133) {
        console.log(`✅ @${username}: UNESCAPED _ at byte 133! char ${i}`);
        const ctx = msg.substring(Math.max(0, i - 25), Math.min(msg.length, i + 25));
        console.log(`   Context: "...${ctx}..."`);
      } else {
        // Still report all unescaped underscores
        if (Math.abs(byteCount - 133) < 10) {
          console.log(`   @${username}: unescaped _ at byte ${byteCount} (close to 133)`);
        }
      }
    }
    byteCount += charBytes;
  }
}
