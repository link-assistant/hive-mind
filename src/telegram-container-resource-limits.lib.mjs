/** Telegram startup adapter for Docker task resource limits (issue #449). */
import { getenv } from './cli-arguments.lib.mjs';
import { hasContainerResourceLimits, normalizeContainerResourceLimits } from './container-resource-limits.lib.mjs';

// Three concurrent tasks at this cap use at most 75% of host RAM. Docker
// applies it before releasing each task's start gate; operators can override
// it with --container-memory or TELEGRAM_CONTAINER_MEMORY (issue #2301).
export const DEFAULT_DOCKER_TASK_MEMORY = '25%';

export function resolveTelegramContainerResourceLimits(config = {}, isolationBackend = '') {
  const limits = normalizeContainerResourceLimits({
    cpu: config.containerCpu || getenv('TELEGRAM_CONTAINER_CPU', ''),
    memory: config.containerMemory || getenv('TELEGRAM_CONTAINER_MEMORY', '') || (isolationBackend === 'docker' ? DEFAULT_DOCKER_TASK_MEMORY : ''),
    disk: config.containerDisk || getenv('TELEGRAM_CONTAINER_DISK', ''),
  });
  if (!hasContainerResourceLimits(limits)) return { limits, summary: null };
  if (isolationBackend !== 'docker') throw new Error('--container-cpu, --container-memory, and --container-disk require --isolation docker');
  return { limits, summary: `CPU=${limits.cpu || 'unlimited'}, RAM=${limits.memory || 'unlimited'}, disk=${limits.disk || 'unlimited'}` };
}

export function initializeTelegramContainerResourceLimits(config = {}, isolationBackend = '', { log = console.log, logError = console.error, exit = code => process.exit(code) } = {}) {
  try {
    const result = resolveTelegramContainerResourceLimits(config, isolationBackend);
    if (result.summary) log(`📏 Docker task limits enabled: ${result.summary}`);
    return result.limits;
  } catch (error) {
    logError(`Error: Invalid container resource limit: ${error?.message || error}`);
    exit(1);
    return { cpu: null, memory: null, disk: null };
  }
}
