/**
 * Memory budget prompts module
 *
 * Tells the AI tool how much memory its container really has and how to keep
 * builds and tests inside it. Without this, an agent reads host memory from
 * free or /proc/meminfo, runs cmake --build --parallel (an unlimited make -j),
 * and the kernel OOM killer ends the whole session with exit code 137.
 *
 * The text is placed inside double-quoted shell arguments by some tools, so it
 * must not contain dollar signs, backticks or double quotes.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3125
 * @see https://github.com/link-assistant/hive-mind/issues/2838
 */

import os from 'node:os';

import { readCgroupMemory } from './solve.resource-diagnostics.lib.mjs';

const GIB = 1024 ** 3;
// Kept for the agent itself (the AI tool process, git, shells).
const AGENT_RESERVE_BYTES = GIB;
// A typical C++/Rust compiler process at default optimization and debug info.
const BYTES_PER_BUILD_JOB = 0.75 * GIB;

const gib = bytes => `${(bytes / GIB).toFixed(2)} GiB`;
const finiteLimit = snapshot => Number.isFinite(snapshot?.limitBytes) && snapshot.limitBytes > 0;

const defaultCpuCount = () => (typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length) || 1;

/**
 * Suggest how many parallel build or test jobs fit in a memory limit.
 *
 * @param {number} limitBytes - cgroup memory limit in bytes
 * @param {number} [cpuCount] - upper bound on useful jobs
 * @returns {number} At least 1, at most cpuCount
 */
export function suggestBuildJobs(limitBytes, cpuCount = defaultCpuCount()) {
  const maxJobs = Math.max(1, Math.floor(Number(cpuCount) || 1));
  if (!Number.isFinite(limitBytes) || limitBytes <= 0) return maxJobs;
  const byMemory = Math.floor((limitBytes - AGENT_RESERVE_BYTES) / BYTES_PER_BUILD_JOB);
  return Math.min(maxJobs, Math.max(1, byMemory));
}

/**
 * Build the memory budget guideline lines for the General guidelines section.
 *
 * Only the limit is used, not current usage, so the prompt is identical for
 * every build of it within one container.
 *
 * @param {Object} [options]
 * @param {Object|null} [options.snapshot] - Result of readCgroupMemory()
 * @param {number} [options.cpuCount] - Available CPUs
 * @returns {string} The formatted sub-prompt
 */
export const getMemoryBudgetSubPrompt = ({ snapshot = readCgroupMemory(), cpuCount = defaultCpuCount() } = {}) => {
  const lines = [];
  let jobs = 'an explicit, small job count';
  let n = 2;
  if (finiteLimit(snapshot)) {
    n = suggestBuildJobs(snapshot.limitBytes, cpuCount);
    jobs = `an explicit job count of at most ${n} here`;
    lines.push(`   - This container has a memory limit of ${gib(snapshot.limitBytes)} (cgroup memory.max), shared by you, the AI tool process and every build or test subprocess. When it is exceeded, the kernel kills a process, possibly the AI tool itself, and the session ends with exit code 137.`);
  } else {
    lines.push('   - Builds and tests share memory with you, the AI tool process. When a container memory limit is exceeded, the kernel kills a process, possibly the AI tool itself, and the session ends with exit code 137.');
  }
  lines.push('   - When you check memory, read /sys/fs/cgroup/memory.max and /sys/fs/cgroup/memory.current; free, top and /proc/meminfo show host memory, not the container limit.');
  lines.push(`   - When you run parallel builds or tests, always give ${jobs}, for example make -j${n}, cmake --build build --parallel ${n}, ninja -j${n}, ctest -j${n} or cargo build -j ${n}. A bare make -j or cmake --build --parallel without a number starts unlimited jobs, and CMAKE_BUILD_PARALLEL_LEVEL does not cap --parallel without a number.`);
  lines.push('   - When you run memory-heavy builds or test suites, run them one at a time, not alongside each other or alongside subagents. When a build is killed (exit code 137 or signal 9), retry with fewer jobs, down to 1, and narrower targets instead of repeating the same command.');
  return lines.join('\n');
};

export default {
  getMemoryBudgetSubPrompt,
  suggestBuildJobs,
};
