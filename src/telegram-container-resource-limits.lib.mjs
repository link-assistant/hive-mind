/** Telegram startup adapter for Docker task resource limits (issue #449). */
import { getenv } from './cli-arguments.lib.mjs';
import { hasContainerResourceLimits, normalizeContainerResourceLimits } from './container-resource-limits.lib.mjs';

export function resolveTelegramContainerResourceLimits(config = {}, isolationBackend = '') {
  const limits = normalizeContainerResourceLimits({
    cpu: config.containerCpu || getenv('TELEGRAM_CONTAINER_CPU', ''),
    memory: config.containerMemory || getenv('TELEGRAM_CONTAINER_MEMORY', ''),
    disk: config.containerDisk || getenv('TELEGRAM_CONTAINER_DISK', ''),
  });
  if (!hasContainerResourceLimits(limits)) return { limits, summary: null };
  if (isolationBackend !== 'docker') throw new Error('--container-cpu, --container-memory, and --container-disk require --isolation docker');
  return { limits, summary: `CPU=${limits.cpu || 'unlimited'}, RAM=${limits.memory || 'unlimited'}, disk=${limits.disk || 'unlimited'}` };
}
