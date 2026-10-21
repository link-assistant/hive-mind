/**
 * Effective per-task resource limits for the queue's `Starting:` log (issue #3048).
 *
 * The Telegram bot resolves its Docker task limits once at startup and
 * registers them here, so the queue can name the CPU/RAM/disk limits a task
 * starts with (and show when it starts without any) without the queue having
 * to know about isolation backends.
 */
import { getContainerResourceCapacity, resolveContainerResourceLimits } from './container-resource-limits.lib.mjs';

let configured = null;

/** Register the bot's isolation backend and Docker task limits; `null` clears them. */
export function configureQueueTaskLimits(settings = null) {
  configured = settings ? { isolationBackend: settings.isolationBackend || '', containerResourceLimits: settings.containerResourceLimits || null, capacity: settings.capacity || null } : null;
}

function formatGiB(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

function formatLimit(requested, resolved, format) {
  if (!requested) return 'unlimited';
  if (!Number.isFinite(resolved) || !requested.endsWith('%')) return requested;
  return `${requested} (${format(resolved)})`;
}

/** Human-readable limits, e.g. `CPU=50% (3 CPUs), RAM=60% (9.6 GiB), reservation=25% (4.0 GiB), disk=unlimited`. */
export function formatQueueTaskLimits(limits = {}, capacity = null) {
  let resolved;
  try {
    resolved = capacity ? resolveContainerResourceLimits(limits, capacity) : {};
  } catch {
    resolved = {};
  }
  const parts = [`CPU=${formatLimit(limits.cpu, resolved.cpuCores, value => `${Number(value.toFixed(2))} CPUs`)}`, `RAM=${formatLimit(limits.memory, resolved.memoryBytes, formatGiB)}`];
  if (limits.memoryReservation) parts.push(`reservation=${formatLimit(limits.memoryReservation, resolved.memoryReservationBytes, formatGiB)}`);
  parts.push(`disk=${formatLimit(limits.disk, resolved.diskBytes, formatGiB)}`);
  return parts.join(', ');
}

/** Suffix for the `Starting:` log line; empty until the bot registered its settings. */
export function describeQueueTaskLimits(item, { capacityProvider = getContainerResourceCapacity } = {}) {
  if (!configured) return '';
  const backend = item?.perCommandIsolation || configured.isolationBackend;
  if (!backend) return ' [limits: none (no isolation)]';
  if (backend !== 'docker') return ` [limits: none (${backend} isolation)]`;
  let capacity = configured.capacity;
  try {
    capacity = capacity || capacityProvider();
  } catch {
    capacity = null;
  }
  return ` [limits: ${formatQueueTaskLimits(configured.containerResourceLimits || {}, capacity)}]`;
}
