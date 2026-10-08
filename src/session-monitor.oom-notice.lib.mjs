/**
 * Report a container OOM event on the pull request WHEN it happens (issue #2809).
 *
 * Docker's `State.OOMKilled` is a sticky container flag: the kernel sets it when
 * any process in the container cgroup is OOM-killed, and the work session often
 * survives (issue #2134). The monitor noticed the event the moment `$ --status`
 * first carried it, but only *remembered* it (`oomEventObservedAt`) and reported
 * it when the session ended. In koz-3 PR #15 the event was observed at 11:13 and
 * the pull request learned about it at 15:11 — one second after solve had posted
 * "✅ Ready to merge" — as a post-factum "Work session completed — an earlier
 * container OOM event did not stop it" comment.
 *
 * The issue's rule: an OOM is reported on the pull request only at the moment it
 * happens, plus the recovery from it. This module posts that "moment" comment
 * while the session is still running:
 *
 *   - once per session, with the intermediate log uploaded first when
 *     `--attach-logs` is enabled;
 *   - edited in place (never re-posted) when the live count of OOM-killed
 *     processes grows, at most once per {@link OOM_NOTICE_UPDATE_INTERVAL_MS};
 *   - never after the session has finished — a completed run gets its OOM
 *     summary on Telegram only (see `buildKillCompletionSections`).
 *
 * If the event does stop the session, the completion path posts the separate
 * kill / restart comment, exactly as for any other killed session.
 *
 * Best effort: a failed publication is retried on the next monitor tick and an
 * error never changes how the session is tracked.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2809
 */

import { getOomEventObservedAt } from './session-monitor.oom.lib.mjs';
import { argsIncludeAttachLogs, defaultAttachLog, startedPullRequestUrl } from './session-monitor.kill-sections.lib.mjs';
import { attachIntermediateSessionLog, postKillRecoveryNotice } from './session-kill-recovery.lib.mjs';
import { OOM_EVENT_NOTICE_MARKER } from './tool-comments.lib.mjs';

/** Minimum time between edits of the notice, and between pull request lookups. */
export const OOM_NOTICE_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

/** Persisted session fields owned by this module. */
export const OOM_NOTICE_FIELD = 'oomEventNotice';
export const OOM_KILL_COUNT_FIELD = 'oomKillCount';

function positiveCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

/**
 * Remember the highest number of OOM-killed processes reported for this
 * session's container (`$ --status` → `cgroupMemory.oomKills`). The counter is
 * cumulative, so the maximum is the total; it survives a bot restart and the
 * container's removal, which is when the completion report needs it.
 *
 * @param {Object} sessionInfo - Mutable persisted session info
 * @param {Object|null} statusResult - Parsed `$ --status` payload
 * @returns {boolean} True when the stored count grew
 */
export function recordOomKillCount(sessionInfo, statusResult) {
  if (!sessionInfo) return false;
  const live = positiveCount(statusResult?.cgroupMemory?.oomKills);
  if (live <= positiveCount(sessionInfo[OOM_KILL_COUNT_FIELD])) return false;
  sessionInfo[OOM_KILL_COUNT_FIELD] = live;
  return true;
}

/**
 * @param {Object} sessionInfo
 * @returns {number} Recorded number of OOM-killed processes (0 when unknown)
 */
export function getOomKillCount(sessionInfo) {
  return positiveCount(sessionInfo?.[OOM_KILL_COUNT_FIELD]);
}

/**
 * Render the pull-request comment for an OOM event in a running session.
 *
 * @param {Object} options
 * @param {string|null} options.observedAt - ISO time the event was first observed
 * @param {string|null} [options.sessionName]
 * @param {number} [options.count] - OOM-killed processes so far (shown when > 1)
 * @param {string|null} [options.updatedAt] - Set when the comment is edited
 * @param {boolean} [options.attachLogs] - Whether --attach-logs is enabled
 * @param {boolean} [options.logAttached] - The intermediate log was uploaded
 * @returns {string} Markdown body
 */
export function buildOomEventNotice({ observedAt = null, sessionName = null, count = 0, updatedAt = null, attachLogs = false, logAttached = false } = {}) {
  const lines = [OOM_EVENT_NOTICE_MARKER, '## ⚠️ Container OOM event — the work session is still running', ''];
  lines.push('The kernel OOM killer stopped a process inside this working session’s container. The work session itself was still running when this was reported.', '');
  const facts = [];
  if (observedAt) facts.push(`- **OOM event observed at:** ${observedAt}`);
  if (count > 1) facts.push(`- **Processes killed by the OOM killer so far:** ${count}`);
  if (updatedAt) facts.push(`- **Updated:** ${updatedAt}`);
  if (sessionName) facts.push(`- **Working session:** \`${sessionName}\``);
  if (facts.length > 0) lines.push(...facts, '');
  if (logAttached) lines.push('📎 The working-session log at the time of the event was uploaded as a separate comment.', '');
  else if (!attachLogs) lines.push('_The working-session log was not uploaded because `--attach-logs` is disabled._', '');
  lines.push('If this event stops the work session, a separate comment will report it together with any restart.', '');
  lines.push('<sub>Reported by Hive Mind</sub>');
  return lines.join('\n');
}

/**
 * Post (or update) the in-run OOM notice for a session that is still running.
 *
 * @param {Object} options
 * @param {string} options.sessionName
 * @param {Object} options.sessionInfo - Mutable persisted session info
 * @param {Object|null} [options.statusResult] - Parsed `$ --status` payload of this tick
 * @param {Object} [options.options] - Monitor options (`runCommand`, `attachLog`, `oomNoticeNow`)
 * @param {Function|null} [options.lookupPullRequest] - Resolves the linked pull request URL
 * @param {Function} [options.persist] - Mirrors sessionInfo to disk
 * @param {Function} [options.logEvent] - Durable bot event log
 * @param {boolean} [options.verbose]
 * @returns {Promise<{action: string, url?: string|null, count?: number}>}
 */
export async function announceOomEventWhileRunning({ sessionName, sessionInfo, statusResult = null, options = {}, lookupPullRequest = null, persist = () => {}, logEvent = () => {}, verbose = false } = {}) {
  const say = message => verbose && console.log(`[VERBOSE] Session ${sessionName} OOM notice: ${message}`);
  try {
    if (!sessionInfo) return { action: 'skipped', reason: 'no-session' };
    const countGrew = recordOomKillCount(sessionInfo, statusResult);
    const observedAt = getOomEventObservedAt(sessionInfo);
    if (!observedAt) {
      if (countGrew) persist();
      return { action: 'skipped', reason: 'no-oom-event' };
    }
    const now = typeof options.oomNoticeNow === 'function' ? options.oomNoticeNow() : Date.now();
    const count = getOomKillCount(sessionInfo);
    const state = sessionInfo[OOM_NOTICE_FIELD] || {};
    sessionInfo[OOM_NOTICE_FIELD] = state;

    if (state.postedAt) {
      // Already reported: only a higher count is worth an edit, and not on every
      // poll. A comment whose URL `gh` did not print cannot be edited at all.
      const due = !state.updatedMs || now - state.updatedMs >= OOM_NOTICE_UPDATE_INTERVAL_MS;
      if (!state.commentUrl || count <= (state.count || 0) || !due) {
        if (countGrew) persist();
        return { action: 'unchanged', url: state.commentUrl, count };
      }
    }

    let pullRequestUrl = sessionInfo.resolvedPullRequestUrl || startedPullRequestUrl(sessionInfo);
    if (!pullRequestUrl && typeof lookupPullRequest === 'function' && (!state.lookupMs || now - state.lookupMs >= OOM_NOTICE_UPDATE_INTERVAL_MS)) {
      state.lookupMs = now;
      pullRequestUrl = await lookupPullRequest().catch(() => null);
      if (pullRequestUrl) sessionInfo.resolvedPullRequestUrl = pullRequestUrl;
    }
    if (!pullRequestUrl) {
      say('no pull request is known yet; will retry while the session runs');
      persist();
      return { action: 'skipped', reason: 'no-pull-request' };
    }

    const attachLogs = argsIncludeAttachLogs(sessionInfo.args);
    // One upload per event, even when posting the comment has to be retried.
    if (!state.postedAt && attachLogs && !state.logUploadAttempted) {
      state.logUploadAttempted = true;
      const upload = await attachIntermediateSessionLog({
        attachLogs,
        logPath: statusResult?.logPath || sessionInfo.logPath || null,
        pullRequestUrl,
        attachLog: options.attachLog || defaultAttachLog,
        customTitle: '📎 Working-session log at the container OOM event',
        verbose,
      });
      state.logAttached = Boolean(upload.uploaded);
    }

    const editing = Boolean(state.postedAt);
    const body = buildOomEventNotice({ observedAt, sessionName, count, updatedAt: editing ? new Date(now).toISOString() : null, attachLogs, logAttached: state.logAttached === true });
    const posted = await postKillRecoveryNotice({
      pullRequestUrl,
      commentUrl: state.commentUrl || null,
      body,
      runCommand: options.runCommand || undefined,
      fileSuffix: `oom-${String(sessionName || 'session').replace(/[^A-Za-z0-9._-]/g, '-')}`,
      verbose,
    });
    if (!posted.posted) {
      say(`publication failed (${posted.error || 'unknown error'}); will retry on the next poll`);
      persist();
      return { action: 'failed', reason: posted.error || null };
    }
    if (posted.url) state.commentUrl = posted.url;
    state.count = count;
    state.updatedMs = now;
    if (!editing) state.postedAt = new Date(now).toISOString();
    persist();
    say(`${editing ? 'updated' : 'posted'} on ${pullRequestUrl} (observed at ${observedAt}, OOM kills: ${count || 'unknown'})`);
    logEvent('session_oom_event_notice', { sessionName, action: editing ? 'updated' : 'posted', pullRequestUrl, commentUrl: state.commentUrl || null, observedAt, oomKills: count || null, logAttached: state.logAttached === true });
    return { action: editing ? 'updated' : 'posted', url: state.commentUrl || null, count };
  } catch (error) {
    console.warn(`[session-monitor] OOM event notice failed for ${sessionName}: ${error?.message || error}`);
    return { action: 'failed', reason: error?.message || String(error) };
  }
}
