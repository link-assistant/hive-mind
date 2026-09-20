/**
 * Make a display name safe to use as the label of a legacy-Markdown entity
 * (`[label](url)`).
 *
 * Inside an entity TDLib copies bytes verbatim, so nothing needs escaping — but
 * a literal `]` would terminate the entity early and turn the rest of the
 * message into garbage. Those two delimiters are therefore dropped; `_` and `*`
 * are deliberately left alone (issue #2166).
 *
 * @param {string} label - Raw display name.
 * @returns {string} Label safe to embed between `[` and `]`.
 */
export function escapeMarkdownEntityLabel(label) {
  if (!label || typeof label !== 'string') return label;
  return label.replace(/[[\]]/g, '');
}

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
export function buildUserMention({ user, id: idParam, username: usernameParam, first_name: firstNameParam, last_name: lastNameParam, parseMode = 'HTML' }) {
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
    const trimmedAll = raw.map(rawName => (typeof rawName === 'string' ? rawName.trim().replace(/^[\s\t\n\rㅤ]+|[\s\t\n\rㅤ]+$/g, '') : rawName));
    const cleaned = trimmedAll.filter(name => typeof name === 'string' && name.length > 0);
    // Use cleaned names or fallback to id
    if (cleaned.length > 0) {
      displayName = cleaned.join(' ');
    } else {
      displayName = String(id);
    }
  }

  const link = username ? `https://t.me/${username}` : `tg://user?id=${id}`;

  switch (parseMode) {
    case 'Markdown': {
      // Legacy Markdown: [text](url)
      //
      // Issue #2166: do NOT backslash-escape `_` / `*` here. TDLib's
      // `parse_markdown()` only unescapes `\_ \* \` \[` at the *top level*; once it
      // is inside an entity it copies bytes verbatim until the closing `]`:
      //
      //   while (i < size && text[i] != end_character) { … text[result_size++] = text[i++]; }
      //
      // So `[@my\_user](…)` renders the backslashes literally — that is the
      // unpolished `\_` the issue reports. The label is already inside the entity,
      // which is what actually prevents the "can't find end of entity" error from
      // issue #1460; only the delimiters themselves are dangerous.
      const labelName = escapeMarkdownEntityLabel(displayName);
      return `[${labelName}](${link})`;
    }
    case 'MarkdownV2': {
      // MarkdownV2 requires escaping special characters
      const escapedName = displayName.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
      return `[${escapedName}](${link})`;
    }
    case 'HTML':
    default: {
      // HTML mode: <a href="url">text</a>
      const escapedHtml = displayName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      return `<a href="${link}">${escapedHtml}</a>`;
    }
  }
}
