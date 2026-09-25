/**
 * Issue #2293: evidence for auto-restart reasons.
 *
 * Restart comments used to say only "**Reason:** CI failures detected" or
 * "Issue title and description edited". Nobody could tell from the pull
 * request whether the reason was real: which check failed, where its run is,
 * who edited what and when. These helpers turn each restart reason into short,
 * verifiable evidence lines that are both logged and posted with the
 * "Auto-restart N/M" comment.
 */

import { summarizeBodyDiff } from './description-edits.lib.mjs';

const MAX_EVIDENCE_LINES = 20;
const clip = (text, max = 100) => {
  const value = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
};

/**
 * @param {Array<{user?: {login?: string}, created_at?: string, html_url?: string, body?: string}>} comments
 * @returns {string[]}
 */
export const buildCommentEvidence = (comments = []) =>
  comments.map(comment => {
    const where = comment.html_url ? ` — ${comment.html_url}` : '';
    return `Comment by ${comment.user?.login || 'unknown'} at ${comment.created_at || 'unknown time'}${where}: "${clip(comment.body)}"`;
  });

/**
 * @param {number|string} issueNumber
 * @param {Array<{field: 'title'|'body', from?: string, to?: string}>} changes - from checkForIssueMetadataChanges()
 * @param {Date|string|null} [detectedAt]
 * @returns {string[]}
 */
export const buildIssueEditEvidence = (issueNumber, changes = [], detectedAt = null) => {
  const when = detectedAt ? ` (detected at ${new Date(detectedAt).toISOString()})` : '';
  return changes.map(change => {
    if (change.field === 'title') {
      return `Issue #${issueNumber} title changed${when}: "${clip(change.from)}" → "${clip(change.to)}"`;
    }
    const summary = summarizeBodyDiff(String(change.from ?? ''), String(change.to ?? ''));
    const diffText = summary ? `+${summary.added}/-${summary.removed} lines${summary.excerpt ? `, ${summary.excerpt}` : ''}` : 'content changed';
    return `Issue #${issueNumber} description changed${when}: ${diffText}`;
  });
};

/**
 * @param {{message?: string, details?: string[]}} ciBlocker
 * @returns {string[]}
 */
export const buildCiEvidence = ciBlocker => {
  if (!ciBlocker) return [];
  const details = (ciBlocker.details || []).map(detail => `Failing check: ${detail}`);
  return details.length > 0 ? details : [ciBlocker.message || 'CI/CD checks are failing'];
};

/**
 * Stable signature of the failing checks, so consecutive restarts caused by
 * the very same failures can be recognised and reported as such.
 * @param {{checks?: Array<{name: string}>, details?: string[]}} ciBlocker
 * @returns {string|null}
 */
export const ciFailureSignature = ciBlocker => {
  if (!ciBlocker) return null;
  const names = (ciBlocker.checks || []).map(check => check.name).filter(Boolean);
  const source = names.length > 0 ? names : (ciBlocker.details || []).map(detail => String(detail).split(' — ')[0]);
  if (source.length === 0) return null;
  return [...new Set(source)].sort().join(' | ');
};

/**
 * @param {Object} params
 * @param {string} params.marker - AUTO_RESTART_MARKER
 * @param {string} params.label - formatAutoRestartLabel(restartCount)
 * @param {string} params.reason
 * @param {string[]} [params.evidence]
 * @param {string} params.limitText
 * @param {number} [params.repeatedCiFailures] - how many restarts in a row were caused by the same failing checks
 * @returns {string}
 */
export const buildAutoRestartCommentBody = ({ marker, label, reason, evidence = [], limitText, repeatedCiFailures = 0 }) => {
  const lines = [`## 🔄 ${marker} ${label}`, '', `**Reason:** ${reason}`];
  if (evidence.length > 0) {
    const shown = evidence.slice(0, MAX_EVIDENCE_LINES);
    lines.push('', '**Evidence:**', ...shown.map(line => `- ${line}`));
    if (evidence.length > shown.length) lines.push(`- …and ${evidence.length - shown.length} more`);
  }
  if (repeatedCiFailures > 1) {
    lines.push('', `⚠️ The same checks have been failing for ${repeatedCiFailures} restarts in a row.`);
  }
  lines.push('', 'Starting new session to address the issues.', '', '---', `*Auto-restart-until-mergeable mode is active. ${limitText}*`);
  return lines.join('\n');
};
