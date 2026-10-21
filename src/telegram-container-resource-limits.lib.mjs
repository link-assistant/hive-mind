/** Telegram startup adapter for Docker task resource limits (issue #449). */
import { getenv } from './cli-arguments.lib.mjs';
import { hasContainerResourceLimits, normalizeContainerResourceLimits } from './container-resource-limits.lib.mjs';
import { formatDockerCpuPenaltyConfig, normalizeDockerCpuPenaltyConfig } from './docker-cpu-penalty.lib.mjs';

// Issue #3125: a hard cap of 25% OOM-killed ordinary builds on small hosts
// (2.9 GiB of 11.7 GiB) while the rest of the RAM sat idle. The default is now
// a larger hard limit (60%, the safest value the issue proposes) plus a soft
// reservation of 25%: a task may burst into idle host RAM, and under host
// pressure the kernel reclaims tasks above their reservation first. Docker
// applies both before releasing each task's start gate (issue #2301).
// --container-memory / TELEGRAM_CONTAINER_MEMORY overrides both defaults.
export const DEFAULT_DOCKER_TASK_MEMORY = '60%';
export const DEFAULT_DOCKER_TASK_MEMORY_RESERVATION = '25%';
// Issue #3048: without a CPU cap one multi-core task reads as 100% host CPU and
// the queue's CPU gate blocks every tool queue until it ends.
export const DEFAULT_DOCKER_TASK_CPU = '50%';

function pick(configValue, envName) {
  return configValue || getenv(envName, '');
}

export function resolveTelegramContainerResourceLimits(config = {}, isolationBackend = '') {
  const docker = isolationBackend === 'docker';
  const explicitMemory = pick(config.containerMemory, 'TELEGRAM_CONTAINER_MEMORY');
  const limits = normalizeContainerResourceLimits({
    cpu: pick(config.containerCpu, 'TELEGRAM_CONTAINER_CPU') || (docker ? DEFAULT_DOCKER_TASK_CPU : ''),
    memory: explicitMemory || (docker ? DEFAULT_DOCKER_TASK_MEMORY : ''),
    // An explicit hard limit replaces the default pair; an explicit reservation is always kept.
    memoryReservation: pick(config.containerMemoryReservation, 'TELEGRAM_CONTAINER_MEMORY_RESERVATION') || (docker && !explicitMemory ? DEFAULT_DOCKER_TASK_MEMORY_RESERVATION : ''),
    disk: pick(config.containerDisk, 'TELEGRAM_CONTAINER_DISK'),
  });
  if (!hasContainerResourceLimits(limits)) return { limits, summary: null };
  if (!docker) throw new Error('--container-cpu, --container-memory, --container-memory-reservation, and --container-disk require --isolation docker');
  return { limits, summary: formatTelegramContainerResourceLimits(limits) };
}

export function formatTelegramContainerResourceLimits(limits = {}) {
  const reservation = limits.memoryReservation ? ` (reservation ${limits.memoryReservation})` : '';
  return `CPU=${limits.cpu || 'unlimited'}, RAM=${limits.memory || 'unlimited'}${reservation}, disk=${limits.disk || 'unlimited'}`;
}

export function initializeTelegramContainerResourceLimits(config = {}, isolationBackend = '', { log = console.log, warn = console.warn, logError = console.error, exit = code => process.exit(code) } = {}) {
  try {
    const result = resolveTelegramContainerResourceLimits(config, isolationBackend);
    if (result.summary) log(`📏 Docker task limits enabled: ${result.summary}`);
    // Issue #3048: an uncapped task can starve every queue behind the CPU gate.
    if (isolationBackend === 'docker' && !result.limits.cpu) warn('⚠️ Docker isolation runs tasks without a CPU limit (--container-cpu unlimited): one CPU-heavy task can block every tool queue behind the CPU gate. Set --container-cpu (default 50%) to cap each task.');
    return result.limits;
  } catch (error) {
    logError(`Error: Invalid container resource limit: ${error?.message || error}`);
    exit(1);
    return { cpu: null, memory: null, memoryReservation: null, disk: null };
  }
}

/** Issue #2801: CPU penalty settings; on by default, and only meaningful for Docker isolation. */
export function resolveTelegramDockerCpuPenalty(config = {}, isolationBackend = '') {
  const penalty = normalizeDockerCpuPenaltyConfig({
    enabled: config.containerCpuPenalty,
    penaltyCpus: config.containerCpuPenaltyCpus,
    triggerPercent: config.containerCpuPenaltyTrigger,
    triggerWindowMs: config.containerCpuPenaltyTriggerWindow,
    releasePercent: config.containerCpuPenaltyRelease,
    releaseWindowMs: config.containerCpuPenaltyReleaseWindow,
  });
  return isolationBackend === 'docker' ? penalty : { ...penalty, enabled: false };
}

export function initializeTelegramDockerCpuPenalty(config = {}, isolationBackend = '', { log = console.log, logError = console.error, exit = code => process.exit(code) } = {}) {
  try {
    const penalty = resolveTelegramDockerCpuPenalty(config, isolationBackend);
    if (isolationBackend === 'docker') log(`🐢 Docker task CPU penalty: ${formatDockerCpuPenaltyConfig(penalty)}`);
    return penalty;
  } catch (error) {
    logError(`Error: Invalid container CPU penalty setting: ${error?.message || error}`);
    exit(1);
    return { enabled: false };
  }
}
