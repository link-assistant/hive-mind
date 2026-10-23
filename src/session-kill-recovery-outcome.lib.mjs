/**
 * The outcome of an automatic recovery attempt, on the kill notice it came from
 * (issue #3435).
 *
 * A kill notice says that automatic recovery started. When that recovery
 * session then fails or is killed too, the notice must not stay the last word:
 * the inherited notice is edited once with
 *
 *   🔁 **Recovery attempt 1/3 ended:** exit 1 (solve); the AI tool (claude)
 *   exited 137 (SIGKILL, cgroup OOM). Recovery attempt 2/3 started in working
 *   session `…`.
 *
 * A new comment is posted only when the notice cannot be edited.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3435
 */

import { classifySessionOutcome } from './work-session-formatting.lib.mjs';
import { describeRecoveryNotStarted, editKillRecoveryNotice, findPendingKillNoticeUrl, killNoticeSessionMarker, postKillRecoveryNotice } from './session-kill-recovery.lib.mjs';
import { argvFromSessionArgs, hasContainerOomEvidence, pullRequestReportSkipReason, startedIssueUrl, startedPullRequestUrl } from './session-monitor.kill-sections.lib.mjs';
import { resolveSessionKillResumeAttempts } from './session-kill-policy.lib.mjs';
import { describeSessionExitCodes, detectToolExitCode } from './session-tool-exit.lib.mjs';
import { recoveryLogStartOffset } from './session-recovery-footer.lib.mjs';

const FOOTER = '<sub>Reported by Hive Mind</sub>';

/** Marks the outcome line of one recovery session, so it is added once. */
export function recoveryOutcomeMarker(sessionName) {
  return `<!-- hive-mind:recovery-outcome:${String(sessionName || 'session').replace(/[^A-Za-z0-9._-]/g, '-')} -->`;
}

/**
 * The outcome line.
 *
 * @param {Object} options
 * @param {number|null} options.attempt - This recovery attempt
 * @param {number|null} [options.maxAttempts]
 * @param {string|null} options.exitLine - From describeSessionExitCodes()
 * @param {Object|null} [options.killRecovery] - The decision about the next attempt
 * @returns {string}
 */
export function formatRecoveryAttemptOutcome({ attempt = null, maxAttempts = null, exitLine = null, killRecovery = null } = {}) {
  const of = maxAttempts ? `/${maxAttempts}` : '';
  const head = `🔁 **Recovery attempt ${attempt || '?'}${of} ended:** exit ${exitLine || 'unknown'}.`;
  if (killRecovery?.resumed) {
    const next = killRecovery.attempt ? ` ${killRecovery.attempt}${killRecovery.maxAttempts ? `/${killRecovery.maxAttempts}` : ''}` : '';
    return `${head} Recovery attempt${next} started${killRecovery.sessionId ? ` in working session \`${killRecovery.sessionId}\`` : ''}.`;
  }
  if (killRecovery?.reason) return `${head} No further attempt: ${describeRecoveryNotStarted(killRecovery).replace(/\.+$/, '').slice(0, 500)}.`;
  return `${head} No further attempt was started automatically.`;
}

/**
 * Add the outcome line before the notice footer.
 *
 * @returns {string|null} New body, or null when this session's line is already there
 */
export function insertRecoveryOutcome(body, sessionName, line) {
  const text = String(body || '');
  const marker = recoveryOutcomeMarker(sessionName);
  if (text.includes(marker)) return null;
  const block = `${marker}\n${line}`;
  const at = text.lastIndexOf(FOOTER);
  if (at < 0) return `${text.replace(/\s+$/, '')}\n\n${block}`;
  return `${text.slice(0, at).replace(/\s+$/, '')}\n\n${block}\n\n${text.slice(at)}`;
}

/**
 * Edit the kill notice a failed or killed recovery session inherited. Never throws.
 *
 * @param {Object} context - The monitor's kill notice context plus `status`, `killRecovery`, `pullRequestState`
 * @returns {Promise<{edited: boolean, posted: boolean, skipped: string|null, url: string|null}>}
 */
export async function reportRecoveryAttemptOutcome(context) {
  try {
    return await reportUnsafe(context);
  } catch (error) {
    console.warn(`[session-monitor] Recovery outcome for ${context?.sessionName} was not reported: ${error?.message || error}`);
    return { edited: false, posted: false, skipped: `error: ${error?.message || error}`, url: null };
  }
}

async function reportUnsafe({ pullRequestUrl = null, sessionName, sessionInfo = {}, killReport = {}, exitCode = null, status = null, killRecovery = null, pullRequestState = null, options = {}, verbose = false, persist = () => {} }) {
  const skip = reason => {
    if (verbose) console.log(`[VERBOSE] Recovery outcome of ${sessionName} not added to the kill notice: ${reason} (issue #3435)`);
    return { edited: false, posted: false, skipped: reason, url: null };
  };
  const parent = sessionInfo?.killRecoveryOfSession;
  if (!parent) return skip('not-a-recovery');
  if (sessionInfo.killRecoveryOutcomeReportedAt) return skip('already-reported');
  if (!classifySessionOutcome({ exitCode, status }).failed) return skip('not-failed');
  const reportSkip = killReport?.skippedReason || pullRequestReportSkipReason(pullRequestState);
  if (reportSkip) return skip(reportSkip);

  const runCommand = options.runCommand || undefined;
  const inherited = sessionInfo.killNotice?.sessionName === parent ? sessionInfo.killNotice.url || null : null;
  const targetUrl = pullRequestUrl || startedPullRequestUrl(sessionInfo) || startedIssueUrl(sessionInfo) || null;
  const noticeUrl = inherited || (targetUrl ? await findPendingKillNoticeUrl({ targetUrl, sessionName: parent, runCommand, verbose, pendingOnly: false }) : null);
  if (!noticeUrl && !targetUrl) return skip('no-target');

  // An in-place recovery appends to the parent's log; read only its own part.
  const minByteOffset = recoveryLogStartOffset(sessionInfo);
  // The completion report scanned the log already when the session was killed.
  const scanned = Boolean(killReport?.toolExit) || killReport?.killed === true || killReport?.oomEventOnly === true;
  const toolExit = scanned ? killReport.toolExit || null : await detectToolExitCode(sessionInfo.logPath || null, { readFile: options.readFile || null, minByteOffset, verbose });
  const oomEvidence = killReport?.oomEvidence === true || hasContainerOomEvidence({ sessionInfo });
  const exitLine = describeSessionExitCodes({ exitCode, processLabel: sessionInfo.command || 'solve', toolExit, oomEvidence, cause: killReport?.diagnosis?.cause || null });
  const maxAttempts = Number(killRecovery?.maxAttempts) > 0 ? killRecovery.maxAttempts : resolveSessionKillResumeAttempts({ argv: argvFromSessionArgs(sessionInfo.args), env: options.env || process.env });
  const line = formatRecoveryAttemptOutcome({ attempt: sessionInfo.killRecoveryAttempts || null, maxAttempts, exitLine, killRecovery });

  // Once per recovery session, whatever happens below.
  sessionInfo.killRecoveryOutcomeReportedAt = new Date().toISOString();
  persist();

  const edit = noticeUrl ? await editKillRecoveryNotice({ commentUrl: noticeUrl, transform: body => insertRecoveryOutcome(body, sessionName, line), runCommand, verbose, fileSuffix: 'outcome' }) : { edited: false, changed: false, error: 'kill notice not found' };
  if (edit.edited || (!edit.changed && !edit.error)) {
    if (verbose) console.log(`[VERBOSE] Recovery outcome of ${sessionName} ${edit.edited ? 'added to' : 'already in'} the kill notice ${noticeUrl} (issue #3435)`);
    return { edited: edit.edited, posted: false, skipped: edit.edited ? null : 'already-in-notice', url: noticeUrl };
  }
  console.warn(`[session-monitor] Could not edit the kill notice of ${parent} (${noticeUrl || 'not found'}): ${edit.error}; posting the recovery outcome as a comment (issue #3435)`);
  if (!targetUrl) return { edited: false, posted: false, skipped: edit.error, url: null };
  const body = [killNoticeSessionMarker(parent), recoveryOutcomeMarker(sessionName), line].join('\n');
  const posted = await postKillRecoveryNotice({ pullRequestUrl: targetUrl.replace(/#.*$/, ''), body, runCommand, fileSuffix: `outcome-${String(sessionName).replace(/[^A-Za-z0-9._-]/g, '-')}`, verbose });
  return { edited: false, posted: posted.posted, skipped: posted.posted ? null : posted.error, url: posted.url };
}
