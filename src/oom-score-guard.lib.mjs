/**
 * Make the kernel OOM killer pick the AI tool's commands before the AI tool.
 *
 * In link-foundation/links-notation#340 a cmake build started by Claude Code
 * filled the 2.92 GiB container and the kernel killed `claude` itself, ending
 * the session (exit code 137), then killed solve (issue #3125). Every process
 * there had oom_score_adj 0, so the largest one lost.
 *
 * While solve runs, this raises the oom_score_adj of every process below an AI
 * tool process (its shells, builds, test runners) to 500. A process with the
 * same uid may raise another one's oom_score_adj without privilege, and
 * processes forked later inherit it (experiments/issue-3125/
 * oom-score-adj-permissions.sh). An over-limit build is then killed instead of
 * the tool, which sees a failed command and can retry with fewer jobs. The AI
 * tool, solve and their ancestors are never changed.
 *
 * Linux only. Set HIVE_MIND_TOOL_OOM_SCORE_ADJ=0 to turn it off, or to another
 * value from 1 to 1000.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3125
 * @see https://www.kernel.org/doc/html/latest/filesystems/proc.html
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { readParentPids } from './session-survivors.lib.mjs';

export const DEFAULT_TOOL_OOM_SCORE_ADJ = 500;

// Executables of the supported AI tools, as they appear in /proc/<pid>/cmdline.
export const TOOL_PROCESS_NAMES = new Set(['claude', 'codex', 'opencode', 'agent', 'qwen', 'gemini']);
const SCRIPT_RUNTIMES = new Set(['node', 'nodejs', 'bun', 'deno']);
// The same tools when started by the file in their npm package (cli.js, codex.js, opencode.exe…).
const TOOL_PACKAGE_PATH = /\/(@anthropic-ai\/claude-code|@openai\/codex|opencode-ai|@link-assistant\/agent|@qwen-code\/qwen-code|@google\/gemini-cli)\//;

const baseName = value => path.basename(String(value || '')).replace(/\.([cm]?js|exe)$/, '');
const isToolFile = value => TOOL_PROCESS_NAMES.has(baseName(value)) || TOOL_PACKAGE_PATH.test(String(value || ''));

/**
 * Whether a command line is an AI tool, run directly or as a script by a runtime.
 *
 * @param {string[]} argv - from /proc/<pid>/cmdline
 * @returns {boolean}
 */
export const isToolCommand = argv => {
  if (!argv?.length) return false;
  if (isToolFile(argv[0])) return true;
  if (!SCRIPT_RUNTIMES.has(baseName(argv[0]))) return false;
  const script = argv.slice(1).find(arg => !String(arg).startsWith('-'));
  return Boolean(script) && isToolFile(script);
};

/**
 * Resolve the oom_score_adj to give tool commands; 0 turns the guard off.
 *
 * @param {object} [env]
 * @returns {number}
 */
export const resolveToolOomScoreAdj = (env = process.env) => {
  const raw = env.HIVE_MIND_TOOL_OOM_SCORE_ADJ;
  if (raw === undefined || String(raw).trim() === '') return DEFAULT_TOOL_OOM_SCORE_ADJ;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return 0;
  return Math.min(1000, value);
};

/**
 * Find the processes below the outermost AI tool processes under `rootPid`.
 *
 * @param {object} params
 * @param {number} params.rootPid - solve
 * @param {Map<number, number>} params.parents - pid → parent pid
 * @param {Function} params.readCommand - pid → Promise<string[]>
 * @returns {Promise<{tools: number[], commands: number[]}>}
 */
export const findToolCommands = async ({ rootPid, parents, readCommand }) => {
  const children = new Map();
  for (const [pid, ppid] of parents) {
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const tools = [];
  const commands = [];
  const queue = [...(children.get(rootPid) || [])];
  const seen = new Set([rootPid]);
  while (queue.length > 0) {
    const pid = queue.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    if (isToolCommand(await readCommand(pid))) {
      tools.push(pid);
      const below = [...(children.get(pid) || [])];
      while (below.length > 0) {
        const child = below.shift();
        if (seen.has(child)) continue;
        seen.add(child);
        commands.push(child);
        below.push(...(children.get(child) || []));
      }
    } else {
      queue.push(...(children.get(pid) || []));
    }
  }
  return { tools, commands };
};

/**
 * Raise the oom_score_adj of every command an AI tool under `rootPid` runs.
 *
 * @param {object} [params]
 * @param {number} [params.rootPid]
 * @param {number} [params.adj]
 * @param {string} [params.procRoot]
 * @returns {Promise<number[]>} the pids that were raised now
 */
export const raiseToolCommandsOomScore = async ({ rootPid = process.pid, adj = DEFAULT_TOOL_OOM_SCORE_ADJ, procRoot = '/proc' } = {}) => {
  const parents = await readParentPids(procRoot);
  const readCommand = async pid => (await readFile(path.join(procRoot, String(pid), 'cmdline'), 'utf8').catch(() => '')).split('\0').filter(Boolean);
  const { commands } = await findToolCommands({ rootPid, parents, readCommand });
  const raised = [];
  for (const pid of commands) {
    const file = path.join(procRoot, String(pid), 'oom_score_adj');
    const current = Number((await readFile(file, 'utf8').catch(() => '')).trim());
    if (!Number.isInteger(current) || current >= adj) continue;
    try {
      await writeFile(file, `${adj}\n`);
      raised.push(pid);
    } catch {
      // exited meanwhile, or owned by another user
    }
  }
  return raised;
};

/**
 * Keep raising the oom_score_adj of AI tool commands while solve runs.
 *
 * @param {object} [params]
 * @param {Function} [params.log]
 * @param {number} [params.intervalMs]
 * @param {number} [params.adj]
 * @param {string} [params.platform]
 * @param {Function} [params.raise] - {@link raiseToolCommandsOomScore} (injectable for tests)
 * @returns {{stop: Function, tick: Function}}
 */
export const startToolOomScoreGuard = ({ log = async () => {}, intervalMs = 1000, adj = resolveToolOomScoreAdj(), platform = process.platform, raise = raiseToolCommandsOomScore } = {}) => {
  const idle = { stop: () => {}, tick: async () => [] };
  if (platform !== 'linux' || !adj) return idle;
  let busy = false;
  let reported = false;
  const tick = async () => {
    if (busy) return [];
    busy = true;
    try {
      const raised = await raise({ adj });
      if (raised.length > 0 && !reported) {
        reported = true;
        await log(`🛡️  Raised oom_score_adj to ${adj} for commands run by the AI tool (pids ${raised.join(', ')}), so the OOM killer stops them before the AI tool (HIVE_MIND_TOOL_OOM_SCORE_ADJ=0 turns this off)`);
      }
      return raised;
    } catch {
      return [];
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), tick };
};

export default { DEFAULT_TOOL_OOM_SCORE_ADJ, TOOL_PROCESS_NAMES, findToolCommands, isToolCommand, raiseToolCommandsOomScore, resolveToolOomScoreAdj, startToolOomScoreGuard };
