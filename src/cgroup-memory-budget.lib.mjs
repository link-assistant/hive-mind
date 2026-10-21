/**
 * Memory a process can really use inside its cgroup (issue #2838).
 *
 * `/proc/meminfo` describes the host even inside a Docker task, so the memory
 * preflight printed "11117MB available, swap: 4095MB" in a container capped at
 * 2.92 GiB with no swap. The kernel OOM killer acts on the cgroup, so the
 * usable memory is min(host available, memory.max - memory.current), and the
 * usable swap is capped by memory.swap.max.
 */
import fs from 'node:fs';
import { readCgroupMemory } from './solve.resource-diagnostics.lib.mjs';

const MiB = 1024 * 1024;

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function toMB(bytes) {
  return Math.floor(Math.max(0, bytes) / MiB);
}

/** `/proc/meminfo` as `{ MemFree: <kB>, ... }`. */
export function parseMeminfo(text) {
  const values = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = line.match(/^(\w+):\s+(\d+)/);
    if (match) values[match[1]] = Number.parseInt(match[2], 10);
  }
  return values;
}

/**
 * Host and cgroup memory combined into the values the preflight checks.
 *
 * Host available memory uses the same sum as `free`
 * (MemFree + Buffers + Cached + SReclaimable).
 *
 * @param {{meminfo?: object, cgroup?: object|null}} input
 */
export function computeEffectiveMemory({ meminfo = {}, cgroup = null } = {}) {
  const kB = key => (Number.isFinite(meminfo[key]) ? meminfo[key] * 1024 : 0);
  const hostAvailableBytes = kB('MemFree') + kB('Buffers') + kB('Cached') + kB('SReclaimable');
  const hostSwapTotalBytes = kB('SwapTotal');
  const hostSwapFreeBytes = Math.min(kB('SwapFree'), hostSwapTotalBytes);

  const limitBytes = finite(cgroup?.limitBytes);
  const currentBytes = finite(cgroup?.currentBytes) ?? 0;
  const headroomBytes = limitBytes === null ? null : Math.max(0, limitBytes - currentBytes);
  const availableBytes = headroomBytes === null ? hostAvailableBytes : Math.min(hostAvailableBytes, headroomBytes);

  const swapLimitBytes = finite(cgroup?.swapLimitBytes);
  const swapCurrentBytes = finite(cgroup?.swapCurrentBytes) ?? 0;
  const swapTotalBytes = swapLimitBytes === null ? hostSwapTotalBytes : Math.min(hostSwapTotalBytes, swapLimitBytes);
  const swapUsedBytes = swapLimitBytes === null ? hostSwapTotalBytes - hostSwapFreeBytes : Math.min(swapCurrentBytes, swapTotalBytes);
  const swapAvailableBytes = swapLimitBytes === null ? hostSwapFreeBytes : Math.min(hostSwapFreeBytes, Math.max(0, swapLimitBytes - swapCurrentBytes));

  const availableMB = toMB(availableBytes);
  const swapAvailableMB = toMB(swapAvailableBytes);
  return {
    availableMB,
    hostAvailableMB: toMB(hostAvailableBytes),
    swapTotalMB: toMB(swapTotalBytes),
    swapUsedMB: toMB(swapUsedBytes),
    swapAvailableMB,
    hostSwapTotalMB: toMB(hostSwapTotalBytes),
    totalAvailableMB: availableMB + swapAvailableMB,
    limitedBy: headroomBytes !== null && headroomBytes < hostAvailableBytes ? 'cgroup' : 'host',
    cgroup:
      limitBytes === null
        ? null
        : {
            version: cgroup.version,
            limitMB: toMB(limitBytes),
            currentMB: toMB(currentBytes),
            swapLimitMB: swapLimitBytes === null ? null : toMB(swapLimitBytes),
          },
  };
}

/** Swap text for logs: `4095MB (0MB used)`, `none`, or why the host swap is not usable. */
export function formatSwap(effective) {
  if (effective.swapTotalMB > 0) return `${effective.swapTotalMB}MB (${effective.swapUsedMB}MB used)`;
  if (effective.cgroup?.swapLimitMB === 0 && effective.hostSwapTotalMB > 0) return 'none (memory.swap.max is 0)';
  return 'none';
}

/** Which limit applied, for the preflight line; empty when the cgroup has no memory limit. */
export function describeMemoryLimit(effective) {
  const cgroup = effective?.cgroup;
  if (!cgroup) return '';
  if (effective.limitedBy === 'cgroup') return `limited by cgroup v${cgroup.version} memory.max (${cgroup.limitMB}MB limit, ${cgroup.currentMB}MB used); host: ${effective.hostAvailableMB}MB available`;
  return `limited by host memory; cgroup v${cgroup.version} limit ${cgroup.limitMB}MB (${cgroup.currentMB}MB used)`;
}

/** One line for the "System resources" logs. */
export function formatMemorySummary(effective) {
  const cgroup = effective?.cgroup;
  if (!cgroup) return `Memory: ${effective.availableMB}MB available, swap: ${formatSwap(effective)}`;
  return `Container memory (cgroup v${cgroup.version}): ${effective.availableMB}MB available of ${cgroup.limitMB}MB limit (${cgroup.currentMB}MB used), swap: ${formatSwap(effective)}; host: ${effective.hostAvailableMB}MB available`;
}

/** Current reading from `/proc/meminfo` and the own cgroup; `null` outside Linux or when meminfo is unreadable. */
export function readEffectiveMemory({ readFileSync = fs.readFileSync, platform = process.platform } = {}) {
  if (platform !== 'linux') return null;
  let meminfoText;
  try {
    meminfoText = String(readFileSync('/proc/meminfo', 'utf8')); // hive-sync-ok: procfs read served from memory, no disk wait
  } catch {
    return null;
  }
  let cgroup;
  try {
    cgroup = readCgroupMemory(readFileSync, platform); // hive-sync-ok: cgroupfs reads served from memory, no disk wait
  } catch {
    cgroup = null;
  }
  return computeEffectiveMemory({ meminfo: parseMeminfo(meminfoText), cgroup });
}
