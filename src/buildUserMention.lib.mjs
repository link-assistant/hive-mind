/**
 * Build a Telegram user mention link in various parse modes.
 *
 * This is a simplified version that doesn't require external dependencies.
 * It handles the most common cases for Telegram user mentions.
 *
 * @param {Object} options - Options for building the mention link.
 * @param {Object} [options.user] - Telegram user object with id, username, first_name, last_name.
 * @param {number|string} [options.id] - Telegram user ID (overrides user.id).
 * @param {string} [options.username] - Telegram username (without '@', overrides user.username).
 * @param {string} [options.first_name] - User's first name (overrides user.first_name).
 * @param {string} [options.last_name] - User's last name (overrides user.last_name).
 * @param {'HTML'|'Markdown'|'MarkdownV2'} [options.parseMode='HTML'] - The parse mode to use.
 * @returns {string} A formatted mention link for the user.
 */
export function buildUserMention({
  user,
  id: idParam,
  username: usernameParam,
  first_name: firstNameParam,
  last_name: lastNameParam,
  parseMode = 'HTML',
}) {
  // Derive core fields from `user` with inline overrides
  const id = idParam ?? user?.id;
  const username = usernameParam ?? user?.username;
  const firstName = firstNameParam ?? user?.first_name;
  const lastName = lastNameParam ?? user?.last_name;

  let displayName;
  if (username) {
    displayName = `@${username}`;
  } else {
    // Trim all string names, then filter out empty values
    const raw = [firstName, lastName];
    // Trim whitespace and Hangul filler (ㅤ) characters from names
    const trimmedAll = raw.map((rawName) => (
      typeof rawName === 'string' ? rawName.trim().replace(/^[\s\t\n\rㅤ]+|[\s\t\n\rㅤ]+$/g, '') : rawName
    ));
    const cleaned = trimmedAll.filter((name) => typeof name === 'string' && name.length > 0);
    // Use cleaned names or fallback to id
    if (cleaned.length > 0) {
      displayName = cleaned.join(' ');
    } else {
      displayName = String(id);
    }
  }

  const link = username ? `https://t.me/${username}` : `tg://user?id=${id}`;

  switch (parseMode) {
    case 'Markdown':
      // Legacy Markdown: [text](url)
      return `[${displayName}](${link})`;
    case 'MarkdownV2': {
      // MarkdownV2 requires escaping special characters
      const escapedName = displayName.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
      return `[${escapedName}](${link})`;
    }
    case 'HTML':
    default: {
      // HTML mode: <a href="url">text</a>
      const escapedHtml = displayName
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      return `<a href="${link}">${escapedHtml}</a>`;
    }
  }
}
