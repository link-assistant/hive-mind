#!/usr/bin/env node

// The byte offset 133 is the same for BOTH commands (with and without --interactive-mode)
// Both times the error is from the global error handler showing the error
// The user "S 19" might actually have a Telegram username

// Actually, wait. I need to reconsider.
// In the original code, the debug info was ONLY shown in VERBOSE mode.
// The user SAW the debug info. So VERBOSE must have been true.
//
// But also: what if the error happens NOT from the /solve command handler,
// but from somewhere else? Like from the error handler trying to send
// a message that itself contains the unescaped user input?

// Let me check the ORIGINAL error handler behavior.
// When the /solve command sends a message with parse_mode: 'Markdown'
// and Telegram rejects it, the error goes to the global error handler.
// The error handler detects it's a parsing error and builds errorMessage.
// THEN it sends errorMessage with parse_mode: 'Markdown' (line 1334 in original).
//
// WAIT! Here's the key:
// The error handler at line 1334 sends: ctx.reply(errorMessage, { parse_mode: 'Markdown' })
// If this ALSO fails (because errorMessage contains special chars),
// it falls back to plain text.
//
// The user SAW the error message formatted with emojis.
// The 🔍 emoji is in the error message.
//
// So the FIRST error (the one at byte offset 133) came from the /solve command's
// ctx.reply() call. Then the error handler caught it and showed the debug info.
//
// The byte offset 133 refers to the ORIGINAL message that the /solve command tried to send.

// Let me now think: what if the user has a USERNAME (not just display name)?
// In the screenshot, the user appears as "S 19" - but could this be their username?
// Telegram usernames can't have spaces, so "S 19" must be a display name (first_name + last_name)
//
// BUT: the user might also have a @username!
// buildUserMention uses @username if available:
//   displayName = `@${username}`
//   link = `https://t.me/${username}`
//
// What if the username contains underscores?
// Like @S_19 or @some_user_name

function escapeMarkdown(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/_/g, '\\_').replace(/\*/g, '\\*');
}

const normalizedUrl = 'https://github.com/xlab2016/space_db_private/issues/17';

// Test with various usernames that contain underscores
const usernames = ['xlab_2016', 's_19', 'space_user', 'test_bot', 'my_solve_bot', 'xlab2016_bot', 'user_s19', 'solve_user', 'some_dev'];

for (const username of usernames) {
  const displayName = `@${username}`;
  const link = `https://t.me/${username}`;
  const requester = `[${displayName}](${link})`;

  const userOptionsText = '--interactive-mode';
  const msg = `🚀 Starting solve command...\n\nRequested by: ${requester}\nURL: ${escapeMarkdown(normalizedUrl)}\n\n🛠 Options: ${userOptionsText}`;
  const buf = Buffer.from(msg);

  // Find byte 133
  let byteCount = 0;
  for (let i = 0; i < msg.length; i++) {
    const charBytes = Buffer.byteLength(msg.charAt(i));
    if (byteCount === 133) {
      const context = msg.substring(Math.max(0, i - 25), Math.min(msg.length, i + 25));
      console.log(`@${username} (${username.length}ch): byte 133 at char ${i} = "${msg.charAt(i)}" | "...${context}..."`);

      // Check if there's an underscore problem
      // In Telegram legacy Markdown, [text](url) - the text part must not have unescaped _
      // buildUserMention ORIGINAL code did NOT escape underscores in displayName!
      if (displayName.includes('_')) {
        // Count underscores in displayName
        const underscoreCount = (displayName.match(/_/g) || []).length;
        if (underscoreCount % 2 !== 0) {
          console.log(`  ⚠️  ODD number of underscores (${underscoreCount}) in display name!`);
          console.log(`  ⚠️  This would cause "can't find end of entity" error!`);
        }
      }
      break;
    }
    byteCount += charBytes;
  }
}

// NOW: Let's focus on finding the EXACT scenario
// The error message: "Can't find end of the entity starting at byte offset 133"
// This means Telegram found an entity START marker at byte 133 but couldn't find the END.
//
// What entities exist in the message?
// 1. [displayName](link) - a Markdown link for the requester mention
// 2. Escaped underscores \_ in the URL text
//
// If displayName contains an underscore (like @some_user), the Markdown parser
// would interpret it as an italic entity start. The italic entity would be:
// _user](https://t.me/some_  <- tries to find closing _ but fails or gets confused
//
// This is EXACTLY the bug that was "fixed" in buildUserMention.lib.mjs!
// But the reviewer is asking: was the USER's display name the actual problem?
//
// Wait - but the original code ALREADY had escapeMarkdown for URLs.
// The underscores in the URL ARE escaped. So the issue must be elsewhere.
//
// Let me check: are there underscores in the Markdown link text (displayName)?
// The original buildUserMention did NOT escape underscores in displayName for Markdown mode!
// So if the user's display name or @username contained underscores, it would fail.

console.log('\n\n=== HYPOTHESIS: User has underscore in username ===');
console.log('In the original code, buildUserMention for Markdown mode did NOT escape underscores.');
console.log("If the user's @username contained underscores, the link text would have unescaped _");
console.log('Example: [@some_user](https://t.me/some_user)');
console.log('Telegram would interpret _user as start of italic entity');
console.log('This would fail with "can\'t find end of entity"');
console.log('');
console.log('But the user in the screenshot is shown as "S 19" - do they have a username?');
console.log("We don't know from the screenshot alone.");
console.log('The display name could be "S 19" while having @some_username with underscores.');
