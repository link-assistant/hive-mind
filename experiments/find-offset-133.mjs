#!/usr/bin/env node

// Systematically find what's at byte offset 133 for different user IDs and names
function escapeMarkdown(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/_/g, '\\_').replace(/\*/g, '\\*');
}

const normalizedUrl = 'https://github.com/xlab2016/space_db_private/issues/17';

// Try different user ID lengths (7-11 digits, which covers most Telegram IDs)
for (let idLen = 7; idLen <= 12; idLen++) {
  const id = '1'.padEnd(idLen, '0');

  for (const name of ['S 19', 'S_19', 'S']) {
    const displayName = name;
    const link = `tg://user?id=${id}`;
    const requester = `[${displayName}](${link})`;

    // Version 1: with --interactive-mode
    const userOptionsText1 = '--interactive-mode';
    const msg1 = `🚀 Starting solve command...\n\nRequested by: ${requester}\nURL: ${escapeMarkdown(normalizedUrl)}\n\n🛠 Options: ${userOptionsText1}`;

    // Version 2: without --interactive-mode (options: none)
    const msg2 = `🚀 Starting solve command...\n\nRequested by: ${requester}\nURL: ${escapeMarkdown(normalizedUrl)}\n\n🛠 Options: none`;

    const buf1 = Buffer.from(msg1);
    const buf2 = Buffer.from(msg2);

    if (buf1.length > 133 && buf2.length > 133) {
      // Check what's at byte 133 in both messages
      // For the error to be at byte 133 in BOTH cases, it must be before the options text
      const char1 = String.fromCharCode(buf1[133]);
      const char2 = String.fromCharCode(buf2[133]);

      // Find the character at byte offset 133
      let byteCount = 0;
      let charIdx1 = -1;
      for (let i = 0; i < msg1.length; i++) {
        const charBytes = Buffer.byteLength(msg1.charAt(i));
        if (byteCount <= 133 && byteCount + charBytes > 133) {
          charIdx1 = i;
          break;
        }
        if (byteCount === 133) {
          charIdx1 = i;
          break;
        }
        byteCount += charBytes;
      }

      if (charIdx1 >= 0) {
        const context = msg1.substring(Math.max(0, charIdx1 - 15), Math.min(msg1.length, charIdx1 + 15));
        const charAtOffset = msg1.charAt(charIdx1);

        // Check if this is an underscore
        if (charAtOffset === '_' || charAtOffset === '*' || charAtOffset === '[' || charAtOffset === '(') {
          console.log(`⚠️  ID=${id} (${idLen} digits), name="${name}": byte 133 = "${charAtOffset}" in "...${context}..."`);
        }
      }
    }
  }
}

// Also try with usernames (not just display names)
console.log('\n--- With @username ---');
for (let usernameLen = 3; usernameLen <= 20; usernameLen++) {
  const username = 'u'.repeat(usernameLen);
  const displayName = `@${username}`;
  const link = `https://t.me/${username}`;
  const requester = `[${displayName}](${link})`;

  const msg = `🚀 Starting solve command...\n\nRequested by: ${requester}\nURL: ${escapeMarkdown(normalizedUrl)}\n\n🛠 Options: --interactive-mode`;
  const buf = Buffer.from(msg);

  if (buf.length > 133) {
    let byteCount = 0;
    for (let i = 0; i < msg.length; i++) {
      const charBytes = Buffer.byteLength(msg.charAt(i));
      if (byteCount === 133 || (byteCount < 133 && byteCount + charBytes > 133)) {
        const charAtOffset = msg.charAt(i);
        if (charAtOffset === '_' || charAtOffset === '\\') {
          const context = msg.substring(Math.max(0, i - 20), Math.min(msg.length, i + 20));
          console.log(`⚠️  username="${username}" (${usernameLen} chars): byte 133 = "${charAtOffset}" in "...${context}..."`);
        }
        break;
      }
      byteCount += charBytes;
    }
  }
}

// What if the URL is NOT escaped? Let's check that scenario
console.log('\n\n--- UNESCAPED URL scenario ---');
for (let idLen = 7; idLen <= 12; idLen++) {
  const id = '1'.padEnd(idLen, '0');
  const displayName = 'S 19';
  const link = `tg://user?id=${id}`;
  const requester = `[${displayName}](${link})`;

  // URL NOT escaped (simulating a bug where escapeMarkdown wasn't applied)
  const msg = `🚀 Starting solve command...\n\nRequested by: ${requester}\nURL: ${normalizedUrl}\n\n🛠 Options: --interactive-mode`;
  const buf = Buffer.from(msg);

  if (buf.length > 133) {
    let byteCount = 0;
    for (let i = 0; i < msg.length; i++) {
      const charBytes = Buffer.byteLength(msg.charAt(i));
      if (byteCount === 133 || (byteCount < 133 && byteCount + charBytes > 133)) {
        const charAtOffset = msg.charAt(i);
        const context = msg.substring(Math.max(0, i - 20), Math.min(msg.length, i + 20));
        if (charAtOffset === '_') {
          console.log(`⚠️  UNESCAPED _ : ID=${id} (${idLen}d): byte 133 = "${charAtOffset}" in "...${context}..."`);
        }
        break;
      }
      byteCount += charBytes;
    }
  }
}
