import { isAbsolute, resolve } from 'node:path';
import { executionId, localDockerEndpoint } from '../../storage/lib/docker.mjs';

export const digestPattern = /^sha256:[a-f0-9]{64}$/;
export const namePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return value;
}

function uuid(value) {
  if (typeof value !== 'string' || !executionId.test(value)) throw new Error('Use complete execution or preview UUIDs.');
  return value.toLowerCase();
}

function flag(value) {
  if (typeof value !== 'boolean') throw new Error('Startup policy flags must be boolean.');
  return value;
}

export function autoFixPolicy(options) {
  const { name, stateDir, socket = '', variant = 'plain', startDocker = false, startInstance = false, cleanupPreview, repairRecords = [], recovery, minFreeGiB = 1, minMemoryMiB = 512 } = options;
  if (typeof name !== 'string' || !namePattern.test(name) || typeof stateDir !== 'string' || !isAbsolute(stateDir) || /[\0\r\n]/.test(stateDir) || resolve(stateDir) === '/' || typeof socket !== 'string' || !['plain', 'dind'].includes(variant)) {
    throw new Error('Select a valid deployment name, absolute state directory, local socket and variant.');
  }
  if (!Array.isArray(repairRecords) || repairRecords.length > 10) throw new Error('Select at most 10 repair execution UUIDs.');
  let recover = null;
  if (recovery) {
    if (recovery.execution !== undefined) {
      if (recovery.limit !== undefined) throw new Error('Select either a recovery limit or an exact execution.');
      recover = {
        execution: uuid(recovery.execution),
        limit: 1,
        attempt: integer(recovery.attempt, 1, 10, 'Recovery attempt'),
        maxResumes: integer(recovery.maxResumes ?? 1, 1, 10, 'Maximum resumes'),
      };
    } else {
      if (recovery.attempt !== undefined || recovery.maxResumes !== undefined) throw new Error('An attempt or maximum resumes requires an exact recovery execution.');
      recover = { limit: integer(recovery.limit, 1, 10, 'Recovery limit'), maxResumes: 1 };
    }
  }
  return {
    name,
    stateDir: resolve(stateDir),
    socket,
    endpoint: localDockerEndpoint(socket),
    variant,
    startDocker: flag(startDocker),
    startInstance: flag(startInstance),
    cleanupPreview: cleanupPreview === undefined ? null : uuid(cleanupPreview),
    repairRecords: [...new Set(repairRecords.map(uuid))].sort(),
    recovery: recover,
    minFreeGiB: integer(minFreeGiB, 1, 1024, 'Minimum storage in GiB'),
    minMemoryMiB: integer(minMemoryMiB, 128, 1024 * 1024, 'Minimum memory in MiB'),
  };
}

export function deploymentTarget({ name, stateDir, endpoint, variant }) {
  return { name, stateDir, endpoint, variant };
}
