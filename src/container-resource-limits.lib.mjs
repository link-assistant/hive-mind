/**
 * Optional resource limits for Docker-isolated work sessions (issue #449).
 *
 * CPU and memory are enforced by Docker. Writable-layer disk usage is sampled
 * by the session monitor because Docker does not expose a portable per-container
 * storage quota for every storage driver.
 *
 * A percentage may be a range (`90%-100%`): each launch then picks its own
 * value inside it, so tasks started together do not all hit the same ceiling at
 * the same moment (issue #2803).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const DECIMAL_UNITS = Object.freeze({ b: 1, kb: 1000, mb: 1000 ** 2, gb: 1000 ** 3, tb: 1000 ** 4 });
const BINARY_UNITS = Object.freeze({ kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 });

function normalizeOptionalValue(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

const PERCENTAGE_RANGE_RE = /^(\d+(?:\.\d+)?)\s*%\s*-\s*(\d+(?:\.\d+)?)\s*%$/;

function checkPercentage(numeric, label) {
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 100) {
    throw new Error(`${label} percentage must be between 0 and 100`);
  }
  return numeric;
}

/** `25%` → `{value: 25, max: 25}`; `90%-100%` → `{value: 90, max: 100}`; anything else → null. */
function parsePercentage(value, label) {
  if (!value?.endsWith('%')) return null;
  const range = PERCENTAGE_RANGE_RE.exec(value);
  if (range) {
    const min = checkPercentage(Number(range[1]), label);
    const max = checkPercentage(Number(range[2]), label);
    if (min > max) throw new Error(`${label} percentage range '${value}' must go from the lower to the higher value`);
    return { value: min, max };
  }
  const numeric = checkPercentage(Number(value.slice(0, -1).trim()), label);
  return { value: numeric, max: numeric };
}

function parseCpuCores(value) {
  const percentage = parsePercentage(value, 'CPU');
  if (percentage !== null) return { kind: 'percentage', ...percentage };
  if (!/^\d+(?:\.\d+)?$/.test(value || '')) throw new Error(`Invalid CPU limit '${value}'. Use a positive core count or percentage`);
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error('CPU limit must be greater than zero');
  return { kind: 'fixed', value: numeric };
}

function parseBytes(value, label) {
  const percentage = parsePercentage(value, label);
  if (percentage !== null) return { kind: 'percentage', ...percentage };
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb|kib|mib|gib|tib|k|m|g|t)$/i.exec(value || '');
  if (!match) throw new Error(`Invalid ${label.toLowerCase()} limit '${value}'. Use a byte size such as 512MiB or a percentage`);
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`${label} limit must be greater than zero`);
  const unit = match[2].toLowerCase();
  const bytes = numeric * (DECIMAL_UNITS[unit] || BINARY_UNITS[unit]);
  if (!Number.isSafeInteger(Math.floor(bytes)) || bytes < 1) throw new Error(`${label} limit is outside the supported range`);
  return { kind: 'fixed', value: Math.floor(bytes) };
}

function resolveValue(parsed, capacity, label, { integer = true, random = Math.random } = {}) {
  if (!parsed) return null;
  if (parsed.kind === 'fixed') return parsed.value;
  if (!Number.isFinite(capacity) || capacity <= 0) throw new Error(`Cannot resolve the ${label.toLowerCase()} percentage because host capacity is unavailable`);
  const span = parsed.max > parsed.value ? parsed.max - parsed.value : 0;
  const draw = span > 0 ? Math.min(Math.max(Number(random()) || 0, 0), 1) : 0;
  const resolved = (capacity * (parsed.value + span * draw)) / 100;
  return integer ? Math.floor(resolved) : resolved;
}

/**
 * Validate limit strings without introducing implicit defaults.
 * `memoryAfterOom` is the RAM limit for a session restarted after an
 * out-of-memory kill (issue #2803); it never applies to a first launch.
 */
export function normalizeContainerResourceLimits(input = {}) {
  const normalized = {
    cpu: normalizeOptionalValue(input?.cpu),
    memory: normalizeOptionalValue(input?.memory),
    disk: normalizeOptionalValue(input?.disk),
    memoryAfterOom: normalizeOptionalValue(input?.memoryAfterOom),
  };
  if (normalized.cpu) parseCpuCores(normalized.cpu);
  if (normalized.memory) parseBytes(normalized.memory, 'Memory');
  if (normalized.disk) parseBytes(normalized.disk, 'Disk');
  if (normalized.memoryAfterOom) parseBytes(normalized.memoryAfterOom, 'Memory after OOM');
  return normalized;
}

export function hasContainerResourceLimits(input = {}) {
  const normalized = normalizeContainerResourceLimits(input);
  return Boolean(normalized.cpu || normalized.memory || normalized.disk);
}

/**
 * The limits for a session restarted after a kill: after an out-of-memory
 * kill the RAM limit becomes `memoryAfterOom` when one is configured, so the
 * restarted task is the first to give way if memory runs short again (issue
 * #2803). Returns `{limits, changed}`; `limits` is null when none were set.
 *
 * @param {Object|null} requested - The session's requested limits (`containerResourceLimits.requested`)
 * @param {{outOfMemory?: boolean}} [options]
 */
export function selectRecoveryContainerResourceLimits(requested, { outOfMemory = false } = {}) {
  if (!requested) return { limits: null, changed: false };
  // Anything but a valid post-OOM limit passes through untouched: a recovery
  // must never fail on limits an older version persisted.
  const memoryAfterOom = outOfMemory ? normalizeOptionalValue(requested.memoryAfterOom) : null;
  if (!memoryAfterOom) return { limits: requested, changed: false };
  try {
    parseBytes(memoryAfterOom, 'Memory after OOM');
  } catch {
    return { limits: requested, changed: false };
  }
  return { limits: { ...requested, memory: memoryAfterOom }, changed: true };
}

/** Resource controls apply only to commands whose effective backend is Docker. */
export function selectContainerResourceLimitsForBackend(backend, limits) {
  return backend === 'docker' ? limits : null;
}

/** Host capacity used to resolve percentage limits at task launch time. */
export function getContainerResourceCapacity({ osImpl = os, fsImpl = fs, diskPath = '/' } = {}) {
  const cpuCores = typeof osImpl.availableParallelism === 'function' ? osImpl.availableParallelism() : osImpl.cpus().length;
  const stat = fsImpl.statfsSync(diskPath);
  return {
    cpuCores,
    memoryBytes: osImpl.totalmem(),
    diskBytes: Number(stat.bavail) * Number(stat.bsize),
  };
}

/**
 * @param {Object} input - Requested limits
 * @param {{cpuCores?: number, memoryBytes?: number, diskBytes?: number}} capacity
 * @param {{random?: Function}} [options] - `random` picks the value inside a percentage range
 */
export function resolveContainerResourceLimits(input = {}, capacity, { random = Math.random } = {}) {
  const requested = normalizeContainerResourceLimits(input);
  const cpu = requested.cpu ? parseCpuCores(requested.cpu) : null;
  const memory = requested.memory ? parseBytes(requested.memory, 'Memory') : null;
  const disk = requested.disk ? parseBytes(requested.disk, 'Disk') : null;
  return {
    cpuCores: resolveValue(cpu, capacity?.cpuCores, 'CPU', { integer: false, random }),
    memoryBytes: resolveValue(memory, capacity?.memoryBytes, 'Memory', { random }),
    diskBytes: resolveValue(disk, capacity?.diskBytes, 'Disk', { random }),
    requested,
  };
}

function formatDockerCpu(value) {
  return Number(value.toFixed(6)).toString();
}

/** Arguments for the limits Docker can change on an already-created container. */
export function buildDockerUpdateArgs(resolved = {}) {
  const args = [];
  if (Number.isFinite(resolved.cpuCores)) args.push('--cpus', formatDockerCpu(resolved.cpuCores));
  if (Number.isFinite(resolved.memoryBytes)) args.push('--memory', String(resolved.memoryBytes), '--memory-swap', String(resolved.memoryBytes));
  return args.length ? ['update', ...args] : [];
}

export async function runDockerResourceCommand(args, { spawnImpl = spawn } = {}) {
  return new Promise(resolve => {
    const child = spawnImpl('docker', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', error => resolve({ success: false, error: error.message }));
    child.on('close', code => resolve({ success: code === 0, error: code === 0 ? null : stderr.trim() || `docker exited with code ${code}` }));
  });
}

/** Apply CPU/RAM limits while the task command remains behind its start gate. */
export async function applyDockerContainerResourceLimits(containerName, input = {}, options = {}) {
  try {
    const requested = normalizeContainerResourceLimits(input);
    const capacity = options.capacity || getContainerResourceCapacity(options);
    const resolved = resolveContainerResourceLimits(requested, capacity, { random: options.random });
    const args = buildDockerUpdateArgs(resolved);
    if (options.verbose) console.log(`[VERBOSE] Docker limits for ${containerName}: requested ${JSON.stringify(requested)} → cpuCores=${resolved.cpuCores ?? 'unlimited'} memoryBytes=${resolved.memoryBytes ?? 'unlimited'} diskBytes=${resolved.diskBytes ?? 'unlimited'}`);
    if (args.length === 0) return { success: true, error: null, resolved };
    const result = await (options.runDocker || runDockerResourceCommand)([...args, containerName]);
    if (!result?.success) return { success: false, error: `Could not apply Docker resource limits: ${result?.error || 'unknown Docker error'}`, resolved };
    return { success: true, error: null, resolved };
  } catch (error) {
    return { success: false, error: error?.message || String(error), resolved: null };
  }
}

export function detectContainerDiskLimitBreach({ limitBytes, observedBytes } = {}) {
  if (!Number.isFinite(limitBytes) || !Number.isFinite(observedBytes) || observedBytes <= limitBytes) return null;
  return { resource: 'disk', limitBytes, observedBytes };
}
