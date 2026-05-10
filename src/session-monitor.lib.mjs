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
 * Session state is stored in-memory. The `$` CLI (start-command) is accessed
 * purely via its CLI interface, not as a library dependency.
 *
 * @see https://github.com/link-foundation/start
 * @see https://github.com/link-assistant/hive-mind/issues/380
 */

import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import { formatSessionCompletionMessage, getSessionCompletionExitCode } from './work-session-formatting.lib.mjs';
import { notifySubscribers, getSubscriberCount } from './telegram-subscribers.lib.mjs';

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

export function resetSessionMonitorForTests() {
  activeSessions.clear();
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
  if (verbose) {
    const mode = sessionInfo.isolationBackend ? `isolation:${sessionInfo.isolationBackend}` : 'screen';
    console.log(`[VERBOSE] Session ${sessionName} tracked in memory (mode: ${mode})`);
  }
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
function completeSession(sessionName, exitCode = 0, verbose = false) {
  activeSessions.delete(sessionName);
  if (verbose) {
    console.log(`[VERBOSE] Session ${sessionName} removed from tracking (exit: ${exitCode})`);
  }
}

function isMessageAlreadyUpdatedError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('message is not modified');
}

function normalizeSessionUrl(url) {
  return url.replace(/\/+$/, '').replace(/#.*$/, '').toLowerCase();
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

async function getIsolationSessionState(sessionName, sessionInfo, options = {}) {
  const { verbose = false, statusProvider = null } = options;
  const sessionId = sessionInfo.sessionId || sessionName;

  try {
    const runner = await getIsolationRunner();
    const statusResult = statusProvider ? await statusProvider(sessionId, sessionInfo) : await runner.querySessionStatus(sessionId, verbose);

    if (statusResult?.exists && statusResult.status) {
      if (runner.isExecutingSessionStatus(statusResult.status)) {
        return { running: true, exitCode: null, status: statusResult.status, statusResult };
      }
      if (runner.isTerminalSessionStatus(statusResult.status)) {
        return {
          running: false,
          exitCode: statusResult.exitCode !== undefined ? statusResult.exitCode : null,
          status: statusResult.status,
          statusResult,
        };
      }
    }

    const running = await runner.isSessionRunning(sessionId, {
      backend: sessionInfo.isolationBackend,
      verbose,
    });
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

    if (sessionInfo.isolationBackend && sessionInfo.sessionId) {
      // Isolation mode: use $ --status, with screen -ls only as a fallback
      // when the status record is unavailable. Terminal $ statuses are
      // authoritative so completed screen sessions do not stay blocked.
      const state = await getIsolationSessionState(sessionName, sessionInfo, {
        verbose,
        statusProvider: options.statusProvider,
      });
      stillRunning = state.running;
      exitCode = state.exitCode;
      statusResult = state.statusResult;
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

        // Issue #1688: When the original /solve URL was an issue, look up the
        //   linked PR so the completion message can include both an `Issue:` and
        //   a `Pull request:` line. Failures are logged and ignored — the
        //   notification still goes out without the PR line.
        let pullRequestUrl = null;
        try {
          pullRequestUrl = await resolvePullRequestUrlForSession(sessionInfo, { verbose, lookupLinkedPullRequest: options.lookupLinkedPullRequest });
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
            const endSnapshot = await showLimitsLib.captureLimitsSnapshot({
              tool: sessionInfo.tool || 'claude',
              verbose,
              limitsLib,
            });
            sessionInfo.limitsAtEnd = endSnapshot;
            const deltaBlock = showLimitsLib.formatLimitsDeltaBlock(sessionInfo.limitsAtStart || null, endSnapshot);
            if (deltaBlock) limitsExtraSections.push(deltaBlock);
            else {
              // Either start snapshot was missing or tool changed — fall back
              // to a plain end-of-task snapshot so the user still sees current state.
              const endBlock = showLimitsLib.formatLimitsSnapshotBlock(endSnapshot, { title: '📊 Limits at end' });
              if (endBlock) limitsExtraSections.push(endBlock);
            }
          } catch (limitsError) {
            if (verbose) {
              console.log(`[VERBOSE] Could not capture end-of-task limits for ${sessionName}: ${limitsError?.message || limitsError}`);
            }
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
          extraSections: limitsExtraSections,
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

        completeSession(sessionName, finalExitCode || 0, verbose);
      } catch (error) {
        console.error(`Failed to send completion notification for ${sessionName}:`, error);
        if (isMessageAlreadyUpdatedError(error)) {
          completeSession(sessionName, exitCode || 0, verbose);
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
 * @returns {Promise<string|null>} PR URL or null
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1688
 */
async function resolvePullRequestUrlForSession(sessionInfo, { verbose = false, lookupLinkedPullRequest = null } = {}) {
  const ctx = sessionInfo?.urlContext;
  if (!ctx || ctx.type !== 'issue' || !ctx.owner || !ctx.repo || !ctx.number) {
    return null;
  }

  if (typeof lookupLinkedPullRequest === 'function') {
    return await lookupLinkedPullRequest(ctx);
  }

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
    throw error;
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
  console.log(`📊 Session monitoring started (checking every ${intervalMs / 1000} seconds, storage: in-memory)`);
  return timer;
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
