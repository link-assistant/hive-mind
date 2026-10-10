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
 * **How** it resumes matters as much (issue #2889). A snapshot resume commits
 * the container's whole writable layer — tens of gigabytes for a Rust or Node
 * build — and several started by one OOM event filled the disk. So a container
 * created with the command handoff (`./docker-resume-handoff.lib.mjs`) is
 * restarted with `docker start` instead: the recovery command is written into
 * it first, nothing is copied, and its own HostConfig (with the `docker update`
 * limits) and writable layer stay in place, so resource-limited sessions take
 * this path on any `$` version. Only a container created without the handoff
 * still needs a snapshot; those run one at a time and only with enough free
 * disk (`./docker-resume-snapshot-guard.lib.mjs`), and the stopped original is
 * removed once its snapshot-derived replacement runs.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 * @see https://github.com/link-assistant/hive-mind/issues/2889
 * @see https://github.com/link-foundation/start/issues/162
 * @see https://github.com/link-foundation/start/issues/176
 * @see https://github.com/link-assistant/hive-mind/issues/2146
 * @see https://github.com/link-assistant/hive-mind/issues/2408
 */

import crypto from 'node:crypto';
import semver from 'semver';
import { isFormalAiTask } from './formal-ai-sidecar.lib.mjs';
import { hasUseRouterFlag } from './router-isolation.lib.mjs';
import { RESUME_MODES } from './isolation-runner.resume.lib.mjs';
import { buildShellCommandLine, getDockerTaskContainerName, withDockerResumeHandoff } from './docker-resume-handoff.lib.mjs';
import { dockerSnapshotQueue, formatGiB, formatSnapshotDiskWait, waitForSnapshotDiskHeadroom } from './docker-resume-snapshot-guard.lib.mjs';

const GIB = 1024 ** 3;

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
  HANDOFF_FAILED: 'resume-handoff-failed',
  INSUFFICIENT_DISK: 'insufficient-disk',
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
 * @param {boolean} [options.dockerStart] - The resume restarts the same container
 *   (command handoff), which keeps its HostConfig and writable layer, so the
 *   resource-limit conditions of a snapshot resume do not apply
 * @returns {{eligible: boolean, reason: string, identifier: string|null, containerName: string|null}}
 */
export function planSameContainerResume({ sessionName = null, sessionInfo = {}, resumeKeepsResourceLimits = false, dockerStart = false } = {}) {
  const containerName = getDockerTaskContainerName(sessionInfo, sessionName);
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
  if (!dockerStart && hasSessionContainerResourceLimits(sessionInfo)) {
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
 * The recovery command as a shell line for the container. `plan.command.display`
 * is the chat form and may name a command alias (`/solve`), which is not an
 * executable inside the container.
 *
 * @param {Object} sessionInfo
 * @param {Object} plan - Result of planKillRecovery()
 * @returns {string|null}
 */
export function buildRecoveryShellCommand(sessionInfo, plan) {
  if (typeof plan?.command?.shell === 'string' && plan.command.shell) return plan.command.shell;
  if (!Array.isArray(plan?.command?.args)) return null;
  return buildShellCommandLine(sessionInfo?.command || 'solve', plan.command.args);
}

function missResult(identifier, reason) {
  return { resumed: false, reason, sessionId: null, executionUuid: identifier, mode: null, snapshotImage: null, containerName: null, containerReused: false, originalContainerRemoved: false, containerFilesystemInheritedBytes: null, resourceLimitReapplyError: null };
}

function refusedReason(result) {
  return result?.unsupported ? IN_PLACE_SKIP_REASONS.UNSUPPORTED : IN_PLACE_SKIP_REASONS.REFUSED;
}

async function reassertResourceLimits({ sessionName, sessionInfo, runner, containerName, verbose }) {
  if (!hasSessionContainerResourceLimits(sessionInfo) || !containerName || typeof runner?.applyDockerContainerResourceLimits !== 'function') return null;
  const reapplied = await runner.applyDockerContainerResourceLimits(containerName, sessionInfo?.containerResourceLimits?.requested || {});
  const error = reapplied?.success ? null : reapplied?.error || 'unknown error';
  if (error) console.warn(`[session-kill-resume] Could not re-assert CPU/RAM limits on resumed container ${containerName}: ${error}`);
  else if (verbose) console.log(`[VERBOSE] In-place resume of ${sessionName}: CPU/RAM limits re-asserted on ${containerName}`);
  return error;
}

/**
 * Restart the same container with `docker start` after handing it the
 * recovery command (issue #2889). Nothing is copied.
 */
async function resumeWithDockerStart({ sessionName, sessionInfo, plan, runner, notify, policy, handoffPath, recoveryCommand, verbose }) {
  const { containerName, identifier } = policy;
  // The recovery is tracked under a key the killed session's completion does
  // not delete afterwards: the execution UUID, or — when the killed session was
  // itself tracked under that UUID — the container name. `$` resolves both.
  const sessionId = sessionName === identifier ? containerName : identifier;
  if (!sessionId || sessionId === sessionName) return missResult(identifier, IN_PLACE_SKIP_REASONS.NO_IDENTIFIER);
  if (typeof runner.writeDockerResumeHandoff !== 'function') return missResult(identifier, IN_PLACE_SKIP_REASONS.NO_RESUME_SUPPORT);

  await notify({ phase: 'launching', attempt: plan?.attempt, detail: 'Restarting the same container with docker start (no filesystem copy).' });
  const written = await runner.writeDockerResumeHandoff(containerName, handoffPath, recoveryCommand, { verbose });
  if (!written?.success) {
    console.warn(`[session-kill-resume] Could not hand the recovery command to ${containerName}: ${written?.error || 'unknown error'}`);
    return missResult(identifier, IN_PLACE_SKIP_REASONS.HANDOFF_FAILED);
  }
  if (verbose) console.log(`[VERBOSE] In-place resume of ${sessionName}: recovery command handed to ${containerName}:${handoffPath}; resuming with docker start`);

  const result = await runner.resumeIsolatedSession(identifier, { command: null, verbose });
  if (!result?.success) {
    const reason = refusedReason(result);
    if (verbose) console.log(`[VERBOSE] In-place resume of ${sessionName} was not possible (${reason}): ${result?.error || 'no reason given'}`);
    return missResult(identifier, reason);
  }

  const previousCarry = Number.isFinite(sessionInfo?.containerFilesystemInheritedBytes) ? sessionInfo.containerFilesystemInheritedBytes : null;
  const executionUuid = result.uuid || identifier;
  if (result.mode === RESUME_MODES.DOCKER_START) {
    return { ...missResult(identifier, null), resumed: true, reason: 'resumed-docker-start', sessionId, executionUuid, mode: result.mode, containerName, containerReused: true, containerFilesystemInheritedBytes: previousCarry };
  }

  // The container vanished between the existence check and `$ --resume`, so `$`
  // relaunched the stored task command in a new container of the same name. Its
  // start gate waits for a release that only the launch path would send, and
  // nothing re-applied the limits `docker update` set on the old one.
  const relaunchedName = result.sessionName || containerName;
  if (typeof runner.releaseDockerContainerStartGate === 'function') await runner.releaseDockerContainerStartGate(relaunchedName, verbose);
  const resourceLimitReapplyError = await reassertResourceLimits({ sessionName, sessionInfo, runner, containerName: relaunchedName, verbose });
  return { ...missResult(identifier, null), resumed: true, reason: `resumed-${result.mode || 'unknown'}`, sessionId: relaunchedName !== sessionName ? relaunchedName : sessionId, executionUuid, mode: result.mode || null, containerName: relaunchedName, resourceLimitReapplyError };
}

/**
 * Snapshot resume for a container created without the handoff: one at a time,
 * only with disk headroom, and the stopped original removed afterwards.
 */
async function resumeWithSnapshot({ sessionName, sessionInfo, plan, runner, notify, env, snapshotQueue, sleep, now, recoveryCommand, verbose }) {
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
  const miss = reason => missResult(decision.identifier, reason);
  if (verbose && limited) {
    console.log(`[VERBOSE] In-place resume of ${sessionName}: resource-limited session, $ version ${startCommandVersion || '(unknown)'} → ${decision.eligible ? 'eligible' : `skipped (${decision.reason})`}`);
  }
  if (!decision.eligible) return miss(decision.reason);
  const { containerName } = decision;
  const attempt = plan?.attempt;
  // The derived container gets the handoff too, so its own next recovery is a
  // `docker start` rather than another snapshot.
  const command = withDockerResumeHandoff(`exec ${recoveryCommand}`, crypto.randomUUID());

  return snapshotQueue.run(
    async () => {
      let notifiedWaiting = false;
      const headroom = await waitForSnapshotDiskHeadroom({
        measure: async () => {
          const writableBytes = typeof runner.getDockerContainerWritableLayerSize === 'function' ? await runner.getDockerContainerWritableLayerSize(containerName, verbose) : null;
          const disk = typeof runner.checkDockerDiskSpace === 'function' ? await runner.checkDockerDiskSpace(verbose) : null;
          return { writableBytes, availableBytes: Number.isFinite(disk?.availableGiB) ? disk.availableGiB * GIB : null };
        },
        onWaiting: async evaluation => {
          const detail = formatSnapshotDiskWait(evaluation);
          if (verbose) console.log(`[VERBOSE] In-place resume of ${sessionName}: ${detail}`);
          if (notifiedWaiting) return;
          notifiedWaiting = true;
          await notify({ phase: 'launching', attempt, detail });
        },
        ...(sleep ? { sleep } : {}),
        ...(now ? { now } : {}),
      });
      if (!headroom.ok) {
        console.warn(`[session-kill-resume] Not snapshotting ${containerName}: ${formatSnapshotDiskWait(headroom.evaluation)} A fresh launch is used instead.`);
        return miss(IN_PLACE_SKIP_REASONS.INSUFFICIENT_DISK);
      }
      const size = headroom.evaluation.known ? `${formatGiB(headroom.evaluation.writableBytes)} ` : '';
      await notify({ phase: 'launching', attempt, detail: `Snapshotting the ${size}container filesystem (the container predates the docker start handoff).` });
      if (verbose) console.log(`[VERBOSE] In-place resume of ${sessionName}: snapshotting ${size || 'an unmeasured '}writable layer of ${containerName}`);

      const result = await runner.resumeIsolatedSession(decision.identifier, { command, verbose });
      if (!result?.success) {
        const reason = refusedReason(result);
        if (verbose) console.log(`[VERBOSE] In-place resume of ${sessionName} was not possible (${reason}): ${result?.error || 'no reason given'}`);
        return miss(reason);
      }

      // `docker-snapshot` names the new container `<session>-resume-<attempt>`,
      // which is what `$ --status` reports on now. A resume that reports the old
      // name is tracked under the execution UUID, which cannot collide with the
      // dying session's entry.
      const returnedName = result.sessionName && result.sessionName !== sessionName ? result.sessionName : null;
      const sessionId = returnedName || decision.identifier;
      const resumedContainer = result.sessionName || containerName;
      // start#176 re-applies the old HostConfig limits only when its own
      // `docker inspect` succeeded, and a relaunch has none to copy: re-assert.
      // A `docker-start` keeps the container's HostConfig.
      const resourceLimitReapplyError = limited && result.mode !== RESUME_MODES.DOCKER_START ? await reassertResourceLimits({ sessionName, sessionInfo, runner, containerName: resumedContainer, verbose }) : null;
      // Disk: a snapshot keeps what was written as image layers under a new,
      // empty writable layer, so that usage is carried; `docker-start` keeps the
      // same writable layer (only earlier carries remain); a relaunch starts over.
      const previousCarry = Number.isFinite(sessionInfo?.containerFilesystemInheritedBytes) ? sessionInfo.containerFilesystemInheritedBytes : null;
      const containerFilesystemInheritedBytes = result.mode === RESUME_MODES.DOCKER_SNAPSHOT ? getCarriedContainerDiskUsage(sessionInfo) : result.mode === RESUME_MODES.DOCKER_START ? previousCarry : null;
      if (verbose && Number.isFinite(containerFilesystemInheritedBytes)) {
        console.log(`[VERBOSE] In-place resume of ${sessionName}: ${containerFilesystemInheritedBytes} writable-layer bytes carried into ${sessionId}'s disk allowance`);
      }
      // The snapshot holds everything the stopped original did, so the original
      // only doubles the disk use. `docker rm` without -f never touches a
      // running container. HIVE_MIND_KEEP_TASK_CONTAINER=always keeps it.
      let originalContainerRemoved = false;
      if (result.mode === RESUME_MODES.DOCKER_SNAPSHOT && resumedContainer !== containerName && String(env?.HIVE_MIND_KEEP_TASK_CONTAINER || '').toLowerCase() !== 'always' && typeof runner.removeStoppedDockerContainer === 'function') {
        const removed = await runner.removeStoppedDockerContainer(containerName, { verbose });
        originalContainerRemoved = removed?.success === true;
        if (!originalContainerRemoved) console.warn(`[session-kill-resume] Could not remove the snapshotted container ${containerName}: ${removed?.error || 'unknown error'}`);
      }
      return {
        resumed: true,
        reason: result.mode === RESUME_MODES.DOCKER_SNAPSHOT ? 'resumed-in-place' : `resumed-${result.mode || 'unknown'}`,
        sessionId,
        executionUuid: result.uuid || decision.identifier,
        mode: result.mode || null,
        snapshotImage: result.snapshotImage || null,
        containerName: resumedContainer,
        containerReused: result.mode === RESUME_MODES.DOCKER_START,
        originalContainerRemoved,
        containerFilesystemInheritedBytes,
        resourceLimitReapplyError,
      };
    },
    {
      onQueued: ahead => notify({ phase: 'launching', attempt, detail: `Waiting for ${ahead} other container snapshot${ahead === 1 ? '' : 's'} to finish first.` }),
    }
  );
}

/**
 * Attempt the same-container resume. Never leaves work running that it does
 * not report: the caller may only fall back to a fresh launch when `resumed`
 * is false.
 *
 * A container created with the command handoff is restarted with
 * `docker start`; any other is snapshotted under the disk guard.
 *
 * @param {Object} options
 * @param {string} options.sessionName - The killed session's tracking key
 * @param {Object} options.sessionInfo - Persisted session info
 * @param {Object} options.plan - Result of planKillRecovery() (needs `command.args`)
 * @param {Object} options.runner - Isolation runner module
 * @param {Function} [options.notify] - Recovery lifecycle reporter ({phase, attempt, detail})
 * @param {Object} [options.env] - Source of HIVE_MIND_KEEP_TASK_CONTAINER
 * @param {Object} [options.snapshotQueue] - Serializes snapshot resumes
 * @param {Function} [options.sleep] - Test seam for the disk wait
 * @param {Function} [options.now] - Test seam for the disk wait
 * @param {boolean} [options.verbose]
 * @returns {Promise<{resumed: boolean, reason: string, sessionId: string|null, executionUuid: string|null, mode: string|null, snapshotImage: string|null, containerName: string|null, containerReused: boolean, originalContainerRemoved: boolean, containerFilesystemInheritedBytes: number|null, resourceLimitReapplyError: string|null}>}
 */
export async function resumeKilledSessionInPlace({ sessionName, sessionInfo, plan, runner, notify = async () => {}, env = process.env, snapshotQueue = dockerSnapshotQueue, sleep = null, now = null, verbose = false } = {}) {
  const policy = planSameContainerResume({ sessionName, sessionInfo, dockerStart: true });
  if (!policy.eligible) return missResult(policy.identifier, policy.reason);
  if (typeof runner?.resumeIsolatedSession !== 'function' || typeof runner?.checkDockerContainerExists !== 'function') {
    return missResult(policy.identifier, IN_PLACE_SKIP_REASONS.NO_RESUME_SUPPORT);
  }
  // A container that no longer exists has nothing left to re-enter; `$` would
  // fall back to a full relaunch, which is what the caller does anyway — but
  // through the path that also re-acquires leases.
  const exists = await runner.checkDockerContainerExists(policy.containerName, verbose);
  if (!exists) return missResult(policy.identifier, IN_PLACE_SKIP_REASONS.CONTAINER_GONE);
  const recoveryCommand = buildRecoveryShellCommand(sessionInfo, plan);
  if (!recoveryCommand) return missResult(policy.identifier, IN_PLACE_SKIP_REASONS.ERROR);

  const handoffPath = typeof runner.readDockerResumeHandoffPath === 'function' ? await runner.readDockerResumeHandoffPath(policy.containerName, { verbose }) : null;
  if (verbose) console.log(`[VERBOSE] In-place resume of ${sessionName}: container ${policy.containerName} ${handoffPath ? 'accepts a command handoff → docker start' : 'has no command handoff → guarded snapshot'}`);
  if (handoffPath) return resumeWithDockerStart({ sessionName, sessionInfo, plan, runner, notify, policy, handoffPath, recoveryCommand, verbose });
  return resumeWithSnapshot({ sessionName, sessionInfo, plan, runner, notify, env, snapshotQueue, sleep, now, recoveryCommand, verbose });
}
