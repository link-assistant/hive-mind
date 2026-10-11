/**
 * Container-aware memory budget (issue #2838).
 *
 * `/proc/meminfo`, `free` and `top` describe the *host*, even inside a docker
 * container. With hive-mind 2.34 containers capped at 2.92 GiB and no swap,
 * the memory preflight still reported 11 GB available plus 4 GB host swap,
 * Claude sized its builds from `free -g`, and `hive` started two workers in
 * the one small cgroup — so builds kept being killed by the OOM killer.
 *
 * Everything here works from the cgroup the kernel OOM killer acts on (read by
 * `readCgroupMemory`, issue #2498) and falls back to host values outside a
 * cgroup with a limit of its own.
 */

import { readCgroupMemory } from './solve.resource-diagnostics.lib.mjs';

const MiB = 1024 ** 2;

// A Rust/C++ build plus the agent itself rarely fits in less (issue #2838).
export const DEFAULT_MIN_MEMORY_PER_WORKER_MB = 2048;

const gib = bytes => `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
const mb = bytes => `${Math.floor(bytes / MiB)}MB`;
const finite = value => Number.isFinite(value);

/** True when the cgroup has a finite memory limit of its own. */
export const hasCgroupMemoryLimit = cgroup => finite(cgroup?.limitBytes) && cgroup.limitBytes > 0;

/**
 * Memory the next process can really use: `min(host available,
 * memory.max - memory.current)`, with swap limited to what the cgroup allows.
 *
 * @param {object} params
 * @param {number|null} params.hostAvailableBytes host available memory (from /proc/meminfo)
 * @param {number|null} [params.hostSwapTotalBytes]
 * @param {number|null} [params.hostSwapFreeBytes]
 * @param {ReturnType<typeof readCgroupMemory>} [params.cgroup]
 */
export function computeMemoryBudget({ hostAvailableBytes, hostSwapTotalBytes = null, hostSwapFreeBytes = null, cgroup = null }) {
  const host = { hostAvailableBytes, hostSwapTotalBytes, hostSwapFreeBytes };
  if (!hasCgroupMemoryLimit(cgroup)) {
    return { source: 'host', availableBytes: hostAvailableBytes, swapTotalBytes: hostSwapTotalBytes, swapFreeBytes: hostSwapFreeBytes, cgroup, ...host };
  }
  const headroomBytes = Math.max(0, cgroup.limitBytes - (finite(cgroup.currentBytes) ? cgroup.currentBytes : 0));
  const availableBytes = finite(hostAvailableBytes) ? Math.min(hostAvailableBytes, headroomBytes) : headroomBytes;
  let swapTotalBytes = hostSwapTotalBytes;
  let swapFreeBytes = hostSwapFreeBytes;
  if (finite(cgroup.swapLimitBytes)) {
    const swapHeadroom = Math.max(0, cgroup.swapLimitBytes - (finite(cgroup.swapCurrentBytes) ? cgroup.swapCurrentBytes : 0));
    swapTotalBytes = finite(hostSwapTotalBytes) ? Math.min(hostSwapTotalBytes, cgroup.swapLimitBytes) : cgroup.swapLimitBytes;
    swapFreeBytes = finite(hostSwapFreeBytes) ? Math.min(hostSwapFreeBytes, swapHeadroom) : swapHeadroom;
  }
  return { source: 'cgroup', availableBytes, headroomBytes, limitBytes: cgroup.limitBytes, currentBytes: cgroup.currentBytes, swapTotalBytes, swapFreeBytes, cgroup, ...host };
}

const limitFileName = cgroup => (cgroup.version === 1 ? 'memory.limit_in_bytes' : 'memory.max');
const swapFileName = cgroup => (cgroup.version === 1 ? 'memory.memsw.limit_in_bytes' : 'memory.swap.max');

/** One line naming the limit that applied, for the preflight log. */
export function describeMemoryBudgetSource(budget) {
  if (budget?.source !== 'cgroup') return null;
  const { cgroup } = budget;
  const used = finite(budget.currentBytes) ? `, ${mb(budget.currentBytes)} used` : '';
  const swap = finite(cgroup.swapLimitBytes) ? `; swap limited by ${swapFileName(cgroup)} to ${mb(cgroup.swapLimitBytes)}` : '';
  const host = finite(budget.hostAvailableBytes) ? `; host /proc/meminfo reports ${mb(budget.hostAvailableBytes)} available${finite(budget.hostSwapFreeBytes) ? ` and ${mb(budget.hostSwapFreeBytes)} swap free` : ''}, which does not apply here` : '';
  return `   Limit applied: container cgroup v${cgroup.version} ${limitFileName(cgroup)} = ${mb(budget.limitBytes)}${used}${swap} (${cgroup.path})${host}`;
}

/**
 * Replacement for the host `MemFree:` line in the "System resources
 * before/after execution" log, or null outside a limited cgroup.
 */
export function formatCgroupMemorySummary(cgroup) {
  if (!hasCgroupMemoryLimit(cgroup)) return null;
  const used = finite(cgroup.currentBytes) ? `${gib(cgroup.currentBytes)} used of ` : '';
  const headroom = finite(cgroup.currentBytes) ? `, ${gib(Math.max(0, cgroup.limitBytes - cgroup.currentBytes))} headroom` : '';
  const swap = cgroup.swapLimitBytes === 0 ? ', no swap' : finite(cgroup.swapLimitBytes) ? `, swap limit ${gib(cgroup.swapLimitBytes)}` : '';
  const kills = cgroup.oomKills > 0 ? `, OOM kills so far: ${cgroup.oomKills}` : '';
  return `container cgroup v${cgroup.version} ${used}${gib(cgroup.limitBytes)} ${limitFileName(cgroup)}${headroom}${swap}${kills} (host MemFree does not apply)`;
}

/**
 * Memory-budget guidance appended to every tool's prompt (Codex since #2745,
 * every tool since #2838). Empty outside a cgroup with a finite limit.
 */
export function buildMemoryBudgetPrompt(snapshot) {
  if (!hasCgroupMemoryLimit(snapshot)) return '';
  const current = finite(snapshot.currentBytes) ? ` Current use is ${gib(snapshot.currentBytes)}; available headroom is ${gib(Math.max(0, snapshot.limitBytes - snapshot.currentBytes))}.` : '';
  const swap = snapshot.swapLimitBytes === 0 ? ' There is no swap: a process that pushes the container over the limit is SIGKILLed (exit code 137) at once, and that can be the agent process itself.' : '';
  const kills = snapshot.oomKills > 0 ? ` Warning: the kernel OOM killer has already killed ${snapshot.oomKills} process(es) in this container — reduce memory use further before running another build or test.` : '';
  return [`Execution resource budget: the container memory limit is ${gib(snapshot.limitBytes)} (${snapshot.limitBytes} bytes), shared by the agent, its sub-agents and all build/test subprocesses.${current}${swap}${kills}`, 'Host free memory does not override this limit: free, top, htop and /proc/meminfo show the HOST, not this container — read /sys/fs/cgroup/memory.current and memory.max instead.', 'Run memory-heavy commands sequentially, never in the background alongside another build or alongside sub-agents that build or test. Build heavy crates one at a time with low parallelism: use CARGO_BUILD_JOBS=1 / cargo -j 1 for Rust builds, make -j1, and --runInBand / --maxWorkers=1 for JavaScript test runners; prefer focused test targets.', 'A single compiler can still exceed the budget: measure memory, reduce compiler/debug settings where appropriate, and stop repeating a build that is killed; use an adequately provisioned CI runner for remaining validation.'].join(' ');
}

/** Append the budget guidance to a prompt (unchanged outside a limited cgroup). */
export function appendMemoryBudgetPrompt(prompt, snapshot = readCgroupMemory()) {
  return [prompt, buildMemoryBudgetPrompt(snapshot)].filter(Boolean).join('\n\n');
}

/**
 * How many `hive` workers fit into the cgroup: every worker runs in the same
 * cgroup as hive itself, so `limit / workers` must stay above a per-worker
 * minimum. A minimum of 0 disables the cap.
 */
export function evaluateWorkerMemoryBudget({ concurrency, cgroup, minMemoryPerWorkerMB = DEFAULT_MIN_MEMORY_PER_WORKER_MB }) {
  const requested = Math.max(1, Math.floor(Number(concurrency) || 1));
  const minBytes = Number(minMemoryPerWorkerMB) * MiB;
  if (!hasCgroupMemoryLimit(cgroup) || !(minBytes > 0)) return { concurrency: requested, requested, capped: false, perWorkerBytes: null };
  const perWorkerBytes = cgroup.limitBytes / requested;
  const fitting = Math.max(1, Math.floor(cgroup.limitBytes / minBytes));
  return { concurrency: Math.min(requested, fitting), requested, capped: fitting < requested, perWorkerBytes, limitBytes: cgroup.limitBytes, minBytes, belowMinimum: perWorkerBytes < minBytes };
}

/** Cap `argv.concurrency` to the cgroup memory limit and log why. */
export async function applyHiveWorkerMemoryCap({ argv, log, cgroup = readCgroupMemory() }) {
  const result = evaluateWorkerMemoryBudget({ concurrency: argv.concurrency, cgroup, minMemoryPerWorkerMB: argv.minMemoryPerWorker ?? DEFAULT_MIN_MEMORY_PER_WORKER_MB });
  if (!result.belowMinimum) return result;
  const why = `container memory limit ${gib(result.limitBytes)} / ${result.requested} workers = ${gib(result.perWorkerBytes)} per worker, below --min-memory-per-worker ${mb(result.minBytes)}`;
  if (result.capped) {
    argv.concurrency = result.concurrency;
    await log(`⚠️  Concurrency capped from ${result.requested} to ${result.concurrency}: ${why}. All workers share this cgroup; pass --min-memory-per-worker 0 to keep ${result.requested}.`, { level: 'warning' });
  } else {
    await log(`⚠️  Low memory per worker: ${why}. Builds may be killed by the OOM killer.`, { level: 'warning' });
  }
  return result;
}
