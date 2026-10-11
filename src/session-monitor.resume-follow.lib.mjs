/**
 * Follow a tracked docker session into the container that resumed it (#2917).
 *
 * start-command's snapshot resume (`$ --resume <name>`) commits the dead
 * container and runs the work on in `<name>-resume-<n>`. When an operator does
 * that by hand — as after the 2026-10-09 dockerd OOM — the bot's tracked
 * session still points at the dead container: `$ --status` reports it terminal
 * (`executed 137`) and the monitor would announce a finished task while its
 * resumed container keeps working. This module re-points the session at the
 * running descendant instead, so the task stays counted and its real end is the
 * one reported.
 *
 * The bot's own kill recovery (#2134) tracks the resumed container as a new
 * session and records it in `killRecoverySessionId`; such sessions are left
 * alone.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2917
 */

import { findRunningResumeDescendant } from './docker-task-containers.lib.mjs';

/**
 * @param {string} sessionName - Key of the tracked session
 * @param {Object} sessionInfo - Tracked session info (mutated when followed)
 * @param {Object} options
 * @param {Function} [options.taskContainers] - () => Promise<{available, containers}>
 * @param {Function} [options.statusProvider] - (sessionId, sessionInfo) => status
 * @param {Object} [options.runner] - isolation runner (querySessionStatus)
 * @param {Function} [options.persistSnapshot]
 * @param {boolean} [options.verbose]
 * @returns {Promise<{from: string, to: string}|null>} the switch made, if any
 */
export async function followRunningResumeDescendant(sessionName, sessionInfo, options = {}) {
  const { taskContainers = null, statusProvider = null, runner = null, persistSnapshot = () => {}, verbose = false } = options;
  if (!sessionInfo || sessionInfo.killRecoverySessionId) return null;
  const from = sessionInfo.sessionId || sessionName;
  let result;
  try {
    result = taskContainers ? await taskContainers(verbose) : await (await import('./docker-task-containers.lib.mjs')).getRunningTaskContainers(verbose);
  } catch {
    return null;
  }
  if (!result?.available) return null;
  const descendant = findRunningResumeDescendant(from, result.containers);
  if (!descendant) return null;

  let descendantStatus;
  try {
    descendantStatus = statusProvider ? await statusProvider(descendant.name, sessionInfo) : runner?.querySessionStatus ? await runner.querySessionStatus(descendant.name, verbose) : null;
  } catch {
    descendantStatus = null;
  }
  // Only a footer written after the resumed container started belongs to this
  // attempt (see scopeRecoveryFooter) — the dead container's `exit 137` footer
  // may sit in the same log.
  sessionInfo.attemptStartedAt = descendant.startedAt || new Date().toISOString();
  sessionInfo.followedResumeOf = from;
  sessionInfo.sessionId = descendant.name;
  sessionInfo.rootSessionName = sessionInfo.rootSessionName || descendant.rootSessionName || sessionName;
  if (descendantStatus?.uuid) sessionInfo.executionUuid = descendantStatus.uuid;
  // Terminal-state caches describe the dead container.
  sessionInfo.dockerBackendGoneFirstSeenAt = undefined;
  sessionInfo.oomEventObservedAt = undefined;
  try {
    persistSnapshot();
  } catch {
    // Best effort; the next tick persists again.
  }
  if (verbose) console.log(`[VERBOSE] Session ${sessionName}: ${from} is terminal but its resume ${descendant.name} is running (started ${descendant.startedAt || 'unknown'}); following it (issue #2917)`);
  return { from, to: descendant.name };
}
