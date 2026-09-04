/**
 * Re-enter the *same* container when recovering a killed session (issue #2189).
 *
 * The incident behind #2189 ended with a session that was killed 10 minutes
 * after the AI tool had already finished its work. Recovery, when it finally
 * happened, threw that container away: a fresh isolated run re-cloned the
 * repository, re-installed everything and re-did work that was sitting on disk.
 * The issue asks for the opposite — "ideally re-entering the same `$` session
 * id / container".
 *
 * `start-command@0.33.0` (upstream link-foundation/start#162, filed from this
 * very issue) makes that possible: `$ --resume <id> -- <command>` commits the
 * stopped container's filesystem and runs the recovery command in a container
 * derived from that snapshot, keeping the original execution UUID and log.
 *
 * Not every session may take that path, and the two exceptions are deliberate:
 *
 * - **Formal AI tasks** (issue #2146) reach their sidecar over an *internal*
 *   Docker network that Hive Mind attaches with `docker network connect` after
 *   the container is created. `$` knows nothing about that network, so a
 *   resumed container would come up without it and the task would silently talk
 *   to nothing. #2146 requires Formal AI to fail closed, so these fall back to
 *   the normal launch path, which re-acquires the sidecar lease properly.
 * - **`--use-router` tasks** are attached to the router network the same way,
 *   with a freshly minted token, and have the same problem.
 *
 * Everything else — the overwhelming majority, and every session in the
 * original incident — resumes in place.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 * @see https://github.com/link-foundation/start/issues/162
 * @see https://github.com/link-assistant/hive-mind/issues/2146
 */

import { isFormalAiTask } from './formal-ai-sidecar.lib.mjs';
import { hasUseRouterFlag } from './router-isolation.lib.mjs';
import { RESUME_MODES } from './isolation-runner.resume.lib.mjs';

/** Why a killed session cannot be re-entered in place. Reported, never thrown. */
export const IN_PLACE_SKIP_REASONS = Object.freeze({
  NOT_DOCKER: 'not-docker',
  NO_IDENTIFIER: 'no-identifier',
  FORMAL_AI_TASK: 'formal-ai-task',
  ROUTER_TASK: 'router-task',
  NO_RESUME_SUPPORT: 'no-resume-support',
  CONTAINER_GONE: 'container-gone',
  UNSUPPORTED: 'resume-unsupported',
  REFUSED: 'resume-refused',
  ERROR: 'resume-error',
});

/**
 * Decide — purely, from persisted facts — whether a killed session is a
 * candidate for a same-container resume.
 *
 * Kept separate from the Docker probe below so the policy is testable without a
 * daemon, and so a caller can report precisely *why* a session was relaunched
 * from scratch instead of resumed.
 *
 * @param {Object} options
 * @param {string} options.sessionName - The killed session's name (= container name)
 * @param {Object} options.sessionInfo - Persisted session info
 * @returns {{eligible: boolean, reason: string, identifier: string|null, containerName: string|null}}
 */
export function planSameContainerResume({ sessionName = null, sessionInfo = {} } = {}) {
  const containerName = sessionInfo?.sessionId || sessionName || null;
  const identifier = sessionInfo?.executionUuid || containerName || null;
  const base = { eligible: false, identifier, containerName };

  if (sessionInfo?.isolationBackend !== 'docker') {
    // screen/tmux sessions have no filesystem to preserve: their work happens
    // on the host, which a fresh run already sees.
    return { ...base, reason: IN_PLACE_SKIP_REASONS.NOT_DOCKER };
  }
  if (!identifier) return { ...base, reason: IN_PLACE_SKIP_REASONS.NO_IDENTIFIER };

  const args = Array.isArray(sessionInfo?.args) ? sessionInfo.args : [];
  if (isFormalAiTask({ args, model: sessionInfo?.model || null })) {
    return { ...base, reason: IN_PLACE_SKIP_REASONS.FORMAL_AI_TASK };
  }
  if (hasUseRouterFlag(args)) return { ...base, reason: IN_PLACE_SKIP_REASONS.ROUTER_TASK };

  return { ...base, eligible: true, reason: 'ready' };
}

/**
 * Attempt the same-container resume. Never throws, and never leaves work
 * running that it does not report: the caller may only fall back to a fresh
 * launch when `resumed` is false.
 *
 * @param {Object} options
 * @param {string} options.sessionName - The killed session's name
 * @param {Object} options.sessionInfo - Persisted session info
 * @param {Object} options.plan - Result of planKillRecovery() (needs `command.display`)
 * @param {Object} options.runner - Isolation runner module
 * @param {boolean} [options.verbose]
 * @returns {Promise<{resumed: boolean, reason: string, sessionId: string|null, executionUuid: string|null, mode: string|null, snapshotImage: string|null}>}
 */
export async function resumeKilledSessionInPlace({ sessionName, sessionInfo, plan, runner, verbose = false } = {}) {
  const decision = planSameContainerResume({ sessionName, sessionInfo });
  const miss = reason => ({ resumed: false, reason, sessionId: null, executionUuid: decision.identifier, mode: null, snapshotImage: null });
  if (!decision.eligible) return miss(decision.reason);
  if (typeof runner?.resumeIsolatedSession !== 'function' || typeof runner?.checkDockerContainerExists !== 'function') {
    return miss(IN_PLACE_SKIP_REASONS.NO_RESUME_SUPPORT);
  }

  // A container that no longer exists has nothing left to re-enter; `$` would
  // fall back to a full relaunch, which is what the caller does anyway — but
  // through the path that also re-acquires leases.
  const exists = await runner.checkDockerContainerExists(decision.containerName, verbose);
  if (!exists) return miss(IN_PLACE_SKIP_REASONS.CONTAINER_GONE);

  const result = await runner.resumeIsolatedSession(decision.identifier, { command: plan?.command?.display || null, verbose });
  if (!result?.success) {
    const reason = result?.unsupported ? IN_PLACE_SKIP_REASONS.UNSUPPORTED : IN_PLACE_SKIP_REASONS.REFUSED;
    if (verbose) console.log(`[VERBOSE] In-place resume of ${sessionName} was not possible (${reason}): ${result?.error || 'no reason given'}`);
    return miss(reason);
  }

  // `docker-snapshot` names the new container `<session>-resume-<attempt>`; the
  // old name stays addressable through upstream's `sessionNameHistory`, but the
  // *new* one is what `$ --status` reports on now, so that is what the monitor
  // has to track. A resume that somehow reports the old name (a `docker-start`
  // race, say) is tracked under the execution UUID instead, which upstream
  // resolves just as well and cannot collide with the dying session's entry.
  const returnedName = result.sessionName && result.sessionName !== sessionName ? result.sessionName : null;
  const sessionId = returnedName || decision.identifier;
  return {
    resumed: true,
    reason: result.mode === RESUME_MODES.DOCKER_SNAPSHOT ? 'resumed-in-place' : `resumed-${result.mode || 'unknown'}`,
    sessionId,
    executionUuid: result.uuid || decision.identifier,
    mode: result.mode || null,
    snapshotImage: result.snapshotImage || null,
  };
}
