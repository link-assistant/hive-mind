/** Docker task retention and cleanup decisions when the monitor observes an exit. */
import { snapshotImagesForContainer } from './kill-recovery-snapshot-cleanup.lib.mjs';
import { isSessionPaused, isStoppedDockerState } from './session-pause.lib.mjs';
import { classifySessionOutcome } from './work-session-formatting.lib.mjs';

export const DEFAULT_DOCKER_TASK_CONTAINER_KEEP_POLICY = 'on-failure';
export const DOCKER_TASK_CONTAINER_KEEP_POLICIES = ['always', 'on-failure', 'never'];
export function resolveDockerTaskContainerKeepPolicy({ env = process.env, verbose = false } = {}) {
  const raw = String(env?.HIVE_MIND_KEEP_TASK_CONTAINER || '')
    .trim()
    .toLowerCase();
  if (!raw) return DEFAULT_DOCKER_TASK_CONTAINER_KEEP_POLICY;
  if (DOCKER_TASK_CONTAINER_KEEP_POLICIES.includes(raw)) return raw;
  if (verbose) {
    console.log(`[VERBOSE] Invalid HIVE_MIND_KEEP_TASK_CONTAINER='${raw}', using '${DEFAULT_DOCKER_TASK_CONTAINER_KEEP_POLICY}'`);
  }
  return DEFAULT_DOCKER_TASK_CONTAINER_KEEP_POLICY;
}

function isSuccessfulTaskCompletion({ exitCode = null, status = null, command = null } = {}) {
  const outcome = classifySessionOutcome({ exitCode, status, command });
  if (outcome.noChanges) return true;
  if (outcome.failed) return false;
  if (exitCode === 0) return true;
  const normalizedStatus = String(status || '')
    .trim()
    .toLowerCase();
  return exitCode === null && (normalizedStatus === 'executed' || normalizedStatus === 'completed');
}
function formatDockerTaskContainerKeptSection({ containerName, keepPolicy }) {
  return ['*Docker container kept*', `Container: \`${containerName}\``, `Policy: \`HIVE_MIND_KEEP_TASK_CONTAINER=${keepPolicy}\``, `Inspect: \`docker start -ai ${containerName}\``, `Shell: \`docker exec -it ${containerName} sh\``, `Remove when done: \`docker rm -f ${containerName}\``].join('\n');
}
export function buildDockerTaskContainerCompletionAction({ sessionName, sessionInfo, exitCode = null, status = null, env = process.env, verbose = false, containerRemoved = false, dockerState = null } = {}) {
  if (sessionInfo?.isolationBackend !== 'docker' || isSessionPaused(sessionInfo)) {
    return { applies: false, containerName: null, keepPolicy: null, shouldRemove: false, extraSection: '' };
  }
  const containerName = sessionInfo.dockerContainerName || sessionInfo.sessionId || sessionName || null;
  if (!containerName) {
    return { applies: false, containerName: null, keepPolicy: null, shouldRemove: false, extraSection: '' };
  }
  const keepPolicy = resolveDockerTaskContainerKeepPolicy({ env, verbose });
  const successful = isSuccessfulTaskCompletion({ exitCode, status, command: sessionInfo.command });
  const shouldKeep = sessionInfo.stopRequestedByUser || keepPolicy === 'always' || (keepPolicy === 'on-failure' && !successful);
  const resumeAvailable = shouldKeep && !containerRemoved && isStoppedDockerState(dockerState) && (Boolean(sessionInfo.stopRequestedByUser) || !successful);
  // Issue #2889: the snapshot images of the container's resume chain go with it.
  const snapshotImages = [...new Set([...snapshotImagesForContainer(containerName), ...(Array.isArray(sessionInfo.killRecoverySnapshotImages) ? sessionInfo.killRecoverySnapshotImages : [])])];
  // Issue #2303: start-command already removed it, so "Docker container kept" would point at nothing; its images still go (#2889).
  if (containerRemoved && verbose) console.log(`[VERBOSE] Docker task container '${containerName}' was already removed by start-command; only its snapshot images are left to remove`);
  return {
    applies: true,
    containerName,
    keepPolicy,
    successful,
    resumeAvailable,
    shouldRemove: !shouldKeep,
    containerRemoved,
    snapshotImages,
    extraSection: shouldKeep && !containerRemoved ? [formatDockerTaskContainerKeptSection({ containerName, keepPolicy: sessionInfo.stopRequestedByUser ? 'stopped by request' : keepPolicy }), ...(resumeAvailable ? [`Resume: \`/resume ${sessionName}\``] : [])].join('\n') : '',
  };
}

export function retainStoppedDockerTask(info, status, action) {
  if (!action?.resumeAvailable || info.killRecoverySessionId) return;
  info.retainedForResume = true;
  if (status?.sessionName) info.dockerContainerName = status.sessionName;
}
