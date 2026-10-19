/**
 * One GitHub comment per kill (issue #3530).
 *
 * Before #3530 a single out-of-memory kill produced up to four comments: the
 * auto-updating recovery lifecycle comment, the "📎 Intermediate working-session
 * log (killed session)" upload, the kill notice (posted only AFTER the recovery
 * had launched, so it appeared below the next "AI Work Session Started"), and
 * then the recovery's own start comment.
 *
 * Now:
 *   1. When a recovery will be attempted, the kill notice is posted at once —
 *      with the log embedded when `--attach-logs` is on — and carries a note
 *      that auto recovery (resume or restart as per configuration) is pending.
 *   2. Waiting for resources, launching and heartbeats go to Telegram only.
 *   3. Once the recovery decision is known the same comment is edited: the
 *      note is removed when the recovery started, or replaced with the reason
 *      it did not. The recovery session's start comment is the one more comment.
 *
 * The posted notice is remembered on the tracked session (`killNotice`), so a
 * bot restart while the recovery waits does not post it again.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3530
 */

import { announceKillOnPullRequest } from './session-monitor.kill-sections.lib.mjs';
import { settleKillRecoveryNotice } from './session-kill-recovery.lib.mjs';

function noticeArguments({ pullRequestUrl, sessionName, sessionInfo, killReport, exitCode, resumeCommand, options = {}, verbose }) {
  return {
    pullRequestUrl,
    sessionName,
    sessionInfo,
    diagnosis: killReport.diagnosis,
    exitCode,
    observedAt: killReport.observedAt,
    policy: killReport.policy,
    recovered: killReport.recovered,
    oomEventOnly: killReport.oomEventOnly,
    deliberateStop: killReport.deliberateStop,
    resumeCommand,
    runCommand: options.runCommand || undefined,
    attachLog: options.attachLog || undefined,
    verbose,
  };
}

function ownNotice(sessionName, sessionInfo) {
  const notice = sessionInfo?.killNotice;
  return notice && notice.sessionName === sessionName ? notice : null;
}

/**
 * Post the kill notice with its "recovery pending" note, before the recovery
 * waits for resources and launches.
 *
 * @returns {Promise<{posted: boolean, url: string|null, skipped: string|null}>}
 */
export async function announcePendingKillNotice(context) {
  try {
    return await announcePendingKillNoticeUnsafe(context);
  } catch (error) {
    console.warn(`[session-monitor] Pending kill notice for ${context?.sessionName} failed: ${error?.message || error}`);
    return { posted: false, url: null, skipped: `error: ${error?.message || error}` };
  }
}

async function announcePendingKillNoticeUnsafe(context) {
  const { sessionName, sessionInfo, persist = () => {}, verbose = false } = context;
  const existing = ownNotice(sessionName, sessionInfo);
  if (existing) {
    if (verbose) console.log(`[VERBOSE] Kill notice for ${sessionName} already posted${existing.url ? ` (${existing.url})` : ''}; not posting it again (issue #3530)`);
    return { posted: false, url: existing.url || null, skipped: 'already-posted' };
  }
  const notice = await announceKillOnPullRequest({ ...noticeArguments(context), recoveryPending: true });
  if (notice.posted) {
    sessionInfo.killNotice = { sessionName, url: notice.url || null, pending: true, postedAt: new Date().toISOString() };
    persist();
    if (!notice.url) console.warn(`[session-monitor] Kill notice for ${sessionName} was posted, but its comment id is unknown; the pending note cannot be removed later (issue #3530)`);
  } else if (verbose) {
    console.log(`[VERBOSE] Pending kill notice not posted for ${sessionName}: ${notice.skipped || 'unknown reason'}`);
  }
  return notice;
}

/**
 * Finish the kill notice once the recovery decision is known: edit the pending
 * note, or (when no notice was posted yet) post the final notice.
 *
 * @returns {Promise<{posted: boolean, edited: boolean, skipped: string|null}>}
 */
export async function finishKillNotice(context) {
  try {
    return await finishKillNoticeUnsafe(context);
  } catch (error) {
    // Reporting must never stop the Telegram completion message.
    console.warn(`[session-monitor] Kill notice for ${context?.sessionName} failed: ${error?.message || error}`);
    return { posted: false, edited: false, skipped: `error: ${error?.message || error}` };
  }
}

async function finishKillNoticeUnsafe({ killRecovery = {}, ...context }) {
  const { sessionName, sessionInfo, persist = () => {}, verbose = false, options = {} } = context;
  const existing = ownNotice(sessionName, sessionInfo);
  if (existing) {
    if (!existing.pending) return { posted: false, edited: false, skipped: 'already-settled' };
    const outcome = { resumed: Boolean(killRecovery.resumed), reason: killRecovery.reason || null, detail: killRecovery.detail || null };
    const settled = existing.url ? await settleKillRecoveryNotice({ commentUrl: existing.url, outcome, runCommand: options.runCommand || undefined, verbose }) : { edited: false, error: 'comment id unknown' };
    // A failed edit is not retried: the outcome is in Telegram and the next
    // start comment, and retrying on every tick could flood the API.
    sessionInfo.killNotice = { ...existing, pending: false, settledAt: new Date().toISOString(), settled: settled.edited, outcome: outcome.resumed ? 'recovery-started' : outcome.reason || 'not-started' };
    persist();
    if (!settled.edited && settled.error) console.warn(`[session-monitor] Could not update the kill notice of ${sessionName}: ${settled.error} (issue #3530)`);
    return { posted: false, edited: settled.edited, skipped: settled.edited ? null : settled.error };
  }
  const notice = await announceKillOnPullRequest({
    ...noticeArguments(context),
    resumed: Boolean(killRecovery.resumed),
    recoverySessionId: killRecovery.resumed ? killRecovery.sessionId : null,
    attempt: killRecovery.resumed ? killRecovery.attempt : null,
    maxAttempts: killRecovery.resumed ? killRecovery.maxAttempts : null,
  });
  if (notice.posted) {
    sessionInfo.killNotice = { sessionName, url: notice.url || null, pending: false, postedAt: new Date().toISOString() };
    persist();
  } else if (verbose) {
    console.log(`[VERBOSE] Killed-session notice not posted for ${sessionName}: ${notice.skipped || 'unknown reason'}`);
  }
  return { posted: notice.posted, edited: false, skipped: notice.skipped };
}
