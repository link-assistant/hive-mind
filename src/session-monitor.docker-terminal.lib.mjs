/**
 * Issue #2117: guard against a *fabricated* terminal exit code for detached
 * docker sessions.
 *
 * start-command derives the exit code of a detached docker session from an
 * unanchored `Exit Code: N` scan over the whole execution log
 * (`status-formatter.js#readExitCodeFromLog`), so any text the wrapped command
 * prints — for example an AI agent echoing the tail of an older execution log —
 * can be mistaken for the terminal footer. That is exactly how a `/solve` run
 * that merged its pull request and exited 0 was announced as "Work session
 * failed (exit code: 1)": the fabricated code entered the log 21 minutes before
 * the command finished, and `$ --status` stamped the record with it the moment
 * the container stopped — about two seconds before the real footer
 * (`Exit Code: 0`) was appended by start-command's detached-docker watcher.
 *
 * The watcher always appends that footer right after the container exits, so a
 * short deferral is enough for the authoritative value to appear. If it never
 * does (e.g. the watcher itself was killed), the reported status is accepted
 * once the grace period expires, preserving the previous behaviour: a real
 * failure is still reported, just a minute later.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2117
 * @see https://github.com/link-foundation/start/issues/150
 */

/** How long an uncorroborated docker terminal failure stays provisional. */
export const DOCKER_TERMINAL_FOOTER_GRACE_MS = 60 * 1000;

/** Session-snapshot field holding the first sighting of such a status. */
export const DOCKER_TERMINAL_UNVERIFIED_FIRST_SEEN_FIELD = 'dockerTerminalUnverifiedFirstSeenAt';

/**
 * Drop the deferral marker once the session's outcome is resolved (footer
 * written, session running again, or the status accepted).
 *
 * @param {object|null|undefined} sessionInfo - Tracked session snapshot (mutated).
 * @param {function} persistSnapshot - Callback persisting the updated snapshot.
 */
export function clearUnverifiedDockerTerminalMarker(sessionInfo, persistSnapshot) {
  if (!sessionInfo?.[DOCKER_TERMINAL_UNVERIFIED_FIRST_SEEN_FIELD]) return;
  delete sessionInfo[DOCKER_TERMINAL_UNVERIFIED_FIRST_SEEN_FIELD];
  persistSnapshot();
}

/**
 * Decide whether a docker terminal *failure* status that the log footer does not
 * corroborate should be deferred (treated as still running) for now. The first
 * sighting is persisted so the deferral survives a bot restart and cannot be
 * reset forever by repeated polling.
 *
 * @param {string} sessionName - Session identifier, for verbose output only.
 * @param {object|null|undefined} sessionInfo - Tracked session snapshot (mutated).
 * @param {object} options
 * @param {number|null} options.exitCode - Exit code `$ --status` reported.
 * @param {boolean} options.verbose - Whether to explain the decision.
 * @param {function} options.persistSnapshot - Callback persisting the snapshot.
 * @returns {boolean} True while the status is still provisional.
 */
export function shouldDeferUnverifiedDockerTerminal(sessionName, sessionInfo, { exitCode, verbose, persistSnapshot }) {
  const nowMs = Date.now();
  const raw = sessionInfo?.[DOCKER_TERMINAL_UNVERIFIED_FIRST_SEEN_FIELD];
  const firstSeenMs = raw ? new Date(raw).getTime() : null;

  if (firstSeenMs === null || !Number.isFinite(firstSeenMs)) {
    if (sessionInfo) {
      sessionInfo[DOCKER_TERMINAL_UNVERIFIED_FIRST_SEEN_FIELD] = new Date(nowMs).toISOString();
      persistSnapshot();
    }
    if (verbose) {
      console.log(`[VERBOSE] Session ${sessionName} reports a terminal failure (exit ${exitCode}) that no log footer corroborates; deferring for up to ${DOCKER_TERMINAL_FOOTER_GRACE_MS}ms until start-command writes the real footer (issue #2117)`);
    }
    return true;
  }

  if (nowMs - firstSeenMs < DOCKER_TERMINAL_FOOTER_GRACE_MS) {
    if (verbose) {
      console.log(`[VERBOSE] Session ${sessionName} still reports an unverified terminal failure (exit ${exitCode}); waiting for the log footer (issue #2117)`);
    }
    return true;
  }

  if (verbose) {
    console.log(`[VERBOSE] Session ${sessionName} kept reporting a terminal failure (exit ${exitCode}) for ${DOCKER_TERMINAL_FOOTER_GRACE_MS}ms without a log footer; accepting the reported exit code (issue #2117)`);
  }
  return false;
}
