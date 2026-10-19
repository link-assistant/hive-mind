/**
 * Completion-time reporting for killed and recovered work sessions (issue #2134).
 *
 * Glue between the pieces that do the actual work — kill diagnostics, the
 * on-kill policy, and the pull-request notice — so `session-monitor.lib.mjs`
 * (already at its `max-lines` budget) gains one call instead of a hundred lines.
 *
 * Two situations are reported, and the Telegram message and the pull request are
 * always given the SAME facts, which is the core complaint in the issue:
 *
 *   - The session was killed → say exactly why (out of memory / disk full /
 *     forced kill) with the evidence behind that verdict.
 *   - The session survived a kill event → warn "recovered from out of memory" /
 *     "recovered from forced kill" instead of reading as a plain success.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2134
 */

import fs from 'fs/promises';
import { classifySessionOutcome } from './work-session-formatting.lib.mjs';
import { buildKillDiagnosticsSection, formatKillDiagnosticsSection, formatKillRecoverySection, KILL_CAUSE_FORCED_KILL, KILL_CAUSE_HOST_REBOOT, KILL_CAUSE_OUT_OF_MEMORY } from './session-kill-diagnostics.lib.mjs';
import { getOomEventObservedAt } from './session-monitor.oom.lib.mjs';
import { resolveOnSessionKillPolicy } from './session-kill-policy.lib.mjs';
import { describeObservedHostDisk } from './session-monitor.host-disk.lib.mjs';
import { detectDeliberateSolveStop } from './session-kill-attribution.lib.mjs';
import { buildKillRecoveryNotice, postKillRecoveryNotice, spawnCapture } from './session-kill-recovery.lib.mjs';
import { getSessionIssueContext } from './session-live-pr-link.lib.mjs';
import { describeHostRebootScope } from './host-boot-state.lib.mjs';
import { recoveryLogStartOffset } from './session-recovery-footer.lib.mjs';

/**
 * `--attach-logs` as it reaches the bot: a raw CLI argument array recorded on
 * the tracked session (see telegram-isolation.lib.mjs `args`).
 *
 * @param {string[]|null} args
 * @returns {boolean}
 */
export function argsIncludeAttachLogs(args) {
  if (!Array.isArray(args)) return false;
  return args.some(arg => {
    const value = String(arg || '').trim();
    return value === '--attach-logs' || value.startsWith('--attach-logs=');
  });
}

/** Turn a recorded CLI argument array into a minimal argv-like object. */
export function argvFromSessionArgs(args) {
  const argv = {};
  if (!Array.isArray(args)) return argv;
  for (let i = 0; i < args.length; i++) {
    const raw = String(args[i] || '');
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq > -1) {
      argv[raw.slice(2, eq)] = raw.slice(eq + 1);
      continue;
    }
    const next = args[i + 1];
    if (next !== undefined && !String(next).startsWith('--')) {
      argv[raw.slice(2)] = String(next);
      i++;
    } else {
      argv[raw.slice(2)] = true;
    }
  }
  return argv;
}

/**
 * The pull request a session was started on (`solve <pull request URL>`), or null.
 * Such a session has no *linked* pull request to look up.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2301
 * @see https://github.com/link-assistant/hive-mind/issues/2498
 */
export function startedPullRequestUrl(sessionInfo) {
  const started = sessionInfo?.urlContext;
  return started?.type === 'pull' && started.owner && started.repo && started.number ? `https://github.com/${started.owner}/${started.repo}/pull/${started.number}` : null;
}

/**
 * Whether the session carries container OOM evidence: the event the monitor
 * remembered while it ran, or the (sticky) flag in the final status.
 *
 * @param {Object} options
 * @param {Object} [options.sessionInfo]
 * @param {Object|null} [options.statusResult]
 * @returns {boolean}
 */
export function hasContainerOomEvidence({ sessionInfo = null, statusResult = null } = {}) {
  return Boolean(getOomEventObservedAt(sessionInfo)) || statusResult?.oomKilled === true;
}

/**
 * Build the kill/recovery sections for a completed session.
 *
 * Never throws: a failed diagnosis must never block a completion notification.
 *
 * @param {Object} options
 * @param {string} options.sessionName
 * @param {Object} options.sessionInfo
 * @param {Object|null} [options.statusResult]
 * @param {number|null} [options.exitCode]
 * @param {string|null} [options.status]
 * @param {{merged: boolean, mergedAt: string|null}|null} [options.pullRequestState] - Issue #2498: a merged pull request ends the work
 * @param {boolean} [options.verbose]
 * @param {Function} [options.readFile]
 * @param {Object} [options.env]
 * @returns {Promise<{sections: string[], diagnosis: Object|null, killed: boolean, recovered: boolean, oomEventOnly: boolean, deliberateStop: Object|null, policy: string|null, observedAt: string|null, skippedReason: string|null}>}
 */
export async function buildKillCompletionSections({ sessionName, sessionInfo, statusResult = null, exitCode = null, status = null, pullRequestState = null, verbose = false, readFile = fs.readFile, statFile = fs.stat, env = process.env } = {}) {
  const empty = { sections: [], diagnosis: null, killed: false, recovered: false, oomEventOnly: false, deliberateStop: null, policy: null, observedAt: null, endedAt: null, skippedReason: null };
  try {
    const outcome = classifySessionOutcome({ exitCode, status });
    const observedAt = getOomEventObservedAt(sessionInfo);
    const killed = outcome.killed === true;
    const recovered = !outcome.failed && Boolean(observedAt);
    const oomEventOnly = outcome.failed && !killed && Boolean(observedAt);
    if (!killed && !recovered && !oomEventOnly) return empty;
    // Issue #2498 (package-registry-manager#31): the session auto-merged its
    // pull request and exited 0, yet the sticky OOM flag produced "Working
    // session recovered from out of memory" after the merge. A merged pull
    // request means the work is fully done: nothing is recovered and no kill,
    // recovery or OOM notice is shown on either surface.
    if (pullRequestState?.merged === true || Boolean(pullRequestState?.mergedAt)) {
      if (verbose) console.log(`[VERBOSE] Session ${sessionName}: pull request merged at ${pullRequestState.mergedAt || 'unknown time'}; skipping kill/OOM reporting and recovery (exit=${exitCode}, killed=${killed}, oomEventObservedAt=${observedAt || 'none'})`);
      return { ...empty, observedAt, skippedReason: 'pull-request-merged' };
    }

    const locale = sessionInfo?.locale || null;
    const logPath = statusResult?.logPath || sessionInfo?.logPath || null;
    const minByteOffset = recoveryLogStartOffset(sessionInfo);
    // Issue #3533: a host reboot ends every running task; the readings are aged against the real end.
    const hostReboot = sessionInfo?.hostReboot || null;
    const endedAt = killed || oomEventOnly ? await resolveSessionEndedAt({ sessionInfo, statusResult, logPath, statFile }) : null;
    const { section, diagnosis } = await buildKillDiagnosticsSection(logPath, {
      verbose,
      readFile,
      minByteOffset,
      oomKilled: statusResult?.oomKilled === true || recovered,
      exitCode,
      stopRequestedByUser: sessionInfo?.stopRequestedByUser === true,
      locale,
      // start-command 0.33.0 scans the log tail for fatal markers when the
      // command exits and reports what it found (link-foundation/start#164,
      // #165 — both filed from this issue). Pass it through: `$` saw the exit
      // live, so it can carry evidence our bounded re-read of a huge log may
      // have missed. Absent on an older `$`, which is why the local scan stays.
      reportedMemoryExhausted: statusResult?.memoryExhausted ?? null,
      reportedMemoryExhaustedReason: statusResult?.memoryExhaustedReason ?? null,
      reportedExitReason: statusResult?.exitReason ?? null,
      reportedCgroupMemory: statusResult?.cgroupMemory ?? null,
      // Issue #2303: the lowest host disk reading taken while the session ran,
      // and why its reported exit 0 was not trusted.
      observedDisk: describeObservedHostDisk(sessionInfo),
      unobservedExit: statusResult?.unobservedExit ?? null,
      statusQueryFailure: statusResult?.statusQueryFailure ?? null,
      hostReboot,
      endedAt,
    });

    const argv = argvFromSessionArgs(sessionInfo?.args);
    const policy = resolveOnSessionKillPolicy({ argv, env, sessionInfo, verbose });

    // Issue #2408: an OOM event earlier in the run does not make every later
    // failure an OOM casualty — solve may have stopped on purpose. A SIGKILL
    // after that verdict (e.g. while the final log upload runs) ends a run that
    // was already over, so a kill is checked too.
    const deliberateStop = oomEventOnly || killed ? await detectDeliberateSolveStop(logPath, { readFile: readFile === fs.readFile ? null : readFile, verbose, minByteOffset }) : null;

    const sections = [];
    if (recovered) {
      // The session outlived the event — this is the warning the issue asks for.
      sections.push(formatKillRecoverySection({ cause: diagnosis?.cause || KILL_CAUSE_OUT_OF_MEMORY, observedAt, locale }));
    }
    if (killed && diagnosis?.cause === KILL_CAUSE_HOST_REBOOT) sections.push(`🖥️ ${describeHostRebootScope(hostReboot)}`);
    if (oomEventOnly) sections.push(`⚠️ A container OOM event affected a child process at ${observedAt}; the work process continued and later failed with exit code ${exitCode}.`);
    if (deliberateStop && killed) sections.push(`ℹ️ solve had already stopped on its own ("${deliberateStop.line}") before the process was killed, so it is not restarted automatically.`);
    else if (deliberateStop) sections.push(`ℹ️ The work did not fail because of it: solve stopped on its own ("${deliberateStop.line}"), so it is not restarted automatically.`);
    // Issue #2498: the diagnostics must not then call the OOM event the "Cause".
    if (section) sections.push(deliberateStop && oomEventOnly ? formatKillDiagnosticsSection(diagnosis, { locale, notTheCause: true }) : section);

    if (verbose) {
      console.log(`[VERBOSE] Session ${sessionName} kill reporting: killed=${killed} recovered=${recovered} oomEventOnly=${oomEventOnly} deliberateStop=${deliberateStop?.reason || 'none'} cause=${diagnosis?.cause || 'n/a'} policy=${policy} endedAt=${endedAt || 'unknown'} oomEventObservedAt=${observedAt || 'none'} hostReboot=${hostReboot ? `${hostReboot.detectedBy}/${hostReboot.affectedSessions}` : 'none'}`);
    }
    return { sections: sections.filter(Boolean), diagnosis, killed, recovered, oomEventOnly, deliberateStop, policy, observedAt, endedAt };
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] Could not build kill sections for ${sessionName}: ${error?.message || error}`);
    }
    return empty;
  }
}

/**
 * Default log uploader: `attachLogToGitHub` with the dependencies the bot does
 * not otherwise carry (`$`, `log`, `sanitizeLogContent`). Imported lazily so the
 * monitor keeps starting on machines where the heavy GitHub helpers are unused.
 *
 * @param {Object} options - attachLogToGitHub options
 * @returns {Promise<boolean>}
 */
export async function defaultAttachLog(options) {
  if (typeof globalThis.use === 'undefined') {
    const { ensureUseM } = await import('./use-m-bootstrap.lib.mjs');
    await ensureUseM();
  }
  const [{ attachLogToGitHub }, { sanitizeLogContent }] = await Promise.all([import('./github.lib.mjs'), import('./token-sanitization.lib.mjs')]);
  const { $ } = await globalThis.use('command-stream');
  return attachLogToGitHub({
    $,
    log: async message => console.log(message),
    sanitizeLogContent,
    ...options,
  });
}

/**
 * Issue #2630: a session started from an issue that has no pull request yet is
 * reported on that issue (issue #3469: for `/fix`, on the issue it created).
 *
 * @param {Object} sessionInfo
 * @returns {string|null}
 */
export function startedIssueUrl(sessionInfo) {
  const issue = getSessionIssueContext(sessionInfo);
  return issue ? `https://github.com/${issue.owner}/${issue.repo}/issues/${issue.number}` : null;
}

function parseCommentTarget(url) {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(pull|issues)\/(\d+)$/.exec(String(url || ''));
  return match ? { owner: match[1], repo: match[2], kind: match[3], number: Number(match[4]) } : null;
}

/**
 * Issue #3533: when the session actually ended — never the time of an earlier
 * OOM event it survived. A host reboot knows it (the last log write before the
 * outage, else the last heartbeat); otherwise `$ --status` reports the end, and
 * the log's last write is the fallback.
 *
 * @param {Object} options
 * @returns {Promise<string|null>} ISO timestamp
 */
export async function resolveSessionEndedAt({ sessionInfo = null, statusResult = null, logPath = null, statFile = fs.stat } = {}) {
  if (sessionInfo?.hostReboot?.sessionEndedAt) return sessionInfo.hostReboot.sessionEndedAt;
  const reported = statusResult?.endTime ? new Date(statusResult.endTime) : null;
  if (reported && Number.isFinite(reported.getTime())) return reported.toISOString();
  if (!logPath) return null;
  try {
    const { mtimeMs } = await statFile(logPath);
    return Number.isFinite(mtimeMs) ? new Date(mtimeMs).toISOString() : null;
  } catch {
    return null;
  }
}

/**
 * Post the same kill/recovery report to the pull request, so a reader of the PR
 * is never left believing an unattended session simply carried on.
 *
 * Issue #3530: this is ONE comment per kill. With `--attach-logs` the notice is
 * the leading section of the log comment (it used to be a separate "📎
 * Intermediate working-session log (killed session)" comment plus the notice).
 * When a recovery is about to be attempted the notice is posted first, with a
 * "recovery is pending" note that {@link settleKillRecoveryNotice} later edits.
 *
 * @param {Object} options
 * @returns {Promise<{posted: boolean, url: string|null, skipped: string|null, logUploaded: boolean}>}
 */
export async function announceKillOnPullRequest({ pullRequestUrl, sessionName, sessionInfo, diagnosis, exitCode = null, observedAt = null, endedAt = null, policy = null, recovered = false, oomEventOnly = false, deliberateStop = null, resumed = false, recoverySessionId = null, attempt = null, maxAttempts = null, resumeCommand = null, recoveryPending = false, runCommand = spawnCapture, attachLog = defaultAttachLog, attachOptions = {}, verbose = false } = {}) {
  const skip = reason => ({ posted: false, url: null, skipped: reason, logUploaded: false });
  // Issue #2301: a session started on a pull request URL has no *linked* pull
  // request to look up — the pull request is the one it was started on.
  pullRequestUrl = pullRequestUrl || startedPullRequestUrl(sessionInfo) || (recoveryPending ? startedIssueUrl(sessionInfo) : null);
  if (!pullRequestUrl) return skip('no-pull-request');
  if (typeof runCommand !== 'function') return skip('no-command-runner');

  const attachLogs = argsIncludeAttachLogs(sessionInfo?.args);
  const logPath = sessionInfo?.logPath || null;
  const notice = fields => buildKillRecoveryNotice({ diagnosis, exitCode, sessionName, observedAt, endedAt, hostReboot: sessionInfo?.hostReboot || null, policy, survived: recovered, oomEventOnly, deliberateStop, resumed, recoverySessionId, attempt, maxAttempts, resumeCommand, attachLogs, recoveryPending, ...fields });

  // Issue #2498: a session that completed (`recovered`) already published its
  // own final log under `--attach-logs`; a second copy titled "killed session"
  // duplicated it and called a finished run killed.
  const target = parseCommentTarget(pullRequestUrl);
  let logUploadFailed = false;
  if (attachLogs && !recovered && logPath && typeof attachLog === 'function' && target) {
    let commentId = null;
    let ok = false;
    try {
      ok = await attachLog({ ...attachOptions, logFile: logPath, targetType: target.kind === 'pull' ? 'pr' : 'issue', targetNumber: target.number, owner: target.owner, repo: target.repo, customTitle: '📎 Working-session log (killed session)', leadingSection: notice({ logInline: true }), onCommentPosted: posted => (commentId = posted?.commentId || null), verbose });
    } catch (error) {
      console.warn(`[session-monitor] Kill notice with log for ${sessionName} failed: ${error?.message || error}`);
    }
    if (ok !== false) {
      const url = commentId ? `https://github.com/${target.owner}/${target.repo}/${target.kind}/${target.number}#issuecomment-${commentId}` : null;
      if (verbose) console.log(`[VERBOSE] Kill notice for ${sessionName} posted together with its log${url ? ` (${url})` : ''} (issue #3530)`);
      return { posted: true, url, skipped: null, logUploaded: true };
    }
    logUploadFailed = true;
  } else if (verbose && attachLogs) {
    console.log(`[VERBOSE] Kill notice for ${sessionName} is posted without a log: ${recovered ? 'the session published its own log' : !logPath ? 'no log path' : 'no uploader'}`);
  }

  const result = await postKillRecoveryNotice({
    pullRequestUrl,
    body: notice({ logAttached: false, attachLogs: attachLogs && !logUploadFailed }),
    runCommand,
    fileSuffix: String(sessionName || 'session').replace(/[^A-Za-z0-9._-]/g, '-'),
    verbose,
  });

  return { posted: result.posted, url: result.url, skipped: result.posted ? null : result.error, logUploaded: false };
}

export { KILL_CAUSE_FORCED_KILL, KILL_CAUSE_OUT_OF_MEMORY };
