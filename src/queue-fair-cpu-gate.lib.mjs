/**
 * Fair CPU gate for the Telegram queue (issue #3048).
 *
 * The queue's CPU gate compares the host 5-minute load with a threshold. A
 * Docker task that is busy at its own `--cpus` cap shows up in that load, so
 * without this module one CPU-heavy task holds the gate closed for every tool
 * queue until it ends.
 *
 * The CPU a capped task already uses is reserved for it: the gate compares the
 * load that is *not* from capped tasks with the capacity the capped tasks
 * cannot take. Usage comes from the `docker stats` samples the CPU penalty
 * pass (#2801) stores in `sessionInfo.cpuPenalty.samples`. Without samples the
 * raw host ratio decides, as before. The fair ratio is never higher than the
 * raw ratio, so it can only let work start that the raw gate would block.
 */

// A sample older than this means the monitor stopped sampling the session.
export const FAIR_CPU_SAMPLE_MAX_AGE_MS = 2 * 60 * 1000;
// Same span as the load average the gate reads (loadAvg5).
export const FAIR_CPU_USAGE_WINDOW_MS = 5 * 60 * 1000;

function finitePositive(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isRunningDockerSession(sessionInfo) {
  return sessionInfo?.isolationBackend === 'docker' && !sessionInfo.completionNotifiedAt && !sessionInfo.containerResourceLimitExceeded;
}

/** CPUs the session can use at most: its penalty cap while penalized, else its `--cpus` limit; null when uncapped. */
export function getSessionCpuCap(sessionInfo, hostCpus = Infinity) {
  const penalty = sessionInfo?.cpuPenalty;
  const penaltyCap = penalty?.phase === 'penalized' ? finitePositive(penalty.limitCpus) : null;
  const limitCap = finitePositive(sessionInfo?.containerResourceLimits?.cpuCores);
  const caps = [penaltyCap, limitCap].filter(value => value !== null);
  if (caps.length === 0) return null;
  const cap = Math.min(...caps);
  return Number.isFinite(hostCpus) && hostCpus > 0 ? Math.min(cap, hostCpus) : cap;
}

/**
 * Recent CPU use of every running, capped Docker session.
 *
 * @param {Array<{sessionName: string, sessionInfo: object}>} entries
 * @returns {{tasks: Array<{sessionName: string, capCpus: number, usageCores: number}>, reservedCores: number, cappedCpus: number}}
 */
export function summarizeCappedTaskCpu(entries = [], { now = Date.now(), hostCpus = Infinity, maxSampleAgeMs = FAIR_CPU_SAMPLE_MAX_AGE_MS, windowMs = FAIR_CPU_USAGE_WINDOW_MS } = {}) {
  const tasks = [];
  for (const { sessionName, sessionInfo } of entries || []) {
    if (!isRunningDockerSession(sessionInfo)) continue;
    const capCpus = getSessionCpuCap(sessionInfo, hostCpus);
    if (capCpus === null) continue;
    const samples = (sessionInfo.cpuPenalty?.samples || []).filter(sample => Number.isFinite(sample?.at) && Number.isFinite(sample?.cores) && sample.at <= now);
    if (samples.length === 0) continue;
    const newest = Math.max(...samples.map(sample => sample.at));
    if (now - newest > maxSampleAgeMs) continue;
    const recent = samples.filter(sample => sample.at >= now - windowMs);
    const average = recent.reduce((sum, sample) => sum + sample.cores, 0) / recent.length;
    tasks.push({ sessionName, capCpus, usageCores: Math.min(Math.max(0, average), capCpus) });
  }
  return {
    tasks,
    reservedCores: tasks.reduce((sum, task) => sum + task.usageCores, 0),
    cappedCpus: tasks.reduce((sum, task) => sum + task.capCpus, 0),
  };
}

/**
 * Raw and fair CPU usage ratios for the queue gate.
 *
 * fair = (load not from capped tasks) / (CPUs the capped tasks cannot use).
 * When the capped tasks can fill the host, the fair ratio is not defined and
 * the raw ratio decides.
 */
export function computeFairCpuUsage({ loadAvg5, cpuCount, tasks = [] } = {}) {
  const rawRatio = loadAvg5 / cpuCount;
  const reservedCores = tasks.reduce((sum, task) => sum + Math.min(task.usageCores, task.capCpus), 0);
  const cappedCpus = tasks.reduce((sum, task) => sum + task.capCpus, 0);
  const freeCpus = cpuCount - cappedCpus;
  const fairRatio = tasks.length > 0 && freeCpus > 0 ? Math.max(0, loadAvg5 - reservedCores) / freeCpus : null;
  const effectiveRatio = fairRatio === null ? rawRatio : Math.min(rawRatio, fairRatio);
  return { rawRatio, fairRatio, effectiveRatio, reservedCores, cappedCpus, taskCount: tasks.length };
}

/** Verbose-log suffix that shows why the fair ratio differs from the raw one. */
export function formatFairCpuUsage(fair) {
  if (!fair?.taskCount) return '';
  const fairText = fair.fairRatio === null ? 'n/a (capped tasks can fill the host)' : `${Math.round(Math.min(1, fair.fairRatio) * 100)}%`;
  return `, capped tasks: ${fair.taskCount} using ${fair.reservedCores.toFixed(2)} of ${fair.cappedCpus.toFixed(2)} CPUs, fair usage: ${fairText}`;
}

/** Live summary from the session monitor; empty when it is not loaded or fails. */
export async function getCappedTaskCpu(verbose = false, { hostCpus = Infinity, now = Date.now() } = {}) {
  try {
    const { listTrackedSessionEntries } = await import('./session-monitor.lib.mjs');
    return summarizeCappedTaskCpu(listTrackedSessionEntries(), { now, hostCpus });
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] /queue: fair CPU gate has no session data: ${error?.message || error}`);
    return { tasks: [], reservedCores: 0, cappedCpus: 0 };
  }
}
