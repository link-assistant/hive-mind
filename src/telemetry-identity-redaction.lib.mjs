/**
 * Issue #4079: account identity in published logs.
 *
 * Codex's OpenTelemetry records end every line with the signed-in account:
 * `auth_mode="Chatgpt" originator=codex_exec user.account_id="…" user.email="…"`.
 * Under `--verbose` those records reach the solve log, and `--attach-logs`
 * published 3,964 copies of the operator's email address and ChatGPT account
 * id in one log. Nothing about them is a credential, so the token sanitizer let
 * them through.
 *
 * The value after each account key is replaced and the key is kept, so the
 * log still shows that a record carried an identity:
 * `user.email="<redacted>"`. Session and conversation ids are not identities
 * (the resume command needs them) and stay.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4079
 */

export const REDACTED_IDENTITY = '<redacted>';

/** Keys whose value names the account behind a run. */
export const IDENTITY_KEYS = Object.freeze(['user.email', 'user.account_id', 'user.account_uuid', 'user.id', 'chatgpt_account_id', 'chatgpt_user_id', 'organization.id']);

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ANSI = '(?:\\x1b\\[[0-9;]*m)*';
// Key (not part of a longer key; an ANSI code just before it is fine), optional colour codes around `=`, then a
// double-quoted, single-quoted or bare value.
const IDENTITY_PATTERN = new RegExp(`(?<!(?<!\\x1b\\[[0-9;]*)[\\w.-])((?:${IDENTITY_KEYS.map(escapeRegExp).join('|')})${ANSI}=${ANSI})(?:"(?:[^"\\\\\\n]|\\\\.)*"|'[^'\\n]*'|[^\\s"',;)\\]}\\x1b]+)`, 'g');

/**
 * @param {string} text
 * @returns {{text: string, redacted: number}}
 */
export const redactTelemetryIdentityWithCount = text => {
  let redacted = 0;
  const result = String(text ?? '').replace(IDENTITY_PATTERN, (match, prefix) => {
    const value = match.slice(prefix.length);
    if (value === REDACTED_IDENTITY || value === `"${REDACTED_IDENTITY}"` || value === `'${REDACTED_IDENTITY}'`) return match;
    redacted++;
    const quote = value[0] === '"' || value[0] === "'" ? value[0] : '';
    return `${prefix}${quote}${REDACTED_IDENTITY}${quote}`;
  });
  return { text: result, redacted };
};

/** @param {string} text @returns {string} the text with account identifiers replaced */
export const redactTelemetryIdentity = text => redactTelemetryIdentityWithCount(text).text;

export default { IDENTITY_KEYS, REDACTED_IDENTITY, redactTelemetryIdentity, redactTelemetryIdentityWithCount };
