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
import { describeRecoveryNotStarted, findPendingKillNoticeUrl, killNoticeSessionMarker, postKillRecoveryNotice, settleKillRecoveryNotice } from './session-kill-recovery.lib.mjs';

function noticeArguments({ pullRequestUrl, sessionName, sessionInfo, killReport, exitCode, resumeCommand, options = {}, verbose }) {
  return {
    pullRequestUrl,
    sessionName,
    sessionInfo,
    diagnosis: killReport.diagnosis,
    exitCode,
    observedAt: killReport.observedAt,
    endedAt: killReport.endedAt ?? null,
    policy: killReport.policy,
    recovered: killReport.recovered,
    oomEventOnly: killReport.oomEventOnly,
    deliberateStop: killReport.deliberateStop,
    // Issue #3435: the exit line names the process behind each code.
    toolExit: killReport.toolExit || null,
    oomEvidence: killReport.oomEvidence === true,
    resumeCommand,
    runCommand: options.runCommand || undefined,
    attachLog: options.attachLog || undefined,
    verbose,
  };
}

/**
 * Issue #2809: no GitHub notice once the work is finished ("Ready to merge");
 * issue #3435: none when solve already posted its own kill comment in-process.
 */
function noticeSkipReason({ killReport = {}, sessionName, verbose = false }) {
  const reason = killReport.skippedReason || killReport.noticeSkippedReason || null;
  if (reason && verbose) console.log(`[VERBOSE] Kill notice for ${sessionName} not posted: ${reason}`);
  return reason;
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
  const { sessionName, sessionInfo, persist = () => {}, verbose = false, planRecovery = null } = context;
  const skipped = noticeSkipReason(context);
  if (skipped) return { posted: false, url: null, skipped };
  const existing = ownNotice(sessionName, sessionInfo);
  if (existing) {
    if (verbose) console.log(`[VERBOSE] Kill notice for ${sessionName} already posted${existing.url ? ` (${existing.url})` : ''}; not posting it again (issue #3530)`);
    return { posted: false, url: existing.url || null, skipped: 'already-posted' };
  }
  // Promise a recovery only when one can start (policy, attempts left, a
  // resumable session); otherwise the final notice is posted after the decision.
  if (typeof planRecovery === 'function' && !(await planRecovery())) {
    if (verbose) console.log(`[VERBOSE] No recovery can start for ${sessionName}; the kill notice is posted without a pending note (issue #3530)`);
    return { posted: false, url: null, skipped: 'no-recovery-planned' };
  }
  const notice = await announceKillOnPullRequest({ ...noticeArguments(context), recoveryPending: true });
  if (notice.posted) {
    sessionInfo.killNotice = { sessionName, url: notice.url || null, pending: true, postedAt: new Date().toISOString() };
    persist();
    if (!notice.url) console.warn(`[session-monitor] Kill notice for ${sessionName} was posted, but its comment id is unknown; it will be looked up by its marker when the recovery is decided (issue #3530)`);
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
  const { sessionName, sessionInfo, persist = () => {}, verbose = false } = context;
  const existing = ownNotice(sessionName, sessionInfo);
  if (existing) {
    if (!existing.pending) return { posted: false, edited: false, skipped: 'already-settled' };
    const outcome = { resumed: Boolean(killRecovery.resumed), reason: killRecovery.reason || null, detail: killRecovery.detail || null };
    const settled = await settlePendingNotice({ existing, outcome, context });
    sessionInfo.killNotice = { ...existing, url: settled.url || existing.url || null, pending: false, settledAt: new Date().toISOString(), settled: settled.edited, outcome: outcome.resumed ? 'recovery-started' : outcome.reason || 'not-started' };
    persist();
    return { posted: settled.followUp === true, edited: settled.edited, skipped: settled.edited ? null : settled.error };
  }
  const skipped = noticeSkipReason(context);
  if (skipped) return { posted: false, edited: false, skipped };
  const notice = await announceKillOnPullRequest({
    ...noticeArguments(context),
    resumed: Boolean(killRecovery.resumed),
    recoverySessionId: killRecovery.resumed ? killRecovery.sessionId : null,
    attempt: killRecovery.resumed ? killRecovery.attempt : null,
    maxAttempts: killRecovery.resumed ? killRecovery.maxAttempts : null,
    // Issue #3435: render the decision, never a bare "did not continue".
    recoveryOutcome: killRecovery.resumed ? null : { resumed: false, reason: killRecovery.reason || null, detail: killRecovery.detail || null },
  });
  if (notice.posted) {
    sessionInfo.killNotice = { sessionName, url: notice.url || null, pending: false, postedAt: new Date().toISOString() };
    persist();
  } else if (verbose) {
    console.log(`[VERBOSE] Killed-session notice not posted for ${sessionName}: ${notice.skipped || 'unknown reason'}`);
  }
  return { posted: notice.posted, edited: false, skipped: notice.skipped };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Edit the pending note, retrying a few times (a lost comment id is looked up
 * by its marker). When the note still cannot be edited and no recovery
 * started, a short follow-up comment says why, so "pending" is never the last word.
 */
async function settlePendingNotice({ existing, outcome, context }) {
  const { sessionName, sessionInfo, pullRequestUrl, options = {}, verbose = false } = context;
  const runCommand = options.runCommand || undefined;
  const attempts = Math.max(1, Number(options.killNoticeSettleAttempts ?? 3));
  const delayMs = Math.max(0, Number(options.killNoticeSettleDelayMs ?? 5000));
  const targetUrl = pullRequestUrl || sessionInfo?.url || null;
  let url = existing.url || null;
  let settled = { edited: false, error: 'comment id unknown' };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1 && delayMs > 0) await wait(delayMs * (attempt - 1));
    url = url || (await findPendingKillNoticeUrl({ targetUrl, sessionName, runCommand, verbose }));
    settled = url ? await settleKillRecoveryNotice({ commentUrl: url, outcome, runCommand, verbose }) : { edited: false, error: 'comment id unknown' };
    // `error: null` without an edit means the note is already gone.
    if (settled.edited || !settled.error) return { ...settled, url };
  }
  console.warn(`[session-monitor] Could not update the kill notice of ${sessionName} after ${attempts} attempts: ${settled.error} (issue #3530)`);
  if (outcome.resumed || !targetUrl) return { ...settled, url };
  const body = [killNoticeSessionMarker(sessionName), `❌ **Automatic recovery did not start** for working session \`${sessionName}\`: ${describeRecoveryNotStarted(outcome).replace(/\.+$/, '')}. No replacement session was launched; the pending note above is out of date.`].join('\n');
  const followUp = await postKillRecoveryNotice({ pullRequestUrl: targetUrl.replace(/#.*$/, ''), body, runCommand, fileSuffix: `settle-follow-up-${String(sessionName).replace(/[^A-Za-z0-9._-]/g, '-')}`, verbose });
  return { ...settled, url, followUp: followUp.posted };
}
