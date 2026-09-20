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
import { buildKillDiagnosticsSection, formatKillRecoverySection, KILL_CAUSE_FORCED_KILL, KILL_CAUSE_OUT_OF_MEMORY } from './session-kill-diagnostics.lib.mjs';
import { getOomEventObservedAt } from './session-monitor.oom.lib.mjs';
import { resolveOnSessionKillPolicy } from './session-kill-policy.lib.mjs';
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
 * @param {boolean} [options.verbose]
 * @param {Function} [options.readFile]
 * @param {Object} [options.env]
 * @returns {Promise<{sections: string[], diagnosis: Object|null, killed: boolean, recovered: boolean, policy: string|null, observedAt: string|null}>}
 */
export async function buildKillCompletionSections({ sessionName, sessionInfo, statusResult = null, exitCode = null, status = null, verbose = false, readFile = fs.readFile, env = process.env } = {}) {
  const empty = { sections: [], diagnosis: null, killed: false, recovered: false, policy: null, observedAt: null };
  try {
    const outcome = classifySessionOutcome({ exitCode, status });
    const observedAt = getOomEventObservedAt(sessionInfo);
    const killed = outcome.killed === true;
    const recovered = !killed && Boolean(observedAt);
    if (!killed && !recovered) return empty;

    const locale = sessionInfo?.locale || null;
    const logPath = statusResult?.logPath || sessionInfo?.logPath || null;
    const { section, diagnosis } = await buildKillDiagnosticsSection(logPath, {
      verbose,
      readFile,
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
    });

    const argv = argvFromSessionArgs(sessionInfo?.args);
    const policy = resolveOnSessionKillPolicy({ argv, env, sessionInfo, verbose });

    const sections = [];
    if (recovered) {
      // The session outlived the event — this is the warning the issue asks for.
      sections.push(formatKillRecoverySection({ cause: diagnosis?.cause || KILL_CAUSE_OUT_OF_MEMORY, observedAt, locale, resumed: sessionInfo?.killRecoveryResumed === true }));
    }
    if (section) sections.push(section);

    if (verbose) {
      console.log(`[VERBOSE] Session ${sessionName} kill reporting: killed=${killed} recovered=${recovered} cause=${diagnosis?.cause || 'n/a'} policy=${policy}`);
    }
    return { sections: sections.filter(Boolean), diagnosis, killed, recovered, policy, observedAt };
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
export async function announceKillOnPullRequest({ pullRequestUrl, sessionName, sessionInfo, diagnosis, exitCode = null, observedAt = null, policy = null, recovered = false, resumed = false, recoverySessionId = null, attempt = null, maxAttempts = null, resumeCommand = null, runCommand = spawnCapture, attachLog = defaultAttachLog, attachOptions = {}, verbose = false } = {}) {
  const skip = reason => ({ posted: false, url: null, skipped: reason, logUploaded: false });
  if (!pullRequestUrl) return skip('no-pull-request');
  if (typeof runCommand !== 'function') return skip('no-command-runner');

  const attachLogs = argsIncludeAttachLogs(sessionInfo?.args);
  const logPath = sessionInfo?.logPath || null;

  const upload = await attachIntermediateSessionLog({
    attachLogs,
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
    resumed: recovered || resumed || sessionInfo?.killRecoveryResumed === true,
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
