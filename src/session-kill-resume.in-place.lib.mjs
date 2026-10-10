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
 * Not every session may take that path, and the exceptions are deliberate:
 *
 * - **Formal AI tasks** (issue #2146) reach their sidecar over an *internal*
 *   Docker network that Hive Mind attaches with `docker network connect` after
 *   the container is created. `$` knows nothing about that network, so a
 *   resumed container would come up without it and the task would silently talk
 *   to nothing. #2146 requires Formal AI to fail closed, so these fall back to
 *   the normal launch path, which re-acquires the sidecar lease properly.
 * - **`--use-router` tasks** are attached to the router network the same way,
 *   with a freshly minted token, and have the same problem.
 * - **Resource-limited tasks on `$` < 0.35.0** received CPU/RAM controls
 *   through `docker update`, after the original container was created. Docker
 *   snapshots do not retain those HostConfig controls, so these use the gated
 *   fresh-launch path that reapplies every configured limit before the
 *   recovery command starts. From 0.35.0 (link-foundation/start#176, filed
 *   from issue #2408) `$ --resume` reads the stopped container's HostConfig and
 *   re-applies its limits to the snapshot-derived one, so these resume in place
 *   too — keeping one execution UUID and one log. Hive Mind re-asserts CPU/RAM
 *   right after the resume anyway, and carries the writable-layer usage so far
 *   into the new container's disk allowance (a snapshot starts with an empty
 *   writable layer, which would otherwise reset the quota).
 *
 * Everything else — the overwhelming majority, and every session in the
 * original incident — resumes in place.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 * @see https://github.com/link-foundation/start/issues/162
 * @see https://github.com/link-foundation/start/issues/176
 * @see https://github.com/link-assistant/hive-mind/issues/2146
 * @see https://github.com/link-assistant/hive-mind/issues/2408
 */

import semver from 'semver';
import { isFormalAiTask } from './formal-ai-sidecar.lib.mjs';
import { hasUseRouterFlag } from './router-isolation.lib.mjs';
import { RESUME_MODES } from './isolation-runner.resume.lib.mjs';

/** Why a killed session cannot be re-entered in place. Reported, never thrown. */
export const IN_PLACE_SKIP_REASONS = Object.freeze({
  NOT_DOCKER: 'not-docker',
  NO_IDENTIFIER: 'no-identifier',
  FORMAL_AI_TASK: 'formal-ai-task',
  ROUTER_TASK: 'router-task',
  RESOURCE_LIMITS: 'container-resource-limits',
  DISK_USAGE_UNKNOWN: 'container-disk-usage-unknown',
  NO_RESUME_SUPPORT: 'no-resume-support',
  CONTAINER_GONE: 'container-gone',
  UNSUPPORTED: 'resume-unsupported',
  REFUSED: 'resume-refused',
  ERROR: 'resume-error',
});

/** First start-command release whose `$ --resume` keeps HostConfig limits (start#176). */
export const MIN_START_COMMAND_RESUME_KEEPS_LIMITS_VERSION = '0.35.0';

/**
 * Whether the installed `$` re-applies a container's resource limits when it
 * resumes it from a snapshot. An unknown version is treated as "no".
 *
 * @param {string|null} version - Output of getStartCommandVersion()
 * @returns {boolean}
 */
export function startCommandResumeKeepsResourceLimits(version) {
  const parsed = semver.valid(semver.coerce(version || ''));
  return Boolean(parsed && semver.gte(parsed, MIN_START_COMMAND_RESUME_KEEPS_LIMITS_VERSION));
}

/** True when the session was launched with any Hive Mind container limit. */
export function hasSessionContainerResourceLimits(sessionInfo) {
  const limits = sessionInfo?.containerResourceLimits;
  return Boolean(limits && (Number.isFinite(limits.cpuCores) || Number.isFinite(limits.memoryBytes) || Number.isFinite(limits.diskBytes) || Object.values(limits.requested || {}).some(Boolean)));
}

/**
 * Writable-layer bytes the session's execution has used across every
 * container it has run in so far: what earlier snapshots carried in, plus what
 * the current container has written (last monitor measurement). Null when the
 * current container was never measured.
 *
 * @param {Object} sessionInfo
 * @returns {number|null}
 */
export function getCarriedContainerDiskUsage(sessionInfo) {
  const last = sessionInfo?.containerFilesystemLastBytes;
  if (!Number.isFinite(last)) return null;
  const inherited = Number.isFinite(sessionInfo?.containerFilesystemInheritedBytes) ? sessionInfo.containerFilesystemInheritedBytes : 0;
  return inherited + last;
}

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
 * @param {boolean} [options.resumeKeepsResourceLimits] - The installed `$` re-applies
 *   HostConfig limits on resume (start-command >= 0.35.0)
 * @returns {{eligible: boolean, reason: string, identifier: string|null, containerName: string|null}}
 */
export function planSameContainerResume({ sessionName = null, sessionInfo = {}, resumeKeepsResourceLimits = false } = {}) {
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

  // A replacement command is resumed by committing the stopped container and
  // starting a new snapshot-derived one. Docker does not copy HostConfig
  // settings changed through `docker update`, so before start-command 0.35.0
  // Hive Mind's CPU/RAM controls would disappear. Those versions use the normal
  // launch path, whose start gate reapplies every configured limit before the
  // recovery command is allowed to run.
  if (hasSessionContainerResourceLimits(sessionInfo)) {
    if (!resumeKeepsResourceLimits) return { ...base, reason: IN_PLACE_SKIP_REASONS.RESOURCE_LIMITS };
    // The disk limit is enforced by the monitor against the writable layer,
    // which a snapshot resets. Without a measurement of what was used so far
    // the allowance would silently start over, so take the fresh path instead.
    if (Number.isFinite(sessionInfo?.containerResourceLimits?.diskBytes) && getCarriedContainerDiskUsage(sessionInfo) === null) {
      return { ...base, reason: IN_PLACE_SKIP_REASONS.DISK_USAGE_UNKNOWN };
    }
  }

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
 * @returns {Promise<{resumed: boolean, reason: string, sessionId: string|null, executionUuid: string|null, mode: string|null, snapshotImage: string|null, containerFilesystemInheritedBytes: number|null, resourceLimitReapplyError: string|null}>}
 */
export async function resumeKilledSessionInPlace({ sessionName, sessionInfo, plan, runner, verbose = false } = {}) {
  const limited = hasSessionContainerResourceLimits(sessionInfo);
  let startCommandVersion = null;
  if (limited && typeof runner?.getStartCommandVersion === 'function') {
    try {
      startCommandVersion = await runner.getStartCommandVersion({ verbose });
    } catch {
      startCommandVersion = null;
    }
  }
  const resumeKeepsResourceLimits = limited && startCommandResumeKeepsResourceLimits(startCommandVersion);
  const decision = planSameContainerResume({ sessionName, sessionInfo, resumeKeepsResourceLimits });
  const miss = reason => ({ resumed: false, reason, sessionId: null, executionUuid: decision.identifier, mode: null, snapshotImage: null, containerFilesystemInheritedBytes: null, resourceLimitReapplyError: null });
  if (verbose && limited) {
    console.log(`[VERBOSE] In-place resume of ${sessionName}: resource-limited session, $ version ${startCommandVersion || '(unknown)'} → ${decision.eligible ? 'eligible' : `skipped (${decision.reason})`}`);
  }
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

  // start#176 re-applies the old HostConfig limits, but only when its own
  // `docker inspect` succeeded (and a `relaunch` — the container vanished
  // after the existence check — has no HostConfig to copy at all). Re-assert
  // CPU/RAM so a silent miss upstream can never leave the recovery running
  // unbounded. A `docker-start` resume restarts the same container, whose
  // HostConfig (with the `docker update` limits) Docker keeps.
  let resourceLimitReapplyError = null;
  const resumedContainer = result.sessionName || decision.containerName;
  if (limited && result.mode !== RESUME_MODES.DOCKER_START && resumedContainer && typeof runner?.applyDockerContainerResourceLimits === 'function') {
    const requested = sessionInfo?.containerResourceLimits?.requested || {};
    const reapplied = await runner.applyDockerContainerResourceLimits(resumedContainer, requested);
    resourceLimitReapplyError = reapplied?.success ? null : reapplied?.error || 'unknown error';
    if (resourceLimitReapplyError) console.warn(`[session-kill-resume] Could not re-assert CPU/RAM limits on resumed container ${resumedContainer}: ${resourceLimitReapplyError}`);
    else if (verbose) console.log(`[VERBOSE] In-place resume of ${sessionName}: CPU/RAM limits re-asserted on ${resumedContainer}`);
  }
  // Disk: a snapshot keeps what was written as image layers under a new, empty
  // writable layer, so that usage is carried; `docker-start` keeps the same
  // writable layer (only earlier carries remain); a relaunch starts over.
  const previousCarry = Number.isFinite(sessionInfo?.containerFilesystemInheritedBytes) ? sessionInfo.containerFilesystemInheritedBytes : null;
  const containerFilesystemInheritedBytes = result.mode === RESUME_MODES.DOCKER_SNAPSHOT ? getCarriedContainerDiskUsage(sessionInfo) : result.mode === RESUME_MODES.DOCKER_START ? previousCarry : null;
  if (verbose && Number.isFinite(containerFilesystemInheritedBytes)) {
    console.log(`[VERBOSE] In-place resume of ${sessionName}: ${containerFilesystemInheritedBytes} writable-layer bytes carried into ${sessionId}'s disk allowance`);
  }
  return {
    resumed: true,
    reason: result.mode === RESUME_MODES.DOCKER_SNAPSHOT ? 'resumed-in-place' : `resumed-${result.mode || 'unknown'}`,
    sessionId,
    executionUuid: result.uuid || decision.identifier,
    mode: result.mode || null,
    snapshotImage: result.snapshotImage || null,
    containerFilesystemInheritedBytes,
    resourceLimitReapplyError,
  };
}
