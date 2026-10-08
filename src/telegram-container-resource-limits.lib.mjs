/** Telegram startup adapter for Docker task resource limits (issue #449). */
import { getenv } from './cli-arguments.lib.mjs';
import { hasContainerResourceLimits, normalizeContainerResourceLimits } from './container-resource-limits.lib.mjs';

// Issue #2803: each Docker task gets its own random RAM cap between 90% and
// 100% of host RAM, picked when it starts. The old fixed 25% cap OOM-killed
// Claude at 2.9 GB while the host still had 7.5 GB free; a cap near host RAM
// lets one task use what is free, and the spread means concurrent tasks do
// not all reach their limit at the same moment. Docker applies it before
// releasing each task's start gate; operators can override it with
// --container-memory or TELEGRAM_CONTAINER_MEMORY.
export const DEFAULT_DOCKER_TASK_MEMORY = '90%-100%';

// Issue #2803: a task restarted after an out-of-memory kill gets a lower
// random cap, so it gives way first if memory runs short again. Override with
// --container-memory-after-oom or TELEGRAM_CONTAINER_MEMORY_AFTER_OOM; `off`
// keeps the task's normal RAM limit. Applies by default only when the normal
// RAM limit is the default too: an explicit --container-memory is respected.
export const DEFAULT_DOCKER_TASK_MEMORY_AFTER_OOM = '70%-80%';

const DISABLED_VALUES = new Set(['off', 'none', 'false', '0']);

function resolveMemoryAfterOom(config, memoryConfigured) {
  const configured = String(config.containerMemoryAfterOom || getenv('TELEGRAM_CONTAINER_MEMORY_AFTER_OOM', '') || '').trim();
  if (DISABLED_VALUES.has(configured.toLowerCase())) return '';
  if (configured) return configured;
  return memoryConfigured ? '' : DEFAULT_DOCKER_TASK_MEMORY_AFTER_OOM;
}

export function resolveTelegramContainerResourceLimits(config = {}, isolationBackend = '') {
  const docker = isolationBackend === 'docker';
  const configuredMemory = config.containerMemory || getenv('TELEGRAM_CONTAINER_MEMORY', '');
  const limits = normalizeContainerResourceLimits({
    cpu: config.containerCpu || getenv('TELEGRAM_CONTAINER_CPU', ''),
    memory: configuredMemory || (docker ? DEFAULT_DOCKER_TASK_MEMORY : ''),
    disk: config.containerDisk || getenv('TELEGRAM_CONTAINER_DISK', ''),
    memoryAfterOom: docker ? resolveMemoryAfterOom(config, Boolean(configuredMemory)) : '',
  });
  if (!hasContainerResourceLimits(limits)) return { limits, summary: null };
  if (!docker) throw new Error('--container-cpu, --container-memory, and --container-disk require --isolation docker');
  return { limits, summary: `CPU=${limits.cpu || 'unlimited'}, RAM=${limits.memory || 'unlimited'}, RAM after OOM=${limits.memoryAfterOom || 'unchanged'}, disk=${limits.disk || 'unlimited'}` };
}

export function initializeTelegramContainerResourceLimits(config = {}, isolationBackend = '', { log = console.log, logError = console.error, exit = code => process.exit(code) } = {}) {
  try {
    const result = resolveTelegramContainerResourceLimits(config, isolationBackend);
    if (result.summary) log(`📏 Docker task limits enabled: ${result.summary}`);
    return result.limits;
  } catch (error) {
    logError(`Error: Invalid container resource limit: ${error?.message || error}`);
    exit(1);
    return { cpu: null, memory: null, disk: null, memoryAfterOom: null };
  }
}
