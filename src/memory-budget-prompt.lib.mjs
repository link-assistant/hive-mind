/**
 * Container memory budget guidance for every AI tool's prompt (issues #2745, #2838).
 *
 * Inside a Docker task `free`, `top` and `/proc/meminfo` show the host, so an
 * agent that saw "7 GB available" retried `cargo test -j 2` next to a subagent
 * and the whole cgroup was OOM-killed. When the task's cgroup has a memory
 * limit, the prompt names it and asks for sequential, low-parallelism builds.
 */
import { readCgroupMemory } from './solve.resource-diagnostics.lib.mjs';

const gib = bytes => `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
const hasFiniteLimit = snapshot => Number.isFinite(snapshot?.limitBytes) && snapshot.limitBytes > 0;

/** The guidance as separate sentences; empty without a finite cgroup memory limit. */
export function buildMemoryBudgetGuidance(snapshot) {
  if (!hasFiniteLimit(snapshot)) return [];
  const guidance = [`The container memory limit is ${gib(snapshot.limitBytes)} (${snapshot.limitBytes} bytes), shared by the agent, its subagents and all build/test subprocesses.`];
  if (Number.isFinite(snapshot.currentBytes)) guidance.push(`Current use is ${gib(snapshot.currentBytes)}; available headroom is ${gib(Math.max(0, snapshot.limitBytes - snapshot.currentBytes))}.`);
  guidance.push('Host free memory does not override this limit: free, top and /proc/meminfo show the host, not the container.', 'Run memory-heavy commands sequentially, use CARGO_BUILD_JOBS=1 / cargo -j 1 for Rust builds (make -j1 and similar elsewhere), and prefer focused test targets.', 'Do not run builds or test suites in the background or at the same time as subagents.', 'A single compiler can still exceed the budget: measure memory, reduce compiler/debug settings where appropriate, and stop repeating a build that is killed; use an adequately provisioned CI runner for remaining validation.');
  return guidance;
}

/** One paragraph, joined into the Codex prompt (moved here from codex.process-exit.lib.mjs). */
export function buildMemoryBudgetPrompt(snapshot) {
  const guidance = buildMemoryBudgetGuidance(snapshot);
  return guidance.length ? `Execution resource budget: ${guidance.join(' ')}` : '';
}

export const buildCodexMemoryBudgetPrompt = buildMemoryBudgetPrompt;

/**
 * System prompt section for claude, agent, gemini, opencode and qwen.
 * `params.cgroupMemory` overrides the live reading (tests, replays).
 */
export function getMemoryBudgetSubPrompt(params = {}, reader = readCgroupMemory) {
  let snapshot = params?.cgroupMemory;
  if (snapshot === undefined) {
    try {
      snapshot = reader();
    } catch {
      snapshot = null;
    }
  }
  const guidance = buildMemoryBudgetGuidance(snapshot);
  if (!guidance.length) return '';
  return `\n\nExecution resource budget.\n${guidance.map(line => `   - ${line}`).join('\n')}`;
}
