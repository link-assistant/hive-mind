/**
 * Issue #2293: evidence for every auto-restart reason.
 *
 * Restart comments used to say only "**Reason:** CI failures detected" or
 * "Issue title and description edited". On link-foundation/meta-language
 * pull request 196 that comment was posted five times, about one hour per
 * session, for the very same failing check. Nobody could tell from the pull
 * request whether a reason was real: which check failed and where its run is,
 * who commented or edited what and when, or that the same checks were failing
 * again. These helpers turn each reason into short, verifiable evidence lines
 * that are both logged and posted with the "Auto-restart N/M" comment.
 *
 * Repeated CI failures are flagged, not stopped: a name-only signature cannot
 * tell "still failing, but 11/189 → 150/189" from "stuck". A session that
 * changed nothing is already stopped by the #2247 guard
 * (`stopWhenSessionRepeated`).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2293
 */

import { summarizeBodyDiff } from './description-edits.lib.mjs';

/** Evidence lines posted in one restart comment; the log keeps all of them. */
export const MAX_COMMENT_EVIDENCE_LINES = 20;

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
 * @returns {string[]}
 */
export const buildIssueEditEvidence = (issueNumber, changes = []) =>
  changes.map(change => {
    if (change.field === 'title') return `Issue #${issueNumber} title changed: "${clip(change.from)}" → "${clip(change.to)}"`;
    const summary = summarizeBodyDiff(String(change.from ?? ''), String(change.to ?? ''));
    const diffText = summary ? `+${summary.added}/-${summary.removed} lines${summary.excerpt ? `, ${summary.excerpt}` : ''}` : 'content changed';
    return `Issue #${issueNumber} description changed: ${diffText}`;
  });

/**
 * @param {{message?: string, details?: string[], checks?: Array<{name: string, html_url?: string|null}>}|null} ciBlocker
 * @returns {string[]} One line per failing check, with the run URL when known
 */
export const buildCiEvidence = ciBlocker => {
  if (!ciBlocker) return [];
  const checks = Array.isArray(ciBlocker.checks) && ciBlocker.checks.length > 0 ? ciBlocker.checks : (ciBlocker.details || []).map(name => ({ name }));
  const lines = checks.filter(check => check?.name).map(check => `Failing check: ${check.name}${check.html_url ? ` — ${check.html_url}` : ''}`);
  return lines.length > 0 ? lines : [ciBlocker.message || 'CI/CD checks are failing'];
};

/**
 * Stable signature of the failing checks, so consecutive restarts caused by
 * the very same failures are recognised.
 *
 * @param {{checks?: Array<{name: string}>, details?: string[]}|null} ciBlocker
 * @returns {string|null}
 */
export const ciFailureSignature = ciBlocker => {
  if (!ciBlocker) return null;
  const names = (ciBlocker.checks || []).map(check => check?.name).filter(Boolean);
  const source = names.length > 0 ? names : (ciBlocker.details || []).map(detail => String(detail).split(' — ')[0]).filter(Boolean);
  return source.length > 0 ? [...new Set(source)].sort().join(' | ') : null;
};

/**
 * Counts how many restarts in a row were caused by the same failing checks.
 *
 * @returns {{record: (ciBlocker: Object|null) => number}} `record` is called once per restart;
 *   pass null when the restart has no CI failure (that ends the streak)
 */
export const createCiFailureRepeatTracker = () => {
  let previous = null;
  let count = 0;
  return {
    record(ciBlocker) {
      const signature = ciFailureSignature(ciBlocker);
      count = !ciBlocker ? 0 : signature && signature === previous ? count + 1 : 1;
      previous = ciBlocker ? signature : null;
      return count;
    },
  };
};

/**
 * Evidence for one restart.
 *
 * @param {Object} params
 * @param {Array} [params.comments] - New non-bot comments that triggered the restart
 * @param {number|string|null} [params.issueNumber]
 * @param {Array} [params.issueChanges] - Issue title/description changes that triggered the restart
 * @param {Object|null} [params.ciBlocker] - The `ci_failure` blocker, when it triggered the restart
 * @param {{record: Function}|null} [params.tracker] - From createCiFailureRepeatTracker()
 * @returns {{lines: string[], repeatedCiFailures: number, feedback: string[]}}
 */
export const collectRestartEvidence = ({ comments = [], issueNumber = null, issueChanges = [], ciBlocker = null, tracker = null } = {}) => {
  const lines = [...buildCommentEvidence(comments), ...buildIssueEditEvidence(issueNumber, issueChanges), ...buildCiEvidence(ciBlocker)];
  const repeatedCiFailures = tracker ? tracker.record(ciBlocker) : ciBlocker ? 1 : 0;
  const feedback = repeatedCiFailures > 1 ? [`⚠️ The same checks have failed ${repeatedCiFailures} restarts in a row - previous attempts did not fix them, so re-read the failing job logs and change approach.`] : [];
  return { lines, repeatedCiFailures, feedback };
};

/**
 * The restart reason followed by its evidence, for the "Auto-restart N/M" comment.
 *
 * @param {string} reason
 * @param {{lines?: string[], repeatedCiFailures?: number}|null} evidence
 * @returns {string}
 */
export const formatReasonWithEvidence = (reason, evidence) => {
  const lines = evidence?.lines || [];
  const parts = [reason];
  if (lines.length > 0) {
    const shown = lines.slice(0, MAX_COMMENT_EVIDENCE_LINES);
    const more = lines.length > shown.length ? [`- …and ${lines.length - shown.length} more`] : [];
    parts.push(['**Evidence:**', ...shown.map(line => `- ${line}`), ...more].join('\n'));
  }
  if ((evidence?.repeatedCiFailures || 0) > 1) parts.push(`⚠️ The same checks have been failing for ${evidence.repeatedCiFailures} restarts in a row.`);
  return parts.join('\n\n');
};
