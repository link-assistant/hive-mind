/**
 * Optional resource limits for Docker-isolated work sessions (issue #449).
 *
 * CPU and memory are enforced by Docker. Writable-layer disk usage is sampled
 * by the session monitor because Docker does not expose a portable per-container
 * storage quota for every storage driver.
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

function parsePercentage(value, label) {
  if (!value?.endsWith('%')) return null;
  const numeric = Number(value.slice(0, -1).trim());
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 100) {
    throw new Error(`${label} percentage must be between 0 and 100`);
  }
  return numeric;
}

function parseCpuCores(value) {
  const percentage = parsePercentage(value, 'CPU');
  if (percentage !== null) return { kind: 'percentage', value: percentage };
  if (!/^\d+(?:\.\d+)?$/.test(value || '')) throw new Error(`Invalid CPU limit '${value}'. Use a positive core count or percentage`);
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error('CPU limit must be greater than zero');
  return { kind: 'fixed', value: numeric };
}

function parseBytes(value, label) {
  const percentage = parsePercentage(value, label);
  if (percentage !== null) return { kind: 'percentage', value: percentage };
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb|kib|mib|gib|tib|k|m|g|t)$/i.exec(value || '');
  if (!match) throw new Error(`Invalid ${label.toLowerCase()} limit '${value}'. Use a byte size such as 512MiB or a percentage`);
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`${label} limit must be greater than zero`);
  const unit = match[2].toLowerCase();
  const bytes = numeric * (DECIMAL_UNITS[unit] || BINARY_UNITS[unit]);
  if (!Number.isSafeInteger(Math.floor(bytes)) || bytes < 1) throw new Error(`${label} limit is outside the supported range`);
  return { kind: 'fixed', value: Math.floor(bytes) };
}

function resolveValue(parsed, capacity, label, { integer = true } = {}) {
  if (!parsed) return null;
  if (parsed.kind === 'fixed') return parsed.value;
  if (!Number.isFinite(capacity) || capacity <= 0) throw new Error(`Cannot resolve the ${label.toLowerCase()} percentage because host capacity is unavailable`);
  const resolved = (capacity * parsed.value) / 100;
  return integer ? Math.floor(resolved) : resolved;
}

/** Validate limit strings without introducing implicit defaults. */
export function normalizeContainerResourceLimits(input = {}) {
  const normalized = {
    cpu: normalizeOptionalValue(input.cpu),
    memory: normalizeOptionalValue(input.memory),
    disk: normalizeOptionalValue(input.disk),
  };
  if (normalized.cpu) parseCpuCores(normalized.cpu);
  if (normalized.memory) parseBytes(normalized.memory, 'Memory');
  if (normalized.disk) parseBytes(normalized.disk, 'Disk');
  return normalized;
}

export function hasContainerResourceLimits(input = {}) {
  const normalized = normalizeContainerResourceLimits(input);
  return Boolean(normalized.cpu || normalized.memory || normalized.disk);
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

export function resolveContainerResourceLimits(input = {}, capacity) {
  const requested = normalizeContainerResourceLimits(input);
  const cpu = requested.cpu ? parseCpuCores(requested.cpu) : null;
  const memory = requested.memory ? parseBytes(requested.memory, 'Memory') : null;
  const disk = requested.disk ? parseBytes(requested.disk, 'Disk') : null;
  return {
    cpuCores: resolveValue(cpu, capacity?.cpuCores, 'CPU', { integer: false }),
    memoryBytes: resolveValue(memory, capacity?.memoryBytes, 'Memory'),
    diskBytes: resolveValue(disk, capacity?.diskBytes, 'Disk'),
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
    const resolved = resolveContainerResourceLimits(requested, capacity);
    const args = buildDockerUpdateArgs(resolved);
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
