/**
 * Report a survived container OOM event while the work session still runs
 * (issue #2809).
 *
 * An OOM kill inside the container that the work session outlives used to be
 * reported only when the session ended — on GitHub as a "recovered" comment,
 * often hours later and after the pull request was already done. It is reported
 * when it happens instead: one GitHub comment (with the log so far under
 * `--attach-logs`) and one Telegram message, once per session. A merged pull
 * request, or one that is ready to merge, gets no GitHub comment.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2809
 */

import { resolvePullRequestState } from './github-pr-state.lib.mjs';
import { postKillRecoveryNotice } from './session-kill-recovery.lib.mjs';
import { recoveryLogStartOffset } from './session-recovery-footer.lib.mjs';
import { detectToolExitEvidence } from './session-tool-exit.lib.mjs';
import { argsIncludeAttachLogs, defaultAttachLog, pullRequestReportSkipReason, startedIssueUrl, startedPullRequestUrl } from './session-monitor.kill-sections.lib.mjs';
import { getOomEventObservedAt } from './session-monitor.oom.lib.mjs';
import { escapeMarkdown } from './telegram-markdown.lib.mjs';
import { safeSendMessage } from './telegram-safe-reply.lib.mjs';
import { RECOVERY_LIFECYCLE_MARKER } from './tool-comments.lib.mjs';

export const OOM_EVENT_NOTICE_MARKER = '<!-- hive-mind:oom-event-notice -->';
/** Persisted once the event is handled, so a bot restart does not report it again. */
export const OOM_EVENT_REPORTED_FIELD = 'oomEventReportedAt';
/** An event older than this is not news: it was observed before this report existed, or before a long bot outage. */
export const OOM_EVENT_REPORT_MAX_AGE_MS = 15 * 60 * 1000;
/**
 * Wait about one monitor poll before reporting, so solve has time to log its
 * own in-process kill report (`[HIVE-MIND RECOVERY]` "waiting"), which already
 * commented on GitHub: the monitor then does not post a second comment.
 */
export const OOM_EVENT_REPORT_GRACE_MS = 30 * 1000;

const safeName = name => String(name || 'session').replace(/[^A-Za-z0-9._-]/g, '-');

export function oomEventNoticeSessionMarker(sessionName) {
  return `<!-- hive-mind:oom-event-notice:${safeName(sessionName)} -->`;
}

function parseCommentTarget(url) {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(pull|issues)\/(\d+)$/.exec(String(url || '').replace(/#.*$/, ''));
  return match ? { owner: match[1], repo: match[2], kind: match[3], number: Number(match[4]) } : null;
}

/**
 * The GitHub comment body.
 *
 * @param {Object} options
 * @param {string} options.sessionName
 * @param {string|null} options.observedAt - ISO time of the first observation
 * @param {number} [options.count] - OOM kills seen so far
 * @param {boolean} [options.logInline] - The log follows in the same comment
 * @returns {string}
 */
export function buildOomEventNotice({ sessionName, observedAt = null, count = 0, logInline = false } = {}) {
  const kills = Math.max(1, Math.floor(Number(count) || 0));
  return [
    OOM_EVENT_NOTICE_MARKER,
    oomEventNoticeSessionMarker(sessionName),
    '## ⚠️ Container OOM event — the work session keeps running',
    '',
    `The kernel OOM killer ended a process inside the container of working session \`${sessionName}\`${observedAt ? ` at ${observedAt}` : ''}. The work session itself is still running, so this is a warning, not a stop.`,
    '',
    `- OOM kills so far: ${kills}`,
    `- If the session later fails or is killed, that is reported in a separate comment.${logInline ? ' The working-session log up to this moment is below.' : ''}`,
    '',
    '<sub>Reported by Hive Mind</sub>',
    // A tool comment, so a running solve never reads it as reviewer feedback.
    RECOVERY_LIFECYCLE_MARKER,
  ].join('\n');
}

/** The Telegram message (Markdown). */
export function buildOomEventTelegramMessage({ sessionName, observedAt = null, count = 0, githubUrl = null, githubSkipped = null } = {}) {
  const kills = Math.floor(Number(count) || 0);
  const lines = [`⚠️ *Container OOM event* in working session \`${sessionName}\`${kills > 1 ? ` (${kills} OOM kills)` : ''}: the kernel OOM killer ended a process inside the container${observedAt ? ` at ${escapeMarkdown(String(observedAt))}` : ''}. The work session keeps running.`];
  if (githubUrl) lines.push(`Reported on GitHub: ${escapeMarkdown(String(githubUrl))}`);
  else if (githubSkipped === 'pull-request-merged') lines.push('No GitHub comment: the pull request is merged.');
  else if (githubSkipped === 'pull-request-ready-to-merge') lines.push('No GitHub comment: the pull request is ready to merge.');
  else if (githubSkipped === 'pull-request-closed') lines.push('No GitHub comment: the pull request is closed.');
  else if (githubSkipped === 'reported-in-process') lines.push('No extra GitHub comment: the working session already reported the killed process.');
  return lines.join('\n');
}

/**
 * Report the survived OOM event once. Never throws.
 *
 * @param {Object} context
 * @param {Object} [context.bot] - Telegraf bot (Telegram is skipped without one)
 * @param {string} context.sessionName
 * @param {Object} context.sessionInfo - Mutable, persisted session info
 * @param {Object} [context.options] - Monitor options: `runCommand`, `attachLog`, `lookupPullRequestState`, `lookupPullRequestCommentBodies`, `readFile`, `now`, `oomEventReportGraceMs`
 * @param {Function} [context.persist] - Mirror sessionInfo to disk
 * @param {Function} [context.lookupPullRequest] - async () => linked pull request URL
 * @returns {Promise<{reported: boolean, skipped: string|null, github: boolean, githubUrl: string|null, githubSkipped: string|null, telegram: boolean}>}
 */
export async function reportSurvivedOomEvent(context) {
  try {
    return await reportUnsafe(context);
  } catch (error) {
    console.warn(`[session-monitor] OOM event of ${context?.sessionName} was not reported: ${error?.message || error}`);
    return { reported: false, skipped: `error: ${error?.message || error}`, github: false, githubUrl: null, githubSkipped: null, telegram: false };
  }
}

async function reportUnsafe({ bot = null, sessionName, sessionInfo, options = {}, verbose = false, persist = () => {}, lookupPullRequest = null }) {
  const result = { reported: false, skipped: null, github: false, githubUrl: null, githubSkipped: null, telegram: false };
  const observedAt = getOomEventObservedAt(sessionInfo);
  if (!observedAt) return { ...result, skipped: 'no-oom-event' };
  if (sessionInfo[OOM_EVENT_REPORTED_FIELD]) return { ...result, skipped: 'already-reported' };

  const now = typeof options.now === 'function' ? options.now() : Date.now();
  const ageMs = now - new Date(observedAt).getTime();
  const graceMs = Number.isFinite(options.oomEventReportGraceMs) ? options.oomEventReportGraceMs : OOM_EVENT_REPORT_GRACE_MS;
  if (Number.isFinite(ageMs) && ageMs < graceMs) return { ...result, skipped: 'grace' };
  // Once per session, whatever happens below: no retry floods the pull request.
  sessionInfo[OOM_EVENT_REPORTED_FIELD] = new Date(now).toISOString();
  persist();
  if (Number.isFinite(ageMs) && ageMs > OOM_EVENT_REPORT_MAX_AGE_MS) {
    if (verbose) console.log(`[VERBOSE] Session ${sessionName}: the OOM event observed at ${observedAt} is ${Math.round(ageMs / 60000)} min old; not reported now (issue #2809)`);
    return { ...result, skipped: 'stale' };
  }

  const count = Number(sessionInfo.oomEventCount) || 1;
  let linked = null;
  if (!startedPullRequestUrl(sessionInfo) && !sessionInfo.resolvedPullRequestUrl && typeof lookupPullRequest === 'function') {
    try {
      linked = await lookupPullRequest();
    } catch (error) {
      if (verbose) console.log(`[VERBOSE] Pull request lookup for the OOM event of ${sessionName} failed: ${error?.message || error}`);
    }
  }
  const pullRequestUrl = startedPullRequestUrl(sessionInfo) || sessionInfo.resolvedPullRequestUrl || linked || null;
  const targetUrl = pullRequestUrl || startedIssueUrl(sessionInfo);
  const pullRequestState = pullRequestUrl ? await resolvePullRequestState(pullRequestUrl, { lookupPullRequestState: options.lookupPullRequestState, lookupCommentBodies: options.lookupPullRequestCommentBodies, verbose }) : null;
  result.githubSkipped = targetUrl ? pullRequestReportSkipReason(pullRequestState) : 'no-target';
  // Side risk of issue #3435: solve already commented on the kill of its AI tool.
  if (!result.githubSkipped && sessionInfo.logPath) {
    const { inProcessKillReport } = await detectToolExitEvidence(sessionInfo.logPath, { readFile: options.readFile, minByteOffset: recoveryLogStartOffset(sessionInfo), verbose });
    if (inProcessKillReport) result.githubSkipped = 'reported-in-process';
  }

  if (!result.githubSkipped) {
    const posted = await postOomEventNotice({ targetUrl, sessionName, sessionInfo, observedAt, count, options, verbose });
    result.github = posted.posted === true;
    result.githubUrl = posted.url;
    if (!posted.posted) result.githubSkipped = posted.error || 'not-posted';
  }
  if (verbose) console.log(`[VERBOSE] Session ${sessionName}: OOM event (${count} OOM kills) ${result.github ? `reported on ${result.githubUrl || 'GitHub (comment id unknown)'}` : `not reported on GitHub (${result.githubSkipped})`} (issue #2809)`);

  if (bot?.telegram && sessionInfo.chatId) {
    try {
      const message = buildOomEventTelegramMessage({ sessionName, observedAt, count, githubUrl: result.githubUrl, githubSkipped: result.githubSkipped });
      const sendOptions = { parse_mode: 'Markdown', locale: sessionInfo.locale, verbose };
      if (sessionInfo.messageId) sendOptions.reply_to_message_id = sessionInfo.messageId;
      if (sessionInfo.messageThreadId !== null && sessionInfo.messageThreadId !== undefined) sendOptions.message_thread_id = sessionInfo.messageThreadId;
      await safeSendMessage(bot.telegram, sessionInfo.chatId, message, sendOptions);
      result.telegram = true;
    } catch (error) {
      console.warn(`[session-monitor] Telegram OOM event message for ${sessionName} failed: ${error?.message || error}`);
    }
  }
  result.reported = result.github || result.telegram;
  return result;
}

async function postOomEventNotice({ targetUrl, sessionName, sessionInfo, observedAt, count, options, verbose }) {
  const target = parseCommentTarget(targetUrl);
  const attachLog = options.attachLog || defaultAttachLog;
  const logPath = sessionInfo.logPath || null;
  if (argsIncludeAttachLogs(sessionInfo.args) && logPath && target && typeof attachLog === 'function') {
    let commentId = null;
    try {
      const ok = await attachLog({ ...(options.attachOptions || {}), logFile: logPath, targetType: target.kind === 'pull' ? 'pr' : 'issue', targetNumber: target.number, owner: target.owner, repo: target.repo, customTitle: '📎 Working-session log (at the OOM event)', leadingSection: buildOomEventNotice({ sessionName, observedAt, count, logInline: true }), onCommentPosted: posted => (commentId = posted?.commentId || null), verbose });
      if (ok !== false) return { posted: true, url: commentId ? `https://github.com/${target.owner}/${target.repo}/${target.kind}/${target.number}#issuecomment-${commentId}` : null, error: null };
    } catch (error) {
      console.warn(`[session-monitor] OOM event notice with log for ${sessionName} failed: ${error?.message || error}`);
    }
  }
  return postKillRecoveryNotice({ pullRequestUrl: String(targetUrl).replace(/#.*$/, ''), body: buildOomEventNotice({ sessionName, observedAt, count }), runCommand: options.runCommand || undefined, fileSuffix: `oom-event-${safeName(sessionName)}`, verbose });
}
