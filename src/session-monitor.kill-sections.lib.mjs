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
import { buildKillDiagnosticsSection, formatKillDiagnosticsSection, formatKillRecoverySection, KILL_CAUSE_FORCED_KILL, KILL_CAUSE_OUT_OF_MEMORY } from './session-kill-diagnostics.lib.mjs';
import { getOomEventObservedAt } from './session-monitor.oom.lib.mjs';
import { resolveOnSessionKillPolicy } from './session-kill-policy.lib.mjs';
import { detectDeliberateSolveStop, detectKilledAiTool } from './session-kill-attribution.lib.mjs';
import { buildKillRecoveryNotice, postKillRecoveryNotice, attachIntermediateSessionLog, spawnCapture } from './session-kill-recovery.lib.mjs';

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
export async function buildKillCompletionSections({ sessionName, sessionInfo, statusResult = null, exitCode = null, status = null, pullRequestState = null, verbose = false, readFile = fs.readFile, env = process.env } = {}) {
  const empty = { sections: [], diagnosis: null, killed: false, recovered: false, oomEventOnly: false, killedTool: null, deliberateStop: null, policy: null, observedAt: null, skippedReason: null };
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
    const minByteOffset = sessionInfo?.killRecoveryInPlace ? sessionInfo.killRecoveryLogStartBytes || 0 : 0;
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
    // Issue #2803: the "child process" may be the AI tool itself — say so.
    const killedTool = oomEventOnly ? await detectKilledAiTool(logPath, { readFile: readFile === fs.readFile ? null : readFile, verbose, minByteOffset }) : null;
    if (killedTool) sections.push(`⚠️ A container OOM event hit this session at ${observedAt}: the AI tool (${killedTool.tool}) was killed with SIGKILL (exit code 137), most likely by the OOM killer, and solve then exited with code ${exitCode}.`);
    else if (oomEventOnly) sections.push(`⚠️ A container OOM event affected a child process at ${observedAt}; the work process continued and later failed with exit code ${exitCode}.`);
    if (deliberateStop && killed) sections.push(`ℹ️ solve had already stopped on its own ("${deliberateStop.line}") before the process was killed, so it is not restarted automatically.`);
    else if (deliberateStop) sections.push(`ℹ️ The work did not fail because of it: solve stopped on its own ("${deliberateStop.line}"), so it is not restarted automatically.`);
    // Issue #2498: the diagnostics must not then call the OOM event the "Cause".
    if (section) sections.push(deliberateStop && oomEventOnly ? formatKillDiagnosticsSection(diagnosis, { locale, notTheCause: true }) : section);

    if (verbose) {
      console.log(`[VERBOSE] Session ${sessionName} kill reporting: killed=${killed} recovered=${recovered} oomEventOnly=${oomEventOnly} killedTool=${killedTool?.tool || 'none'} deliberateStop=${deliberateStop?.reason || 'none'} cause=${diagnosis?.cause || 'n/a'} policy=${policy}`);
    }
    return { sections: sections.filter(Boolean), diagnosis, killed, recovered, oomEventOnly, killedTool, deliberateStop, policy, observedAt };
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
 * Post the same kill/recovery report to the pull request, so a reader of the PR
 * is never left believing an unattended session simply carried on.
 *
 * The intermediate working-session log is uploaded only when `--attach-logs` is
 * enabled, exactly as the issue requires.
 *
 * @param {Object} options
 * @returns {Promise<{posted: boolean, url: string|null, skipped: string|null, logUploaded: boolean}>}
 */
export async function announceKillOnPullRequest({ pullRequestUrl, sessionName, sessionInfo, diagnosis, exitCode = null, observedAt = null, policy = null, recovered = false, oomEventOnly = false, killedTool = null, deliberateStop = null, resumed = false, recoverySessionId = null, attempt = null, maxAttempts = null, resumeCommand = null, runCommand = spawnCapture, attachLog = defaultAttachLog, attachOptions = {}, verbose = false } = {}) {
  const skip = reason => ({ posted: false, url: null, skipped: reason, logUploaded: false });
  // Issue #2301: a session started on a pull request URL has no *linked* pull
  // request to look up — the pull request is the one it was started on.
  pullRequestUrl = pullRequestUrl || startedPullRequestUrl(sessionInfo);
  if (!pullRequestUrl) return skip('no-pull-request');
  if (typeof runCommand !== 'function') return skip('no-command-runner');

  const attachLogs = argsIncludeAttachLogs(sessionInfo?.args);
  const logPath = sessionInfo?.logPath || null;

  // Issue #2498: a session that completed (`recovered`) already published its
  // own final log under `--attach-logs`; a second copy titled "killed session"
  // duplicated it and called a finished run killed.
  const upload = await attachIntermediateSessionLog({
    attachLogs: attachLogs && !recovered,
    logPath,
    pullRequestUrl,
    attachLog,
    attachOptions,
    verbose,
  });

  const body = buildKillRecoveryNotice({
    diagnosis,
    exitCode,
    sessionName,
    observedAt,
    policy,
    survived: recovered,
    oomEventOnly,
    killedTool,
    deliberateStop,
    resumed,
    recoverySessionId,
    attempt,
    maxAttempts,
    resumeCommand,
    attachLogs,
    logAttached: upload.uploaded,
  });

  const result = await postKillRecoveryNotice({
    pullRequestUrl,
    body,
    runCommand,
    fileSuffix: String(sessionName || 'session').replace(/[^A-Za-z0-9._-]/g, '-'),
    verbose,
  });

  return { posted: result.posted, url: result.url, skipped: result.posted ? null : result.error, logUploaded: upload.uploaded };
}

export { KILL_CAUSE_FORCED_KILL, KILL_CAUSE_OUT_OF_MEMORY };
