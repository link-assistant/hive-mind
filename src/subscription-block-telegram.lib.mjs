// Issue #2161: Telegram surface for subscription/account-access blocks.
//
// `/solve` prints a SUBSCRIPTION_BLOCKED_MARKER report into the session log when
// the account can no longer use the agent tool (expired/cancelled Claude MAX
// subscription, org policy, revoked ChatGPT/Codex entitlement, ...). The session
// monitor captures that log, so the same block can be replayed into the Telegram
// completion message without any extra plumbing between processes.

import { SUBSCRIPTION_BLOCKED_MARKER } from './subscription-error.lib.mjs';
import { lt } from './limits-i18n.lib.mjs';

const MAX_MESSAGE_LENGTH = 400;
const MAX_GUIDANCE_STEPS = 4;

const truncate = (value, limit = MAX_MESSAGE_LENGTH) => {
  const text = String(value || '').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
};

const stripPrefix = (line, prefix) => line.slice(line.indexOf(prefix) + prefix.length).trim();

/**
 * Parse the last SUBSCRIPTION_BLOCKED_MARKER report out of a captured session log.
 *
 * The report is emitted by formatSubscriptionErrorReport(); every line after the
 * marker line is indented, so the block ends at the first non-indented line.
 *
 * @param {string} logText
 * @returns {null|{tool: string|null, label: string|null, message: string|null, code: string|null, reason: string|null, guidance: string[], committed: boolean|null, resumeCommand: string|null}}
 */
export function parseSubscriptionBlockFromLog(logText) {
  if (!logText || typeof logText !== 'string') return null;
  if (!logText.includes(SUBSCRIPTION_BLOCKED_MARKER)) return null;

  const lines = logText.split('\n');
  // Walk backwards: the richest report (from /solve) is the last one printed.
  let markerIndex = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].includes(SUBSCRIPTION_BLOCKED_MARKER)) {
      markerIndex = i;
      break;
    }
  }
  if (markerIndex === -1) return null;

  const headline = stripPrefix(lines[markerIndex], SUBSCRIPTION_BLOCKED_MARKER).replace(/^—\s*/, '');
  const separator = headline.indexOf(':');
  const parsed = {
    tool: separator > 0 ? headline.slice(0, separator).trim() : null,
    label: separator > 0 ? headline.slice(separator + 1).trim() : headline || null,
    message: null,
    code: null,
    reason: null,
    guidance: [],
    committed: null,
    resumeCommand: null,
  };

  for (let i = markerIndex + 1; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    if (!/^\s{3}/.test(raw)) break; // end of the indented report block
    const line = raw.trim();
    if (line.startsWith('Provider said:')) parsed.message = stripPrefix(line, 'Provider said:');
    else if (line.startsWith('Error code:')) parsed.code = stripPrefix(line, 'Error code:');
    else if (line.startsWith('HTTP status:')) parsed.code = `HTTP ${stripPrefix(line, 'HTTP status:')}`;
    else if (line.startsWith('Why this stops the run:')) parsed.reason = stripPrefix(line, 'Why this stops the run:');
    else if (line.startsWith('•')) parsed.guidance.push(line.slice(1).trim());
    else if (line.startsWith('💾')) parsed.committed = true;
    else if (line.startsWith('⚠️')) parsed.committed = false;
    else if (line.startsWith('▶️')) parsed.resumeCommand = stripPrefix(line, ':');
  }

  return parsed;
}

/**
 * Render the parsed block as a Telegram extraSection (title + fenced body), the
 * same shape formatDiskDiagnosticsBlock() uses.
 *
 * @returns {string} empty string when there is nothing to show
 */
export function formatSubscriptionBlockedSection(parsed, { locale = null } = {}) {
  if (!parsed) return '';
  const options = locale ? { locale } : {};
  const body = [];

  const label = parsed.label || lt('subscription_blocked_title', {}, options);
  body.push(parsed.tool ? `${parsed.tool}: ${label}` : label);
  if (parsed.message) body.push(`${lt('subscription_blocked_provider', {}, options)}: ${truncate(parsed.message)}`);
  if (parsed.code) body.push(`${lt('subscription_blocked_code', {}, options)}: ${parsed.code}`);
  if (parsed.reason) body.push(`${lt('subscription_blocked_reason', {}, options)}: ${parsed.reason}`);
  body.push(lt('subscription_blocked_note', {}, options));
  if (parsed.guidance.length) {
    body.push('');
    body.push(`${lt('subscription_blocked_steps', {}, options)}:`);
    for (const step of parsed.guidance.slice(0, MAX_GUIDANCE_STEPS)) body.push(`  • ${step}`);
  }
  if (parsed.committed === true) {
    body.push('');
    body.push(lt('subscription_blocked_preserved', {}, options));
  }
  if (parsed.resumeCommand) {
    body.push('');
    body.push(`${lt('subscription_blocked_resume', {}, options)}: ${parsed.resumeCommand}`);
  }

  return `🚫 ${lt('subscription_blocked_title', {}, options)}\n\`\`\`\n${body.join('\n')}\n\`\`\``;
}

export default {
  parseSubscriptionBlockFromLog,
  formatSubscriptionBlockedSection,
};
