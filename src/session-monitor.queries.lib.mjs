/**
 * Read-only queries over the session-monitor registry.
 *
 * Extracted from session-monitor.lib.mjs (issue #2175) so that file stays under
 * the 1350-line early-warning threshold the CI file-headroom check enforces
 * (long files cause concurrent PR merge conflicts — issue #1593).
 *
 * These functions never mutate the registry beyond refreshing the cached
 * last-known status of a session that turned out to have finished, which is
 * exactly what the monitor itself does on the next poll. They are exposed
 * through a factory so the registry Map and the liveness helpers stay private
 * to session-monitor.lib.mjs.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2175
 */

/**
 * Bind the registry queries to a session-monitor instance.
 *
 * @param {object} deps
 * @param {Map<string, object>} deps.activeSessions in-memory session registry
 * @param {(url: string) => string} deps.normalizeSessionUrl
 * @param {(sessionName: string, sessionInfo: object, verbose?: boolean) => boolean} deps.isNonIsolationSessionActive
 * @param {(sessionName: string, sessionInfo: object, options?: object) => Promise<object>} deps.getIsolationSessionState
 * @param {(sessionName: string) => Promise<boolean>} deps.checkScreenSessionExists
 * @param {number} deps.NON_ISOLATION_SESSION_TIMEOUT_MS
 * @returns {{hasActiveSessionForUrl: Function, findStoppableSessionByUrl: Function, hasActiveSessionForUrlAsync: Function, getRunningTrackedIsolationSessions: Function, getRunningSessionItems: Function, getSessionStats: Function}}
 */
export function createSessionRegistryQueries({ activeSessions, normalizeSessionUrl, isNonIsolationSessionActive, getIsolationSessionState, checkScreenSessionExists, NON_ISOLATION_SESSION_TIMEOUT_MS }) {
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
  function hasActiveSessionForUrl(url, verbose = false) {
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
  function findStoppableSessionByUrl(url, verbose = false) {
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
  async function hasActiveSessionForUrlAsync(url, verbose = false, options = {}) {
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
  async function getRunningTrackedIsolationSessions(verbose = false, options = {}) {
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
   * render them as a clickable list in `/queue`: the issue/PR
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
  async function getRunningSessionItems(verbose = false, options = {}) {
    const items = [];
    const screenChecker = options.screenChecker || checkScreenSessionExists;
    for (const [sessionName, sessionInfo] of activeSessions.entries()) {
      let running;
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
  function getSessionStats(verbose = false) {
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

  return { hasActiveSessionForUrl, findStoppableSessionByUrl, hasActiveSessionForUrlAsync, getRunningTrackedIsolationSessions, getRunningSessionItems, getSessionStats };
}
