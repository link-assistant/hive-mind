/**
 * Cap `hive --concurrency` to the container memory limit (issue #2838).
 *
 * Every hive worker runs a full solve: the AI tool, its subagents and the
 * build/test commands they start. Inside a cgroup all workers share one
 * memory limit, so two workers in a 2.92 GiB container left each solve about
 * 1.5 GiB and the kernel OOM-killed them. Before the workers start, the
 * concurrency is lowered until each worker has at least the per-worker
 * minimum of the cgroup limit.
 */
import { readEffectiveMemory as readEffectiveMemoryDefault } from './cgroup-memory-budget.lib.mjs';

export const DEFAULT_MIN_MEMORY_PER_WORKER_MB = 2048;
export const MIN_MEMORY_PER_WORKER_ENV = 'HIVE_MIND_MIN_MEMORY_PER_WORKER';

function toNonNegativeNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/** `--min-memory-per-worker`, then HIVE_MIND_MIN_MEMORY_PER_WORKER, then 2048MB; 0 turns the cap off. */
export function resolveMinMemoryPerWorkerMB(argv = {}, env = process.env) {
  return toNonNegativeNumber(argv?.minMemoryPerWorker) ?? toNonNegativeNumber(env?.[MIN_MEMORY_PER_WORKER_ENV]) ?? DEFAULT_MIN_MEMORY_PER_WORKER_MB;
}

/**
 * The concurrency that gives every worker the minimum, never below 1.
 *
 * @param {{concurrency: number, effective: object|null, minPerWorkerMB: number}} input
 * @returns {{concurrency: number, requested: number, capped: boolean, belowMinimum: boolean, limitMB: number|null, perWorkerMB: number|null, minPerWorkerMB: number}}
 */
export function planConcurrencyForMemory({ concurrency, effective, minPerWorkerMB }) {
  const requested = Number.isInteger(concurrency) && concurrency > 0 ? concurrency : null;
  const limitMB = Number.isFinite(effective?.cgroup?.limitMB) && effective.cgroup.limitMB > 0 ? effective.cgroup.limitMB : null;
  const base = { concurrency: requested, requested, capped: false, belowMinimum: false, limitMB, perWorkerMB: null, minPerWorkerMB };
  if (requested === null || limitMB === null || !(minPerWorkerMB > 0)) return base;
  const perWorkerMB = Math.floor(limitMB / requested);
  if (perWorkerMB >= minPerWorkerMB) return { ...base, perWorkerMB };
  const fitting = Math.max(1, Math.floor(limitMB / minPerWorkerMB));
  return { ...base, perWorkerMB, concurrency: Math.min(requested, fitting), capped: fitting < requested, belowMinimum: limitMB < minPerWorkerMB };
}

/**
 * Lower `argv.concurrency` in place when the cgroup memory limit cannot hold
 * that many workers, and log why.
 */
export async function capConcurrencyForMemory({ argv, log = async () => {}, env = process.env, readEffectiveMemory = readEffectiveMemoryDefault }) {
  const minPerWorkerMB = resolveMinMemoryPerWorkerMB(argv, env);
  let effective;
  try {
    effective = readEffectiveMemory();
  } catch {
    effective = null;
  }
  const plan = planConcurrencyForMemory({ concurrency: argv?.concurrency, effective, minPerWorkerMB });
  if (plan.capped) {
    argv.concurrency = plan.concurrency;
    await log(`⚠️  --concurrency ${plan.requested} lowered to ${plan.concurrency}: the ${plan.limitMB}MB cgroup memory limit leaves ${plan.perWorkerMB}MB per worker, below the ${minPerWorkerMB}MB minimum (--min-memory-per-worker, ${MIN_MEMORY_PER_WORKER_ENV}; 0 turns the cap off).`, { level: 'warning' });
  }
  if (plan.belowMinimum) {
    await log(`⚠️  The ${plan.limitMB}MB cgroup memory limit is below the ${minPerWorkerMB}MB minimum for one worker; solves may be OOM-killed. Give the container more memory or lower --min-memory-per-worker.`, { level: 'warning' });
  }
  return plan;
}
