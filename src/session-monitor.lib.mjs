/**
 * Session monitoring for Telegram bot
 *
 * Tracks active sessions (screen-based or isolation-based) and sends
 * notifications when they complete.
 *
 * Two tracking modes:
 * 1. Screen mode (default): Uses `screen -ls` to detect session completion
 * 2. Isolation mode: Uses `$ --status <uuid>` from start-command CLI for reliable tracking
 *
 * Session state is stored in-memory and, since issue #1927, mirrored to a
 * durable on-disk store so a bot restart can reload and resume monitoring of
 * detached sessions that were still running when the previous process died. The
 * `$` CLI (start-command) is accessed purely via its CLI interface, not as a
 * library dependency.
 *
 * @see https://github.com/link-foundation/start
 * @see https://github.com/link-assistant/hive-mind/issues/380
 * @see https://github.com/link-assistant/hive-mind/issues/1927
 */

import { exec as execCallback } from 'child_process';
import fs from 'fs/promises';
import { promisify } from 'util';
import { formatSessionCompletionMessage, getSessionCompletionExitCode, classifySessionOutcome } from './work-session-formatting.lib.mjs';
import { notifySubscribers, getSubscriberCount } from './telegram-subscribers.lib.mjs';
import { classifyExitStatus } from './session-status.lib.mjs';
import { readLastSessionIdFromLog, buildResumeCommand, formatResumeSection } from './session-resume.lib.mjs';

export { formatSessionCompletionMessage, getSessionCompletionExitCode } from './work-session-formatting.lib.mjs';

const exec = promisify(execCallback);

// Lazy import for isolation runner (only when needed)
let _isolationRunner = null;
async function getIsolationRunner() {
  if (!_isolationRunner) {
    _isolationRunner = await import('./isolation-runner.lib.mjs');
  }
  return _isolationRunner;
}
// In-memory session store
const activeSessions = new Map();

// Issue #1927: optional durable mirror of the in-memory registry. When set (by
// the bot at startup via setSessionStore), every track/complete is persisted so
// a restart can reload and keep monitoring detached sessions. Left null in unit
// tests and one-off CLI paths, where in-memory tracking is sufficient.
let sessionStore = null;
let sessionLogger = null;

/**
 * Attach a durable session store (see session-store.lib.mjs) so tracked sessions
 * survive a bot restart. Passing null disconnects the store (used by tests).
 * @param {object|null} store
 */
export function setSessionStore(store) {
  sessionStore = store || null;
}

/**
 * Attach a structured logger (see bot-logger.lib.mjs) so session lifecycle
 * transitions are recorded with timestamps. Optional; console is used otherwise.
 * @param {object|null} logger
 */
export function setSessionLogger(logger) {
  sessionLogger = logger || null;
}

function logEvent(type, data) {
  if (sessionLogger && typeof sessionLogger.event === 'function') {
    sessionLogger.event(type, data);
  }
}

export function resetSessionMonitorForTests() {
  activeSessions.clear();
  sessionStore = null;
  sessionLogger = null;
}

/**
 * Inject a stub isolation runner so tests can drive getIsolationSessionState
 * without spawning real `$ --status` / docker probes. Pass `null` to restore the
 * lazy real import on the next call. See issue #1939.
 */
export function __setIsolationRunnerForTests(runner) {
  _isolationRunner = runner;
}

/**
 * Test-only accessor for getIsolationSessionState (otherwise module-private).
 * Used by tests/test-issue-1939-docker-isolation.mjs to verify that an ambiguous
 * docker terminal status falls through to the live container cross-check.
 */
export function getIsolationSessionStateForTests(sessionName, sessionInfo, options = {}) {
  return getIsolationSessionState(sessionName, sessionInfo, options);
}

/**
 * Issue #1586: Timeout for non-isolation sessions.
 * Non-isolation (plain start-screen) sessions cannot reliably detect completion
 * because the screen stays alive via `exec bash`. To prevent false positives
 * that permanently block users, non-isolation sessions are auto-expired after
 * this timeout. This still prevents accidental duplicate commands within the
 * timeout window (5-10 minutes).
 *
 * Once --isolation is fully tested and becomes the default, this timeout
 * mechanism will no longer be needed.
 */
export const NON_ISOLATION_SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Check if a screen session exists
 * @param {string} sessionName - Name of the screen session to check
 * @returns {Promise<boolean>} True if session exists, false otherwise
 */
export async function checkScreenSessionExists(sessionName) {
  try {
    const { stdout } = await exec('screen -ls');
    return stdout.includes(sessionName);
  } catch {
    // screen -ls returns exit code 1 when no sessions exist
    return false;
  }
}

/**
 * Track a new session for completion monitoring
 *
 * @param {string} sessionName - Name of the screen session or isolation session UUID
 * @param {Object} sessionInfo - Session metadata
 * @param {number} sessionInfo.chatId - Telegram chat ID to notify
 * @param {number} [sessionInfo.messageId] - Telegram message ID to update on completion
 * @param {Date} sessionInfo.startTime - When the session started
 * @param {string} sessionInfo.url - GitHub URL being processed
 * @param {string} sessionInfo.command - Command type (solve/hive)
 * @param {string} [sessionInfo.isolationBackend] - Isolation backend if using isolation mode
 * @param {string} [sessionInfo.sessionId] - UUID for isolation-based sessions
 * @param {boolean} verbose - Whether to log verbose output
 */
export function trackSession(sessionName, sessionInfo, verbose = false) {
  activeSessions.set(sessionName, sessionInfo);
  const mode = sessionInfo.isolationBackend ? `isolation:${sessionInfo.isolationBackend}` : 'screen';
  if (verbose) {
    console.log(`[VERBOSE] Session ${sessionName} tracked in memory (mode: ${mode})`);
  }
  // Issue #1927: mirror to the durable store so a restart can resume monitoring.
  // Only isolation-backed sessions are persisted — they are the ones tracked in
  // `$` (start-command) with a reliable status record (requirement #2). Plain
  // screen sessions are timeout-based best-effort; resuming them after a restart
  // could fabricate a "finished" message with no real exit code, so they stay
  // in-memory only.
  if (sessionStore && isPersistableSession(sessionInfo)) {
    try {
      sessionStore.persist(sessionName, sessionInfo);
    } catch (error) {
      console.error(`[session-monitor] Could not persist session ${sessionName}: ${error.message}`);
    }
  }
  logEvent('session_tracked', {
    sessionName,
    mode,
    url: sessionInfo.url || null,
    command: sessionInfo.command || null,
    sessionId: sessionInfo.sessionId || null,
    startTime: sessionInfo.startTime instanceof Date ? sessionInfo.startTime.toISOString() : sessionInfo.startTime || null,
  });
}

/**
 * Whether a session should be mirrored to the durable store. Only isolation
 * sessions with a start-command UUID qualify (see trackSession rationale).
 * @param {object} sessionInfo
 * @returns {boolean}
 */
function isPersistableSession(sessionInfo) {
  return Boolean(sessionInfo?.isolationBackend && sessionInfo?.sessionId);
}

/**
 * Look up the in-memory record for a session id (UUID for isolation sessions
 * or the screen session name for non-isolation sessions). Returns null when no
 * record exists — for example, after a process restart or for sessions that
 * were never tracked through the Telegram bot. Used by `/log` to discover the
 * originating chat id and the GitHub URL associated with a session.
 *
 * @param {string} sessionName
 * @returns {Object|null}
 */
export function getTrackedSessionInfo(sessionName) {
  if (!sessionName) return null;
  return activeSessions.get(sessionName) || null;
}

/**
 * Get the number of active sessions being tracked
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {number} Number of active sessions
 */
export function getActiveSessionCount(verbose = false) {
  if (verbose) {
    console.log(`[VERBOSE] Active sessions: ${activeSessions.size}`);
  }
  return activeSessions.size;
}

/**
 * Get all active sessions
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Array<{sessionName: string, sessionInfo: Object}>} Array of active sessions
 */
function getActiveSessions(verbose = false) {
  const sessions = [];
  for (const [sessionName, sessionInfo] of activeSessions.entries()) {
    sessions.push({ sessionName, sessionInfo });
  }
  if (verbose) {
    console.log(`[VERBOSE] Retrieved ${sessions.length} active session(s)`);
  }
  return sessions;
}

/**
 * Remove a session from tracking
 * @param {string} sessionName - Name of the session to remove
 * @param {boolean} verbose - Whether to log verbose output
 */
function completeSession(sessionName, exitCode = 0, verbose = false, status = null) {
  const sessionInfo = activeSessions.get(sessionName) || null;
  activeSessions.delete(sessionName);
  if (verbose) {
    console.log(`[VERBOSE] Session ${sessionName} removed from tracking (exit: ${exitCode}${status ? `, status: ${status}` : ''})`);
  }
  // Issue #1927: drop from the durable snapshot (and append a `complete` audit
  // event recording how it ended) so a later restart does not try to resume it.
  if (sessionStore && isPersistableSession(sessionInfo)) {
    try {
      sessionStore.remove(sessionName, { status, exitCode });
    } catch (error) {
      console.error(`[session-monitor] Could not remove persisted session ${sessionName}: ${error.message}`);
    }
  }
  logEvent('session_completed', { sessionName, exitCode: exitCode ?? null, status: status || null });
}

function isMessageAlreadyUpdatedError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('message is not modified');
}

function normalizeSessionUrl(url) {
  // Strip the fragment first, then any trailing slashes, so URLs that carry a
  // fragment after a trailing slash (e.g. `.../issues/18/#comment`) normalize to
  // the same value as the bare `.../issues/18`. Doing it in the other order
  // would leave a dangling trailing slash. (Issue #1871.)
  return url.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
}

const GITHUB_PULL_REQUEST_URL_RE = /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([0-9]+)/g;

export function extractPullRequestUrlFromText(text, { owner = null, repo = null } = {}) {
  if (!text) return null;

  const expectedOwner = owner ? String(owner).toLowerCase() : null;
  const expectedRepo = repo ? String(repo).toLowerCase() : null;
  const value = String(text);
  GITHUB_PULL_REQUEST_URL_RE.lastIndex = 0;

  let match;
  while ((match = GITHUB_PULL_REQUEST_URL_RE.exec(value)) !== null) {
    const [, matchOwner, matchRepo, pullNumber] = match;
    if (expectedOwner && matchOwner.toLowerCase() !== expectedOwner) continue;
    if (expectedRepo && matchRepo.toLowerCase() !== expectedRepo) continue;
    return `https://github.com/${matchOwner}/${matchRepo}/pull/${pullNumber}`;
  }

  return null;
}

async function resolvePullRequestUrlFromSessionLog(logPath, ctx, { verbose = false, readFile = fs.readFile } = {}) {
  if (!logPath) return null;

  try {
    const logText = await readFile(logPath, 'utf8');
    const pullRequestUrl = extractPullRequestUrlFromText(logText, { owner: ctx.owner, repo: ctx.repo });
    if (pullRequestUrl && verbose) {
      console.log(`[VERBOSE] Found PR ${pullRequestUrl} in completed session log ${logPath}`);
    }
    return pullRequestUrl;
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] Could not inspect session log ${logPath} for PR URL: ${error?.message || error}`);
    }
    return null;
  }
}

function isNonIsolationSessionActive(sessionName, sessionInfo, verbose = false) {
  const startTime = sessionInfo.startTime instanceof Date ? sessionInfo.startTime : new Date(sessionInfo.startTime);
  const elapsed = Date.now() - startTime.getTime();
  if (elapsed >= NON_ISOLATION_SESSION_TIMEOUT_MS) {
    if (verbose) {
      console.log(`[VERBOSE] Non-isolation session ${sessionName} expired after ${Math.round(elapsed / 1000)}s (timeout: ${NON_ISOLATION_SESSION_TIMEOUT_MS / 1000}s), removing from tracking`);
    }
    activeSessions.delete(sessionName);
    return false;
  }
  if (verbose) {
    const remainingSec = Math.round((NON_ISOLATION_SESSION_TIMEOUT_MS - elapsed) / 1000);
    console.log(`[VERBOSE] Non-isolation session ${sessionName} still within timeout (${remainingSec}s remaining)`);
  }
  return true;
}

/**
 * Issue #1927: minimum age before a session that `$ --status` still reports as
 * `executing` is allowed to be declared dead purely on a backend-liveness probe
 * (the screen/tmux/docker session is gone). This avoids a race where a session
 * that has just been launched — but whose backend has not registered yet — is
 * falsely reported as killed. The authoritative log-footer check is NOT gated by
 * this, because a written "Exit Code:" footer is proof the command terminated.
 */
export const STALE_EXECUTING_MIN_AGE_MS = 90 * 1000;

function sessionStartMs(sessionInfo) {
  const start = sessionInfo?.startTime;
  if (!start) return null;
  const date = start instanceof Date ? start : new Date(start);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Cross-check whether a session that `$ --status` still reports as `executing`
 * has actually terminated. Issue #1927: start-command's status can get stuck on
 * `executing` after the process was killed (a lingering shell keeps the screen
 * session alive, flipping executed→executing), so a SIGKILLed /solve was never
 * reported. Two independent signals are consulted, strongest first:
 *
 *   1. The execution log FOOTER. When start-command wrote "Exit Code: N" the
 *      command terminated, full stop — regardless of what `--status` claims.
 *      This is authoritative and catches the dominant lingering-shell case.
 *   2. Backend LIVENESS. If no footer was written (e.g. the wrapper itself was
 *      hard-killed) but the backing screen/tmux/docker session is gone, the
 *      process cannot still be executing. Gated by STALE_EXECUTING_MIN_AGE_MS to
 *      avoid a just-launched-not-yet-registered race.
 *
 * @returns {Promise<{exitCode: number|null, status: string, reason: string}|null>}
 *   Terminal details when the session is actually dead, else null (still running).
 */
async function resolveStaleExecutingState(sessionName, sessionInfo, statusResult, { verbose, runner, exitFromLog, backendAlive }) {
  // 1. Authoritative: the log footer.
  const logPath = statusResult?.logPath || sessionInfo?.logPath || null;
  if (logPath) {
    const readFooter = exitFromLog || runner.readSessionExitFromLog;
    const footer = readFooter ? readFooter(logPath, { verbose }) : null;
    if (footer?.finished) {
      const status = classifyExitStatus(footer.exitCode) || (footer.exitCode === 0 ? 'executed' : 'failed');
      return { exitCode: footer.exitCode, status, reason: `log-footer(exit ${footer.exitCode})` };
    }
  }

  // 2. Liveness probe, only once the session is old enough to have registered.
  const startMs = sessionStartMs(sessionInfo);
  const ageMs = startMs != null ? Date.now() - startMs : Infinity;
  if (ageMs >= STALE_EXECUTING_MIN_AGE_MS && sessionInfo?.isolationBackend) {
    const probe = backendAlive || runner.checkBackendSessionAlive;
    const alive = probe ? await probe(sessionInfo.sessionId || sessionName, sessionInfo.isolationBackend, verbose) : null;
    // Only `false` (definitively gone) counts as killed; `null` (unknown backend)
    // is treated as "no signal" so we don't kill on an indeterminate probe.
    if (alive === false) {
      return { exitCode: null, status: 'killed', reason: 'backend-gone' };
    }
  }

  return null;
}

async function getIsolationSessionState(sessionName, sessionInfo, options = {}) {
  const { verbose = false, statusProvider = null, exitFromLog = null, backendAlive = null, sessionRunning = null } = options;
  const sessionId = sessionInfo.sessionId || sessionName;

  try {
    const runner = await getIsolationRunner();
    const statusResult = statusProvider ? await statusProvider(sessionId, sessionInfo) : await runner.querySessionStatus(sessionId, verbose);

    if (statusResult?.exists && statusResult.status) {
      if (runner.isExecutingSessionStatus(statusResult.status)) {
        // Issue #1927: an `executing` status is not trusted blindly — verify the
        // process is really alive. start-command can keep reporting `executing`
        // after a kill, which is exactly how an OOM-killed /solve went unreported.
        const stale = await resolveStaleExecutingState(sessionName, sessionInfo, statusResult, { verbose, runner, exitFromLog, backendAlive });
        if (stale) {
          if (verbose) {
            console.log(`[VERBOSE] Session ${sessionName} reported '${statusResult.status}' but is actually terminated (${stale.reason}); treating as ${stale.status} (exit ${stale.exitCode})`);
          }
          // Rewrite the status payload so downstream completion formatting sees
          // the real terminal status/exit code instead of the stale `executing`.
          const correctedStatus = stale.status || 'killed';
          const corrected = { ...statusResult, status: correctedStatus, exitCode: stale.exitCode, endTime: statusResult.endTime || stale.endTime || null };
          return { running: false, exitCode: stale.exitCode, status: correctedStatus, statusResult: corrected, stale: true };
        }
        return { running: true, exitCode: null, status: statusResult.status, statusResult };
      }
      if (runner.isTerminalSessionStatus(statusResult.status)) {
        let exitCode = statusResult.exitCode !== undefined ? statusResult.exitCode : null;
        // Issue #1927: when start-command reports a terminal status but a missing
        // or sentinel (-1) exit code — which its lingering-shell reverse-flip can
        // produce — recover the real code from the log footer so a SIGKILL is not
        // mislabelled as a generic failure.
        if ((exitCode === null || exitCode === -1) && (statusResult.logPath || sessionInfo?.logPath)) {
          const readFooter = exitFromLog || runner.readSessionExitFromLog;
          const footer = readFooter ? readFooter(statusResult.logPath || sessionInfo.logPath, { verbose }) : null;
          if (footer?.finished) {
            exitCode = footer.exitCode;
            const correctedStatus = classifyExitStatus(footer.exitCode) || statusResult.status;
            if (verbose) {
              console.log(`[VERBOSE] Session ${sessionName} reported terminal '${statusResult.status}' with exit ${statusResult.exitCode}; recovered real exit ${exitCode} (${correctedStatus}) from log footer`);
            }
            return { running: false, exitCode, status: correctedStatus, statusResult: { ...statusResult, status: correctedStatus, exitCode } };
          }
        }
        // Issue #1939: a native docker session can report a terminal status
        // ("executed") with the unknown exit-code sentinel (-1) while the
        // container is still running. When the log footer above did not recover
        // a real terminal exit, such a status is provisional — fall through to
        // isSessionRunning() below, which cross-checks the live container via
        // `docker inspect` before we notify the user the work finished.
        const ambiguousDockerTerminal = sessionInfo.isolationBackend === 'docker' && typeof runner.isUnknownDockerExitCode === 'function' && runner.isUnknownDockerExitCode(exitCode);
        if (!ambiguousDockerTerminal) {
          return { running: false, exitCode, status: statusResult.status, statusResult };
        }
      }
    }

    // The status record is unavailable (no `exists`/`status`). Fall back to a
    // direct backend liveness check. `sessionRunning` is injectable purely so
    // this path is testable without the real `$`/`screen` binaries; production
    // always uses the runner's real check.
    const checkRunning = sessionRunning || runner.isSessionRunning;
    const running = await checkRunning(sessionId, {
      backend: sessionInfo.isolationBackend,
      verbose,
    });
    if (!running) {
      // Issue #1927: the `$ --status` record is unavailable (e.g. garbage-
      // collected while the bot was down) and the backend reports not-running.
      // Before declaring a bare null exit — which classifies as success — try
      // the log footer so a session that was killed while we were offline is
      // reported as the kill it was, not a silent success.
      const logPath = statusResult?.logPath || sessionInfo?.logPath || null;
      if (logPath) {
        const readFooter = exitFromLog || runner.readSessionExitFromLog;
        const footer = readFooter ? readFooter(logPath, { verbose }) : null;
        if (footer?.finished) {
          const correctedStatus = classifyExitStatus(footer.exitCode) || (footer.exitCode === 0 ? 'executed' : 'failed');
          if (verbose) {
            console.log(`[VERBOSE] Session ${sessionName} has no live status record; recovered exit ${footer.exitCode} (${correctedStatus}) from log footer`);
          }
          return { running: false, exitCode: footer.exitCode, status: correctedStatus, statusResult: { ...(statusResult || {}), status: correctedStatus, exitCode: footer.exitCode, endTime: statusResult?.endTime || footer.endTime || null } };
        }
      }
    }
    return {
      running,
      exitCode: running ? null : (statusResult?.exitCode ?? null),
      status: statusResult?.status || null,
      statusResult,
    };
  } catch (error) {
    if (verbose) {
      console.error(`[VERBOSE] Error refreshing isolated session ${sessionId}: ${error.message}`);
    }
    return { running: false, exitCode: null, status: null, statusResult: null };
  }
}

/**
 * Monitor active sessions and send notifications when they complete
 * @param {Object} bot - Telegraf bot instance for sending messages
 * @param {boolean} verbose - Whether to log verbose output
 */
export async function monitorSessions(bot, verbose = false, options = {}) {
  const sessions = getActiveSessions(verbose);

  if (sessions.length === 0) {
    return;
  }

  if (verbose) {
    console.log(`[VERBOSE] Checking ${sessions.length} active session(s)...`);
  }

  for (const { sessionName, sessionInfo } of sessions) {
    let stillRunning;
    let exitCode = null;
    let statusResult = null;
    let resolvedStatus = null;

    if (sessionInfo.isolationBackend && sessionInfo.sessionId) {
      // Isolation mode: use $ --status, with screen -ls only as a fallback
      // when the status record is unavailable. Terminal $ statuses are
      // authoritative so completed screen sessions do not stay blocked.
      const state = await getIsolationSessionState(sessionName, sessionInfo, {
        verbose,
        statusProvider: options.statusProvider,
        exitFromLog: options.exitFromLog,
        backendAlive: options.backendAlive,
        sessionRunning: options.sessionRunning,
      });
      stillRunning = state.running;
      exitCode = state.exitCode;
      statusResult = state.statusResult;
      resolvedStatus = state.status || statusResult?.status || null;
      if (state.stale && verbose) {
        console.log(`[VERBOSE] Session ${sessionName} detected as killed/terminated despite an 'executing' status report (issue #1927 cross-check)`);
      }
      // Issue #1927: once start-command reveals the log path, record it in the
      // durable snapshot. If the bot dies and restarts after start-command has
      // garbage-collected the status record, the resumed session can still read
      // the log footer to learn whether it was killed.
      if (statusResult?.logPath && sessionInfo.logPath !== statusResult.logPath) {
        sessionInfo.logPath = statusResult.logPath;
        if (sessionStore) {
          try {
            sessionStore.persist(sessionName, sessionInfo);
          } catch {
            /* best effort — persistence must never break monitoring */
          }
        }
      }
    } else {
      // Issue #1586: Non-isolation screen sessions cannot reliably detect
      // completion because start-screen keeps the screen alive via `exec bash`.
      // Auto-expire after timeout; within timeout, use screen -ls as best-effort.
      const startTime = sessionInfo.startTime instanceof Date ? sessionInfo.startTime : new Date(sessionInfo.startTime);
      const elapsed = Date.now() - startTime.getTime();
      if (elapsed >= NON_ISOLATION_SESSION_TIMEOUT_MS) {
        stillRunning = false;
        if (verbose) {
          console.log(`[VERBOSE] Non-isolation session ${sessionName} expired after ${Math.round(elapsed / 1000)}s (timeout: ${NON_ISOLATION_SESSION_TIMEOUT_MS / 1000}s)`);
        }
      } else {
        stillRunning = await checkScreenSessionExists(sessionName);
        if (verbose) {
          const remainingSec = Math.round((NON_ISOLATION_SESSION_TIMEOUT_MS - elapsed) / 1000);
          console.log(`[VERBOSE] Non-isolation session ${sessionName}: screen -ls says ${stillRunning ? 'running' : 'not found'} (timeout in ${remainingSec}s)`);
        }
      }
    }

    if (!stillRunning) {
      console.log(`Session ${sessionName} has finished. Sending notification to chat ${sessionInfo.chatId}`);

      try {
        const finalExitCode = getSessionCompletionExitCode({ exitCode, statusResult });

        // Issue #1688/#1905: When the original /solve URL was an issue, look up
        //   the created PR so the completion message can include both an
        //   `Issue:` and a `Pull request:` line. The linked-issue API can lag
        //   behind the solver's own verification log, so we also inspect the
        //   completed session log before giving up.
        let pullRequestUrl = null;
        try {
          pullRequestUrl = await resolvePullRequestUrlForSession(sessionInfo, {
            verbose,
            lookupLinkedPullRequest: options.lookupLinkedPullRequest,
            statusResult,
            readFile: options.readFile,
          });
        } catch (lookupError) {
          if (verbose) {
            console.log(`[VERBOSE] Pull request lookup failed for ${sessionName}: ${lookupError?.message || lookupError}`);
          }
        }

        // Issue #594: when --show-limits was used at command time, capture an
        //   end-of-task limits snapshot and append a delta block to the
        //   completion message. The cached helpers respect a 20-min TTL so
        //   parallel sessions don't stampede the upstream API.
        const limitsExtraSections = [];
        if (sessionInfo?.showLimits) {
          try {
            const showLimitsLib = await import('./telegram-show-limits.lib.mjs');
            const limitsLib = await import('./limits.lib.mjs');
            const { lt } = await import('./limits-i18n.lib.mjs');
            const endSnapshot = await showLimitsLib.captureLimitsSnapshot({
              tool: sessionInfo.tool || 'claude',
              verbose,
              limitsLib,
            });
            sessionInfo.limitsAtEnd = endSnapshot;
            const locale = sessionInfo.locale || null;
            const deltaBlock = showLimitsLib.formatLimitsDeltaBlock(sessionInfo.limitsAtStart || null, endSnapshot, { locale });
            if (deltaBlock) limitsExtraSections.push(deltaBlock);
            else {
              // Either start snapshot was missing or tool changed — fall back
              // to a plain end-of-task snapshot so the user still sees current state.
              const endBlock = showLimitsLib.formatLimitsSnapshotBlock(endSnapshot, { title: `📊 ${lt('limits_at_end', {}, { locale })}`, locale });
              if (endBlock) limitsExtraSections.push(endBlock);
            }
          } catch (limitsError) {
            if (verbose) {
              console.log(`[VERBOSE] Could not capture end-of-task limits for ${sessionName}: ${limitsError?.message || limitsError}`);
            }
          }
        }

        // Issue #1927 (review follow-up): when a /solve session was KILLED
        //   (OOM/SIGKILL — the silent failure this issue is about), surface a
        //   ready-to-run `--resume <lastSessionId>` command so the surviving
        //   parent (the operator, or an automation watching the bot) can pick the
        //   work back up. We deliberately do NOT auto-relaunch here: a job that
        //   reliably OOMs would storm. The rule "use the LAST of multiple
        //   sessions" is honored by reading the last `Session ID:` marker from
        //   the captured log. Purely additive — failures never block the
        //   completion notification, preserving backward compatibility.
        const resumeExtraSections = [];
        try {
          const outcome = classifySessionOutcome({ exitCode: finalExitCode, status: resolvedStatus });
          const isResumableCommand = (sessionInfo?.command || 'solve') === 'solve';
          if (outcome.killed && isResumableCommand) {
            const logPath = statusResult?.logPath || sessionInfo?.logPath || null;
            const lastSessionId = readLastSessionIdFromLog(logPath, { verbose }) || sessionInfo?.sessionId || null;
            const resumeCommand = buildResumeCommand({ sessionInfo, lastSessionId });
            const resumeSection = formatResumeSection({ lastSessionId, command: resumeCommand });
            if (resumeSection) {
              resumeExtraSections.push(resumeSection);
              if (verbose) {
                console.log(`[VERBOSE] Session ${sessionName} was killed; offering resume from last session ${lastSessionId}`);
              }
            }
          }
        } catch (resumeError) {
          if (verbose) {
            console.log(`[VERBOSE] Could not build resume section for ${sessionName}: ${resumeError?.message || resumeError}`);
          }
        }

        const message = formatSessionCompletionMessage({
          sessionName,
          sessionInfo,
          statusResult,
          observedEndTime: new Date(),
          exitCode: finalExitCode,
          infoBlock: sessionInfo?.infoBlock || '',
          pullRequestUrl,
          extraSections: [...limitsExtraSections, ...resumeExtraSections],
        });

        // Update the original reply message if messageId is available, otherwise send new message
        let notifyFromChatId = null;
        let notifyMessageId = null;
        if (sessionInfo.messageId) {
          await bot.telegram.editMessageText(sessionInfo.chatId, sessionInfo.messageId, undefined, message, { parse_mode: 'Markdown' });
          notifyFromChatId = sessionInfo.chatId;
          notifyMessageId = sessionInfo.messageId;
        } else {
          const sent = await bot.telegram.sendMessage(sessionInfo.chatId, message, { parse_mode: 'Markdown' });
          notifyFromChatId = sent?.chat?.id || sessionInfo.chatId;
          notifyMessageId = sent?.message_id || null;
        }

        // Issue #1688: forward the same completion message to every /subscribe-d user
        //   in their private chat with the bot. Failures are logged but don't block
        //   completion of the parent session.
        if (getSubscriberCount() > 0 && notifyFromChatId && notifyMessageId) {
          try {
            const skipUserIds = new Set();
            if (sessionInfo?.requesterUserId) skipUserIds.add(sessionInfo.requesterUserId);
            const summary = await notifySubscribers({
              bot,
              fromChatId: notifyFromChatId,
              messageId: notifyMessageId,
              fallbackText: message,
              fallbackOptions: { parse_mode: 'Markdown' },
              skipUserIds,
              verbose,
            });
            if (verbose) {
              console.log(`[VERBOSE] Subscribe notify summary for ${sessionName}: forwarded=${summary.forwarded}, sent=${summary.sent}, skipped=${summary.skipped}, failures=${summary.failures.length}`);
            }
          } catch (notifyError) {
            console.error(`[session-monitor] notifySubscribers failed for ${sessionName}:`, notifyError);
          }
        }

        completeSession(sessionName, finalExitCode || 0, verbose, resolvedStatus);
      } catch (error) {
        console.error(`Failed to send completion notification for ${sessionName}:`, error);
        if (isMessageAlreadyUpdatedError(error)) {
          completeSession(sessionName, exitCode || 0, verbose, resolvedStatus);
        } else {
          sessionInfo.lastNotificationError = error.message;
          sessionInfo.lastKnownStatus = statusResult?.status || sessionInfo.lastKnownStatus || null;
          sessionInfo.lastKnownExitCode = exitCode ?? sessionInfo.lastKnownExitCode ?? null;
          if (verbose) {
            console.log(`[VERBOSE] Session ${sessionName} kept in memory so the completion notification can be retried`);
          }
        }
      }
    }
  }
}

/**
 * Look up the URL of a pull request linked to the issue this session worked on.
 * Returns null when the session was already operating on a PR, the URL context
 * is missing, or no linked PR exists.
 *
 * Lazy-loads the GitHub batch helper so unrelated tests/imports don't pull
 * GitHub deps. Tests can override the lookup via `options.lookupLinkedPullRequest`.
 *
 * @param {Object} sessionInfo
 * @param {Object} [options]
 * @param {boolean} [options.verbose]
 * @param {Function} [options.lookupLinkedPullRequest] - Optional override `(ctx) => Promise<string|null>`
 * @param {Object} [options.statusResult] - Completed start-command status payload, including logPath
 * @param {Function} [options.readFile] - Optional test override for reading session logs
 * @returns {Promise<string|null>} PR URL or null
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1688
 * @see https://github.com/link-assistant/hive-mind/issues/1905
 */
async function resolvePullRequestUrlForSession(sessionInfo, { verbose = false, lookupLinkedPullRequest = null, statusResult = null, readFile = fs.readFile } = {}) {
  const ctx = sessionInfo?.urlContext;
  if (!ctx || ctx.type !== 'issue' || !ctx.owner || !ctx.repo || !ctx.number) {
    return null;
  }

  if (typeof lookupLinkedPullRequest === 'function') {
    const linkedPullRequestUrl = await lookupLinkedPullRequest(ctx);
    if (linkedPullRequestUrl) return linkedPullRequestUrl;
  } else {
    try {
      const { batchCheckPullRequestsForIssues } = await import('./github.lib.mjs');
      const result = await batchCheckPullRequestsForIssues(ctx.owner, ctx.repo, [ctx.number]);
      const linkedPRs = result?.[ctx.number]?.linkedPRs || [];
      if (linkedPRs.length > 0 && linkedPRs[0].url) {
        if (verbose) {
          console.log(`[VERBOSE] Found linked PR ${linkedPRs[0].url} for issue ${ctx.owner}/${ctx.repo}#${ctx.number}`);
        }
        return linkedPRs[0].url;
      }
    } catch (error) {
      if (verbose) {
        console.log(`[VERBOSE] batchCheckPullRequestsForIssues failed for ${ctx.owner}/${ctx.repo}#${ctx.number}: ${error?.message || error}`);
      }
    }
  }

  const logPath = statusResult?.logPath || sessionInfo?.logPath || null;
  const pullRequestUrlFromLog = await resolvePullRequestUrlFromSessionLog(logPath, ctx, { verbose, readFile });
  if (pullRequestUrlFromLog) return pullRequestUrlFromLog;

  if (verbose && logPath) {
    console.log(`[VERBOSE] No PR URL found for issue ${ctx.owner}/${ctx.repo}#${ctx.number} in session log ${logPath}`);
  } else if (verbose) {
    console.log(`[VERBOSE] No session log path available for PR URL fallback for issue ${ctx.owner}/${ctx.repo}#${ctx.number}`);
  }

  return null;
}

/**
 * Start the session monitoring interval
 * @param {Object} bot - Telegraf bot instance for sending messages
 * @param {boolean} verbose - Whether to log verbose output
 * @param {number} intervalMs - Monitoring interval in milliseconds (default: 30000)
 * @returns {NodeJS.Timer} The interval timer (can be cleared with clearInterval)
 */
export function startSessionMonitoring(bot, verbose = false, intervalMs = 30000, options = {}) {
  const runMonitor = () => {
    monitorSessions(bot, verbose, options).catch(error => {
      console.error(`[session-monitor] Session monitoring tick failed: ${error.message}`);
    });
  };
  const timer = setInterval(runMonitor, intervalMs);
  runMonitor();
  const storage = sessionStore ? `durable+in-memory (${sessionStore.snapshotPath})` : 'in-memory';
  console.log(`📊 Session monitoring started (checking every ${intervalMs / 1000} seconds, storage: ${storage})`);
  return timer;
}

/**
 * Issue #1927 (requirements #2 and #4): after a bot restart, reload the sessions
 * that were still being tracked when the previous process died and re-register
 * them so {@link monitorSessions} resumes watching them to completion. The very
 * next monitor tick re-queries each session's status — so a session that was
 * *killed while the bot was down* is finally reported (via the log-footer /
 * backend-liveness cross-check in {@link getIsolationSessionState}) instead of
 * vanishing silently.
 *
 * Only sessions persisted by this bot are resumed (they carry the chatId /
 * messageId needed to notify). The durable snapshot already contains exactly the
 * sessions that had not completed when the previous process died, because
 * completed sessions are removed from it. As a guard we additionally skip any
 * record whose startTime is after the current bot start (it cannot belong to a
 * previous run), satisfying requirement #2's "started before bot start time".
 *
 * @param {object} [options]
 * @param {object} [options.store] - Session store to load from (default: the store set via setSessionStore).
 * @param {number} [options.botStartTime] - Epoch seconds; only sessions started strictly before this are resumed. Defaults to now.
 * @param {boolean} [options.verbose]
 * @returns {Promise<{resumed: Array<{sessionName: string, sessionInfo: object}>, skipped: Array<{sessionName: string, reason: string}>}>}
 */
export async function resumeTrackedSessions(options = {}) {
  const { store = sessionStore, verbose = false, botStartTime = Math.floor(Date.now() / 1000) } = options;
  const resumed = [];
  const skipped = [];

  if (!store) {
    if (verbose) console.log('[VERBOSE] resumeTrackedSessions: no durable session store configured, nothing to resume');
    return { resumed, skipped };
  }

  let persisted = [];
  try {
    persisted = store.load();
  } catch (error) {
    console.error(`[session-monitor] resumeTrackedSessions: could not load persisted sessions: ${error.message}`);
    return { resumed, skipped };
  }

  for (const { sessionName, sessionInfo } of persisted) {
    if (activeSessions.has(sessionName)) {
      skipped.push({ sessionName, reason: 'already-tracked' });
      continue;
    }
    // Requirement #2/#4: a session that started after this bot came up cannot be
    // a leftover from a previous run, so never resume it here.
    const startMs = sessionStartMs(sessionInfo);
    if (startMs != null && startMs > botStartTime * 1000) {
      skipped.push({ sessionName, reason: 'started-after-bot-start' });
      if (verbose) console.log(`[VERBOSE] Skipping resume of ${sessionName}: started after bot start`);
      continue;
    }

    activeSessions.set(sessionName, sessionInfo);
    resumed.push({ sessionName, sessionInfo });
    logEvent('session_resumed', {
      sessionName,
      url: sessionInfo.url || null,
      command: sessionInfo.command || null,
      sessionId: sessionInfo.sessionId || null,
      startTime: sessionInfo.startTime instanceof Date ? sessionInfo.startTime.toISOString() : sessionInfo.startTime || null,
    });
    if (verbose) {
      console.log(`[VERBOSE] Resumed tracking of session ${sessionName} (url: ${sessionInfo.url || 'n/a'}, command: ${sessionInfo.command || 'n/a'}, backend: ${sessionInfo.isolationBackend || 'screen'})`);
    }
  }

  if (resumed.length > 0) {
    console.log(`♻️  Resumed monitoring of ${resumed.length} session(s) from durable store after restart`);
  } else if (verbose) {
    console.log('[VERBOSE] resumeTrackedSessions: no eligible sessions to resume');
  }

  return { resumed, skipped };
}

/**
 * Issue #1567: Check if there's an active session for a given URL.
 * This prevents concurrent sessions on the same PR/issue, which causes
 * iteration number jumps, duplicate "Ready to merge" comments, and other
 * inconsistencies when two auto-restart-until-mergeable processes run
 * simultaneously.
 *
 * Issue #1586: Non-isolation sessions (plain start-screen) cannot reliably
 * detect completion because the screen stays alive via `exec bash`. To avoid
 * permanent false positives, non-isolation sessions are auto-expired after
 * NON_ISOLATION_SESSION_TIMEOUT_MS (10 minutes). Within that window they
 * still block duplicate commands for the same URL, which prevents accidental
 * re-runs. Isolation-backed sessions have no timeout since their completion
 * is reliably detected by monitorSessions().
 *
 * @param {string} url - The GitHub URL to check (issue or PR URL)
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {{isActive: boolean, sessionName: string|null}} Whether an active session exists for this URL
 */
export function hasActiveSessionForUrl(url, verbose = false) {
  if (!url) return { isActive: false, sessionName: null };

  // Normalize the URL for comparison (remove trailing slashes, fragments, etc.)
  const normalizedUrl = normalizeSessionUrl(url);

  for (const [sessionName, sessionInfo] of activeSessions.entries()) {
    // Issue #1586: Auto-expire non-isolation sessions after timeout
    if (!sessionInfo.isolationBackend && !isNonIsolationSessionActive(sessionName, sessionInfo, verbose)) {
      continue;
    }
    if (sessionInfo.url && normalizeSessionUrl(sessionInfo.url) === normalizedUrl) {
      if (verbose) {
        const mode = sessionInfo.isolationBackend ? `isolation:${sessionInfo.isolationBackend}` : 'non-isolation (timeout-based)';
        console.log(`[VERBOSE] Found active session for URL ${url}: ${sessionName} (${mode})`);
      }
      return { isActive: true, sessionName };
    }
  }

  if (verbose) {
    console.log(`[VERBOSE] No active session found for URL ${url}`);
  }
  return { isActive: false, sessionName: null };
}

const SESSION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Issue #1871: Find a tracked, still-running session for a GitHub issue/PR URL
 * and report whether it can be stopped by forwarding CTRL+C to the
 * start-command session UUID.
 *
 * The `/stop <url>` Telegram flow originally consulted only the in-memory solve
 * queue. But a `/solve` or `/codex` that starts immediately (queue empty)
 * dispatches straight to a detached isolation session and is removed from the
 * queue's `processing` Map the moment it is launched. From that point on the
 * session-monitor's in-memory registry is the only place that still knows the
 * URL → start-command-UUID mapping, so `/stop <url>` reported "no task found"
 * even though the task was clearly running. This helper exposes that registry
 * so the stop flow can recover the UUID and interrupt the session.
 *
 * A session is stoppable when it was launched with an isolation backend and its
 * start-command UUID is UUID-shaped (the value `$ --stop <uuid>` expects). Plain
 * non-isolation screen sessions are reported but marked `stoppable: false`
 * because `$ --stop` cannot interrupt them.
 *
 * @param {string} url - GitHub issue or PR URL (any normalization)
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {{ sessionName: string, sessionId: string|null, sessionInfo: Object,
 *   isolationBackend: string|null, stoppable: boolean }|null} Match or null
 */
export function findStoppableSessionByUrl(url, verbose = false) {
  if (!url) return null;

  const normalizedUrl = normalizeSessionUrl(url);

  for (const [sessionName, sessionInfo] of activeSessions.entries()) {
    if (!sessionInfo.url || normalizeSessionUrl(sessionInfo.url) !== normalizedUrl) {
      continue;
    }
    // Issue #1586: skip expired non-isolation sessions — they are no longer running.
    if (!sessionInfo.isolationBackend && !isNonIsolationSessionActive(sessionName, sessionInfo, verbose)) {
      continue;
    }

    // The UUID `$ --stop` expects is the start-command session id. For
    // isolation sessions it is tracked either as sessionInfo.sessionId or as
    // the (UUID-shaped) session key itself.
    const candidateId = sessionInfo.sessionId || sessionName;
    const sessionId = SESSION_UUID_RE.test(candidateId) ? candidateId : null;
    const stoppable = Boolean(sessionInfo.isolationBackend && sessionId);

    if (verbose) {
      const mode = sessionInfo.isolationBackend ? `isolation:${sessionInfo.isolationBackend}` : 'non-isolation';
      console.log(`[VERBOSE] findStoppableSessionByUrl: matched ${sessionName} for ${url} (${mode}, stoppable=${stoppable})`);
    }

    return {
      sessionName,
      sessionId,
      sessionInfo,
      isolationBackend: sessionInfo.isolationBackend || null,
      stoppable,
    };
  }

  if (verbose) {
    console.log(`[VERBOSE] findStoppableSessionByUrl: no tracked session for ${url}`);
  }
  return null;
}

/**
 * Async active-session check for command handlers.
 *
 * Isolation-backed sessions are refreshed through `$ --status` before they
 * block a duplicate URL, so completed screen-isolated runs no longer require
 * waiting for the background polling interval.
 *
 * @param {string} url - The GitHub URL to check
 * @param {boolean} verbose - Whether to log verbose output
 * @param {Object} [options] - Test/support options
 * @param {Function} [options.statusProvider] - Optional `$ --status` provider
 * @returns {Promise<{isActive: boolean, sessionName: string|null, status?: string|null}>}
 */
export async function hasActiveSessionForUrlAsync(url, verbose = false, options = {}) {
  if (!url) return { isActive: false, sessionName: null };

  const normalizedUrl = normalizeSessionUrl(url);

  for (const [sessionName, sessionInfo] of activeSessions.entries()) {
    if (!sessionInfo.url || normalizeSessionUrl(sessionInfo.url) !== normalizedUrl) {
      continue;
    }

    if (!sessionInfo.isolationBackend) {
      if (isNonIsolationSessionActive(sessionName, sessionInfo, verbose)) {
        return { isActive: true, sessionName, status: null };
      }
      continue;
    }

    const state = await getIsolationSessionState(sessionName, sessionInfo, {
      verbose,
      statusProvider: options.statusProvider,
    });
    if (state.running) {
      if (verbose) {
        console.log(`[VERBOSE] Found executing isolated session for URL ${url}: ${sessionName} (status: ${state.status || 'unknown'})`);
      }
      return { isActive: true, sessionName, status: state.status || null };
    }

    if (verbose) {
      console.log(`[VERBOSE] Isolated session ${sessionName} for URL ${url} is no longer running (status: ${state.status || 'unknown'}), allowing retry while monitor sends completion`);
    }
    sessionInfo.lastKnownStatus = state.status || null;
    sessionInfo.lastKnownExitCode = state.exitCode ?? null;
  }

  if (verbose) {
    console.log(`[VERBOSE] No active session found for URL ${url}`);
  }
  return { isActive: false, sessionName: null };
}

/**
 * Refresh tracked isolation sessions and count only those that are executing.
 *
 * @param {boolean} verbose - Whether to log verbose output
 * @param {Object} [options] - Test/support options
 * @param {Function} [options.statusProvider] - Optional `$ --status` provider
 * @returns {Promise<{count: number, sessions: string[], byTool: Object}>}
 */
export async function getRunningTrackedIsolationSessions(verbose = false, options = {}) {
  const sessions = [];
  const byTool = {};

  for (const [sessionName, sessionInfo] of activeSessions.entries()) {
    if (!sessionInfo.isolationBackend) {
      continue;
    }

    const state = await getIsolationSessionState(sessionName, sessionInfo, {
      verbose,
      statusProvider: options.statusProvider,
    });

    if (!state.running) {
      sessionInfo.lastKnownStatus = state.status || null;
      sessionInfo.lastKnownExitCode = state.exitCode ?? null;
      continue;
    }

    const tool = sessionInfo.tool || 'claude';
    sessions.push(sessionName);
    byTool[tool] = (byTool[tool] || 0) + 1;
  }

  return { count: sessions.length, sessions, byTool };
}

/**
 * Return the currently-executing tracked sessions with the details needed to
 * render them as a clickable list in `/solve_queue` (`/queue`): the issue/PR
 * `url`, the `tool`, the start time, and (for isolation sessions) the backend
 * status. Both isolation and non-isolation screen sessions are included so the
 * list matches what is actually executing — the queue's own in-memory
 * `processing` Map is empty once a task has been dispatched to a detached
 * session, which is why executing tasks were previously not listed.
 *
 * Liveness is determined the same way as {@link monitorSessions}: isolation
 * sessions via `$ --status`, non-isolation screen sessions via a timeout window
 * plus a best-effort `screen -ls` check.
 *
 * @param {boolean} verbose - Whether to log verbose output
 * @param {Object} [options] - Test/support options
 * @param {Function} [options.statusProvider] - Optional `$ --status` provider
 * @param {Function} [options.screenChecker] - Optional screen-existence checker
 * @returns {Promise<Array<{sessionName: string, url: string|null, tool: string, status: string|null, startTime: (Date|string|number|null), isolationBackend: (string|null)}>>}
 * @see https://github.com/link-assistant/hive-mind/issues/1837
 */
export async function getRunningSessionItems(verbose = false, options = {}) {
  const items = [];
  const screenChecker = options.screenChecker || checkScreenSessionExists;

  for (const [sessionName, sessionInfo] of activeSessions.entries()) {
    let running = false;
    let status = null;

    if (sessionInfo.isolationBackend) {
      // Forward every injectable seam so the listing applies the same #1927
      // stale-`executing` reconciliation the monitor does — a session that
      // start-command still reports as `executing` but whose backend is gone (or
      // whose log footer shows a kill) must not be listed as running — and so the
      // whole path stays controllable from tests.
      const state = await getIsolationSessionState(sessionName, sessionInfo, {
        verbose,
        statusProvider: options.statusProvider,
        exitFromLog: options.exitFromLog,
        backendAlive: options.backendAlive,
        sessionRunning: options.sessionRunning,
      });
      running = state.running;
      status = state.status || null;
      if (!running) {
        sessionInfo.lastKnownStatus = state.status || null;
        sessionInfo.lastKnownExitCode = state.exitCode ?? null;
        continue;
      }
    } else {
      const startTime = sessionInfo.startTime instanceof Date ? sessionInfo.startTime : new Date(sessionInfo.startTime);
      const elapsed = Date.now() - startTime.getTime();
      if (elapsed >= NON_ISOLATION_SESSION_TIMEOUT_MS) {
        if (verbose) {
          console.log(`[VERBOSE] Non-isolation session ${sessionName} expired after ${Math.round(elapsed / 1000)}s; excluded from running list`);
        }
        continue;
      }
      running = await screenChecker(sessionName);
      if (!running) {
        continue;
      }
    }

    items.push({
      sessionName,
      url: sessionInfo.url || null,
      tool: sessionInfo.tool || 'claude',
      status,
      startTime: sessionInfo.startTime || null,
      isolationBackend: sessionInfo.isolationBackend || null,
    });
  }

  if (verbose) {
    console.log(`[VERBOSE] getRunningSessionItems found ${items.length} running session(s)`);
  }

  return items;
}

/**
 * Get statistics about session tracking
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Object} Statistics object
 */
export function getSessionStats(verbose = false) {
  const sessions = Array.from(activeSessions.values());
  const isolated = sessions.filter(s => s.isolationBackend);

  if (verbose) {
    console.log(`[VERBOSE] Session stats: ${sessions.length} total, ${isolated.length} isolated`);
  }

  return {
    total: activeSessions.size,
    executing: activeSessions.size,
    executed: 0,
    successful: 0,
    failed: 0,
    isolated: isolated.length,
    storageType: 'in-memory',
  };
}
