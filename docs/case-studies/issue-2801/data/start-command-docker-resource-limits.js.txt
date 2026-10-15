/**
 * Docker resource limits that must survive a resume (issue #176).
 *
 * `docker commit` captures a container's filesystem and image config, but not
 * its HostConfig. A snapshot-based resume (`$ --resume <id> -- <cmd>`) used to
 * start the replacement container without the memory, CPU and PIDs limits the
 * original one had — limits a supervisor typically applied with
 * `docker update`, so they were never part of the stored launch options.
 *
 * This module reads the limits back out of `docker inspect` and translates the
 * non-default ones into `docker run` flags. The flags are kept in the
 * `--flag=value` form, so the same list is stored in the execution record,
 * shown in `[Isolation]` status lines, and spliced into `docker run` as is.
 */

const { getDockerCommand } = require('./docker-cleanup');

/** Docker's default `/dev/shm` size; only a different size is re-applied. */
const DEFAULT_SHM_SIZE = 64 * 1024 * 1024;

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;

/**
 * Format a byte count with the largest binary unit `docker run` accepts that
 * represents it exactly (`268435456` → `256m`).
 * @param {number} bytes - Byte count
 * @returns {string} Docker memory size
 */
function formatDockerBytes(bytes) {
  for (const [unit, size] of [
    ['g', GIB],
    ['m', MIB],
    ['k', KIB],
  ]) {
    if (bytes >= size && bytes % size === 0) {
      return `${bytes / size}${unit}`;
    }
  }
  return String(bytes);
}

/**
 * Format `NanoCpus` as the decimal `--cpus` value (`500000000` → `0.5`).
 * @param {number} nanoCpus - CPU quota in units of 1e-9 CPUs
 * @returns {string} Docker CPU count
 */
function formatDockerCpus(nanoCpus) {
  return String(Number((nanoCpus / 1e9).toFixed(9)));
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Translate an inspected `HostConfig` into `docker run` flags.
 *
 * Only limits that differ from Docker's defaults are emitted, and only in
 * combinations `docker run` accepts: `--memory-swap` needs `--memory`, and
 * `--cpus` cannot be combined with `--cpu-quota`/`--cpu-period`.
 *
 * @param {?object} hostConfig - `docker inspect` `.HostConfig`
 * @returns {string[]} Flags in `--flag=value` form
 */
function parseDockerResourceLimits(hostConfig) {
  if (!hostConfig || typeof hostConfig !== 'object') {
    return [];
  }
  const h = hostConfig;
  const limits = [];

  const memory = positive(h.Memory);
  if (memory) {
    limits.push(`--memory=${formatDockerBytes(memory)}`);
    const swap = Number(h.MemorySwap);
    if (swap === -1) {
      limits.push('--memory-swap=-1');
    } else if (positive(swap)) {
      limits.push(`--memory-swap=${formatDockerBytes(swap)}`);
    }
  }
  const reservation = positive(h.MemoryReservation);
  if (reservation) {
    limits.push(`--memory-reservation=${formatDockerBytes(reservation)}`);
  }

  const nanoCpus = positive(h.NanoCpus);
  if (nanoCpus) {
    limits.push(`--cpus=${formatDockerCpus(nanoCpus)}`);
  } else {
    const quota = positive(h.CpuQuota);
    if (quota) {
      limits.push(`--cpu-quota=${quota}`);
    }
    const period = positive(h.CpuPeriod);
    if (period) {
      limits.push(`--cpu-period=${period}`);
    }
  }
  const shares = positive(h.CpuShares);
  if (shares) {
    limits.push(`--cpu-shares=${shares}`);
  }
  const cpusetCpus = nonEmpty(h.CpusetCpus);
  if (cpusetCpus) {
    limits.push(`--cpuset-cpus=${cpusetCpus}`);
  }
  const cpusetMems = nonEmpty(h.CpusetMems);
  if (cpusetMems) {
    limits.push(`--cpuset-mems=${cpusetMems}`);
  }

  const pids = positive(h.PidsLimit);
  if (pids) {
    limits.push(`--pids-limit=${pids}`);
  }

  const shm = positive(h.ShmSize);
  if (shm && shm !== DEFAULT_SHM_SIZE) {
    limits.push(`--shm-size=${formatDockerBytes(shm)}`);
  }

  if (h.StorageOpt && typeof h.StorageOpt === 'object') {
    for (const key of Object.keys(h.StorageOpt).sort()) {
      const value = nonEmpty(String(h.StorageOpt[key] ?? ''));
      if (value) {
        limits.push(`--storage-opt=${key}=${value}`);
      }
    }
  }

  for (const ulimit of Array.isArray(h.Ulimits) ? h.Ulimits : []) {
    if (ulimit && nonEmpty(ulimit.Name)) {
      limits.push(`--ulimit=${ulimit.Name}=${ulimit.Soft}:${ulimit.Hard}`);
    }
  }

  return limits;
}

/**
 * Read a container's resource limits with `docker inspect`.
 * @param {string} containerName - Container to inspect
 * @param {Function} runner - `(command, args) => {success, stdout}`
 * @returns {?string[]} Flags, or null when the container could not be read
 */
function readDockerResourceLimits(containerName, runner) {
  let result;
  try {
    result = runner(getDockerCommand(), [
      'inspect',
      '--format',
      '{{json .HostConfig}}',
      containerName,
    ]);
  } catch {
    return null;
  }
  if (!result || !result.success) {
    return null;
  }
  try {
    return parseDockerResourceLimits(JSON.parse(String(result.stdout).trim()));
  } catch {
    return null;
  }
}

/**
 * Normalize a stored `resourceLimits` value to a list of flags.
 * @param {*} value - Value from an execution record or options object
 * @returns {string[]} Flags
 */
function normalizeResourceLimits(value) {
  if (Array.isArray(value)) {
    return value.map(String).filter((flag) => flag.startsWith('--'));
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return value.split(/\s+/).filter((flag) => flag.startsWith('--'));
  }
  return [];
}

/**
 * `[Isolation]` status line for resource limits, or null when there are none.
 * @param {*} value - Stored `resourceLimits`
 * @returns {?string} Status line
 */
function buildResourceLimitsStatusLine(value) {
  const limits = normalizeResourceLimits(value);
  return limits.length > 0
    ? `[Isolation] Resource limits: ${limits.join(' ')}`
    : null;
}

module.exports = {
  DEFAULT_SHM_SIZE,
  buildResourceLimitsStatusLine,
  formatDockerBytes,
  formatDockerCpus,
  normalizeResourceLimits,
  parseDockerResourceLimits,
  readDockerResourceLimits,
};
