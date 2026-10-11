#!/usr/bin/env node
/**
 * What the Telegram merge queue does when the default branch CI blocks it.
 *
 * Issue #2925: when CI/CD on `main` was red (or could not be confirmed green),
 * `/merge` stopped with "Error: Error: Cannot start merge queue: … Please run
 * /merge again once CI finishes." and left every planned PR as ⏳ pending with
 * "Skipped: 0". The queue now:
 *
 *   - marks every PR it will not merge as ⏭️ skipped, with the reason;
 *   - says plainly that CI/CD on the default branch must be fixed first for
 *     `/merge` to work, and how to fix it (`/fix --ci-cd <repository>`);
 *   - with `/merge --auto-fix-ci-cd`, starts that `/fix --ci-cd` session itself.
 *
 * Split from telegram-merge-queue.lib.mjs to keep that file under the
 * repository line limit.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2925
 */

/**
 * Error whose message is written for the chat. `/merge` shows it as-is instead
 * of replacing it with a generic "An error occurred" (see formatUserError).
 */
export class MergeQueueUserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MergeQueueUserError';
    this.userFacing = true;
  }
}

/** Short per-PR reasons (the final report truncates reasons to 50 characters). */
export const getBranchBlockedSkipReason = (branch, status) => (status === 'pending' ? `CI/CD on ${branch} is not confirmed green` : `CI/CD on ${branch} must be fixed first`);
export const getPostMergeCISkipReason = prNumber => `post-merge CI of #${prNumber} failed`;

/**
 * Mark every not-yet-processed PR from `fromIndex` on as skipped.
 * @returns {number} How many PRs were skipped.
 */
export function skipRemainingItems(processor, fromIndex, reason, { pendingStatus = 'pending', skippedStatus = 'skipped' } = {}) {
  let skipped = 0;
  for (const item of processor.items.slice(Math.max(0, fromIndex))) {
    if (item.status !== pendingStatus) continue;
    item.status = skippedStatus;
    item.error = reason;
    processor.stats.skipped++;
    skipped++;
  }
  return skipped;
}

const formatMinutes = ms => `${Math.round(ms / 60000)} min`;
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * Build the chat message for a queue stopped by the default branch CI.
 *
 * @param {Object} params
 * @param {string} params.prefix - "Cannot start merge queue" / "Merge queue stopped before PR #12"
 * @param {Object} params.gate - ensureTargetBranchReady() result
 * @param {number} params.skipped - Number of PRs marked skipped
 * @param {string} params.repoUrl - Repository URL used in the `/fix --ci-cd` hint
 * @param {number} [params.timeoutMs] - How long the queue waited for the branch CI
 * @param {Object|null} [params.autoFix] - Result of the `--auto-fix-ci-cd` dispatch, if any
 * @returns {string}
 */
export function buildBranchBlockedMessage({ prefix, gate, skipped, repoUrl, timeoutMs, autoFix = null }) {
  const branch = gate.branch || 'main';
  const planned = skipped > 0 ? ` All ${plural(skipped, 'planned merge')} ${skipped === 1 ? 'was' : 'were'} skipped.` : '';
  const fixHint = `/fix --ci-cd ${repoUrl}`;
  if (gate.status === 'pending') {
    const runs = (gate.pendingRuns || []).map(run => `${run.name} (${run.status || 'pending'})`).join(', ');
    const waited = timeoutMs ? ` within ${formatMinutes(timeoutMs)}` : '';
    return `${prefix}: CI/CD on the default branch ${branch} did not finish${waited}${runs ? ` (still running: ${runs})` : ''}, so it cannot be confirmed green. /merge only merges on top of a green default branch.${planned} Run /merge again once CI on ${branch} finishes; if it fails, CI/CD on ${branch} must be fixed first (${fixHint}).`;
  }
  let next = `Fix it with ${fixHint} (or add --auto-fix-ci-cd to /merge to start that automatically), then run /merge again.`;
  if (autoFix?.success) next = `Started ${fixHint}${autoFix.sessionName ? ` (session ${autoFix.sessionName})` : ''} to fix it; run /merge again once ${branch} is green.`;
  else if (autoFix) next = `--auto-fix-ci-cd could not start ${fixHint} (${autoFix.error || autoFix.warning || 'unknown error'}); run it manually, then run /merge again.`;
  return `${prefix}: CI/CD on the default branch ${branch} is failing (${gate.error}). CI/CD on the default branch must be fixed first for /merge to work.${planned} ${next}`;
}

/**
 * Stop the queue because the default branch CI is red or unconfirmed: skip the
 * remaining PRs, optionally dispatch `/fix --ci-cd`, and fail with a clear message.
 *
 * @param {Object} processor - MergeQueueProcessor
 * @param {Object} gate - ensureTargetBranchReady() result (ok: false)
 * @param {Object} constants - { pendingStatus, skippedStatus, timeoutMs }
 */
export async function stopQueueOnBlockedBranch(processor, gate, { pendingStatus, skippedStatus, timeoutMs }) {
  const index = processor.currentIndex;
  const prefix = index === 0 ? 'Cannot start merge queue' : `Merge queue stopped before PR #${processor.items[index].pr.number}`;
  const branch = gate.branch || 'main';
  const skipped = skipRemainingItems(processor, index, getBranchBlockedSkipReason(branch, gate.status), { pendingStatus, skippedStatus });
  processor.branchCIPendingRuns = gate.pendingRuns || [];
  processor.log(`Branch gate blocked the queue (status=${gate.status}, branch=${branch}); skipped ${skipped} PR(s)`);
  for (const run of processor.branchCIPendingRuns) processor.log(`  - pending: ${run.name}: ${run.status} (${run.html_url || 'no url'})`);
  const autoFix = gate.status === 'failed' ? await dispatchAutoFixCiCd(processor, branch) : null;
  const message = buildBranchBlockedMessage({ prefix, gate, skipped, repoUrl: `https://github.com/${processor.owner}/${processor.repo}`, timeoutMs, autoFix });
  return processor.failQueue(message, { branchCIFailedRuns: gate.failedRuns });
}

/**
 * Issue #2925: `/merge --auto-fix-ci-cd` hands a red default branch to `/fix --ci-cd`.
 * @returns {Promise<Object|null>} The spawner result, or null when the option is off.
 */
export async function dispatchAutoFixCiCd(processor, branch) {
  if (!processor.autoFixCiCd) return null;
  const url = `https://github.com/${processor.owner}/${processor.repo}`;
  if (!processor.spawnFixCiCdSession) {
    processor.autoFixCiCdResult = { success: false, sessionName: null, error: 'auto-fix-ci-cd is not configured' };
    return processor.autoFixCiCdResult;
  }
  processor.log(`Auto-fix-ci-cd: dispatching /fix --ci-cd for ${url} (${branch} is red)`);
  try {
    processor.autoFixCiCdResult = await processor.spawnFixCiCdSession({ owner: processor.owner, repo: processor.repo, url, branch });
  } catch (error) {
    processor.autoFixCiCdResult = { success: false, sessionName: null, error: error.message || String(error) };
  }
  processor.log(`Auto-fix-ci-cd: ${processor.autoFixCiCdResult?.success ? `started ${processor.autoFixCiCdResult.sessionName || 'session'}` : `failed: ${processor.autoFixCiCdResult?.error || processor.autoFixCiCdResult?.warning}`}`);
  return processor.autoFixCiCdResult;
}

/**
 * MarkdownV2 lines for the final report: runs still pending on the default
 * branch and the `--auto-fix-ci-cd` outcome.
 */
export function formatBlockedBranchReport(processor, escape) {
  let message = '';
  const pendingRuns = processor.branchCIPendingRuns || [];
  if (pendingRuns.length > 0) {
    message += `⏳ *Branch CI not finished \\(blocked queue\\):*\n`;
    for (const run of pendingRuns.slice(0, 3)) {
      const runUrl = run.html_url ? ` [View](${processor.escapeMarkdownLinkUrl(run.html_url)})` : '';
      message += `  ⏳ ${escape(run.name)} \\(${escape(run.status || 'pending')}\\)${runUrl}\n`;
    }
    if (pendingRuns.length > 3) message += `  _\\.\\.\\.and ${pendingRuns.length - 3} more_\n`;
    message += '\n';
  }
  const autoFix = processor.autoFixCiCdResult;
  if (autoFix) {
    message += autoFix.success ? `🛠️ /fix \\-\\-ci\\-cd started${autoFix.sessionName ? `: ${escape(autoFix.sessionName)}` : ''}\n\n` : `⚠️ /fix \\-\\-ci\\-cd not started: ${escape(autoFix.error || autoFix.warning || 'unknown error')}\n\n`;
  }
  return message;
}
