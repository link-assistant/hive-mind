#!/usr/bin/env node

/**
 * Verbose diagnostic: list processes that still run in the work directory after
 * an AI session ended (issue #2395).
 *
 * In konard/p-vs-np#623 the Codex session was stopped at 20:08:19 (exit code
 * 143), hive-mind restored "Fixes #567" at 20:08:25, and at 20:10:37 the pull
 * request description was rewritten again — without the link and with a CI
 * result that was only known after the stop. No session that hive-mind knew
 * about was running then, and the attached log could not tell whether a process
 * of the stopped session (for example a command Codex runs in its own PTY
 * session, outside the killed process group) was still alive. With `--verbose`
 * this check answers that on the next occurrence.
 *
 * Linux only (reads `/proc`); elsewhere it reports nothing.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2395
 */

import { readdir, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';

const MAX_COMMAND_LENGTH = 200;

// Processes Hive Mind keeps running across sessions on purpose and stops itself
// at exit, keyed by pid. Issue #2923: Formal AI Draft run 37959364207 warned about
// its own task-owned `formal-ai serve`, which hides real leftovers.
const keptProcesses = new Map();

/** Mark a process this Hive Mind started as intentionally outliving a session. */
export const keepProcessAcrossSessions = (pid, reason) => {
  if (pid) keptProcesses.set(pid, reason);
};

/** Forget a process marked by {@link keepProcessAcrossSessions} once it is stopped. */
export const releaseKeptProcess = pid => keptProcesses.delete(pid);

/**
 * Find the processes whose working directory is `dir` or below it.
 *
 * @param {object} params
 * @param {string} params.dir - the work directory of the session
 * @param {string} [params.procRoot] - `/proc` (injectable for tests)
 * @param {number[]} [params.excludePids] - processes to ignore (this process by default)
 * @returns {Promise<Array<{pid: number, cwd: string, command: string}>>}
 */
export const findProcessesInDirectory = async ({ dir, procRoot = '/proc', excludePids = [process.pid] }) => {
  if (!dir) return [];
  const root = path.resolve(dir);
  let entries;
  try {
    entries = await readdir(procRoot);
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (excludePids.includes(pid)) continue;
    let cwd;
    try {
      cwd = await readlink(path.join(procRoot, entry, 'cwd'));
    } catch {
      continue; // exited meanwhile, or owned by another user
    }
    if (cwd !== root && !cwd.startsWith(`${root}${path.sep}`)) continue;
    const cmdline = await readFile(path.join(procRoot, entry, 'cmdline'), 'utf8').catch(() => '');
    const command = cmdline.split('\0').filter(Boolean).join(' ');
    found.push({ pid, cwd, command: command.length > MAX_COMMAND_LENGTH ? `${command.slice(0, MAX_COMMAND_LENGTH)}…` : command });
  }
  return found;
};

/**
 * With `--verbose`, log every process still running in the work directory after a session ended.
 * Processes marked with {@link keepProcessAcrossSessions} are logged as kept, not as leftovers.
 *
 * @param {object} params
 * @param {string} params.tempDir - the work directory of the session
 * @param {object} [params.argv]
 * @param {Function} [params.log]
 * @param {Function} [params.find] - {@link findProcessesInDirectory} (injectable for tests)
 * @returns {Promise<Array<{pid: number, cwd: string, command: string}>>} the leftover processes found
 */
export const logProcessesSurvivingSession = async ({ tempDir, argv = {}, log = async () => {}, find = findProcessesInDirectory }) => {
  if (!argv.verbose || !tempDir) return [];
  let found;
  try {
    found = await find({ dir: tempDir });
  } catch (error) {
    await log(`🔍 Could not list processes left in ${tempDir}: ${error?.message || error}`, { verbose: true });
    return [];
  }
  for (const { pid, command } of found.filter(({ pid }) => keptProcesses.has(pid))) {
    await log(`🔍 pid ${pid} kept on purpose (${keptProcesses.get(pid)}): ${command || '(no command line)'}`, { verbose: true });
  }
  const survivors = found.filter(({ pid }) => !keptProcesses.has(pid));
  if (survivors.length === 0) {
    await log(`🔍 No processes left running in ${tempDir} after the session`, { verbose: true });
    return survivors;
  }
  await log(`⚠️  ${survivors.length} process(es) still running in ${tempDir} after the session ended:`, { level: 'warning' });
  for (const { pid, command } of survivors) {
    await log(`   pid ${pid}: ${command || '(no command line)'}`, { level: 'warning' });
  }
  return survivors;
};

/**
 * Whether the AI tool was killed with SIGKILL (exit code 137), so it could not
 * stop the commands it started. Adapters report the exit code at the top level
 * (Codex) or in `errorInfo` (the others).
 *
 * @param {object|null} toolResult
 * @returns {boolean}
 */
export const wasToolKilled = toolResult => {
  const exitCode = toolResult?.exitCode ?? toolResult?.errorInfo?.exitCode;
  const signal = toolResult?.signal ?? toolResult?.errorInfo?.signal;
  return exitCode === 137 || signal === 'SIGKILL';
};

/** Parse `/proc/<pid>/stat` into the parent pid; the command name may contain spaces and parentheses. */
const parseParentPid = stat => {
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const ppid = Number(fields[1]);
  return Number.isInteger(ppid) ? ppid : null;
};

/**
 * Read the parent of every process in `procRoot`.
 *
 * @param {string} [procRoot]
 * @returns {Promise<Map<number, number>>} pid → parent pid
 */
export const readParentPids = async (procRoot = '/proc') => {
  const parents = new Map();
  let entries;
  try {
    entries = await readdir(procRoot);
  } catch {
    return parents;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const stat = await readFile(path.join(procRoot, entry, 'stat'), 'utf8').catch(() => null);
    const ppid = stat ? parseParentPid(stat) : null;
    if (ppid !== null) parents.set(Number(entry), ppid);
  }
  return parents;
};

/**
 * The given processes and all their descendants, minus `protectedPids` and
 * their subtrees.
 *
 * @param {number[]} pids
 * @param {Map<number, number>} parents - from {@link readParentPids}
 * @param {Set<number>} [protectedPids]
 * @returns {number[]}
 */
export const collectProcessTrees = (pids, parents, protectedPids = new Set()) => {
  const children = new Map();
  for (const [pid, ppid] of parents) {
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const result = new Set();
  const queue = pids.filter(pid => !protectedPids.has(pid));
  while (queue.length > 0) {
    const pid = queue.shift();
    if (result.has(pid) || protectedPids.has(pid)) continue;
    result.add(pid);
    queue.push(...(children.get(pid) || []));
  }
  return [...result];
};

/** This process and its ancestors, which must never be stopped. */
const ancestorsOf = (pid, parents) => {
  const chain = new Set();
  for (let current = pid; current > 0 && !chain.has(current); current = parents.get(current)) chain.add(current);
  return chain;
};

const isAlive = (pid, kill) => {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
};

/**
 * Stop the commands a killed AI tool left behind (issue #3125).
 *
 * When the kernel OOM killer kills the AI tool (exit code 137), the build it
 * started keeps running and keeps using the container's memory. In
 * link-foundation/links-notation#340 the leftover cmake build (make -j,
 * cc1plus) caused a second OOM kill 32 s later, which killed solve itself, so
 * the session could not report or recover. This sends SIGTERM, then SIGKILL,
 * to every process still running in the work directory and to all their
 * descendants (a build directory outside the work directory included). It
 * runs with or without `--verbose`, only after a SIGKILL, and never touches
 * this process, its ancestors, its own children, or processes kept on purpose.
 *
 * @param {object} params
 * @param {string} params.tempDir - the work directory of the session
 * @param {object|null} params.toolResult - what the adapter returned
 * @param {Function} [params.log]
 * @param {string} [params.procRoot]
 * @param {Function} [params.find] - {@link findProcessesInDirectory}
 * @param {Function} [params.kill] - `process.kill` (injectable for tests)
 * @param {number} [params.graceMs] - how long SIGTERM gets before SIGKILL
 * @param {Function} [params.sleep]
 * @returns {Promise<{stopped: number[], forced: number[]}>}
 */
export const stopProcessesLeftByKilledTool = async ({ tempDir, toolResult, log = async () => {}, procRoot = '/proc', find = findProcessesInDirectory, kill = process.kill.bind(process), graceMs = 3000, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) => {
  const none = { stopped: [], forced: [] };
  if (!tempDir || !wasToolKilled(toolResult)) return none;
  let targets;
  try {
    const parents = await readParentPids(procRoot);
    // The killed tool's orphans are reparented to init, so this process's own
    // subtree holds only its own helpers.
    const protectedPids = new Set([...ancestorsOf(process.pid, parents), ...collectProcessTrees([process.pid], parents), ...keptProcesses.keys()]);
    const survivors = await find({ dir: tempDir, procRoot, excludePids: [...protectedPids] });
    targets = collectProcessTrees(
      survivors.map(({ pid }) => pid),
      parents,
      protectedPids
    );
  } catch (error) {
    await log(`⚠️  Could not list processes left by the killed AI tool: ${error?.message || error}`, { level: 'warning' });
    return none;
  }
  if (targets.length === 0) return none;
  await log(`🧹 The AI tool was killed (exit code 137); stopping ${targets.length} process(es) it left running so they cannot use the container's memory: ${targets.join(', ')}`, { level: 'warning' });
  const signal = (pids, name) =>
    pids.filter(pid => {
      try {
        kill(pid, name);
        return true;
      } catch {
        return false;
      }
    });
  const stopped = signal(targets, 'SIGTERM');
  for (let waited = 0; waited < graceMs && stopped.some(pid => isAlive(pid, kill)); waited += 100) await sleep(100);
  const forced = signal(
    stopped.filter(pid => isAlive(pid, kill)),
    'SIGKILL'
  );
  if (forced.length > 0) await log(`🧹 Sent SIGKILL to ${forced.length} process(es) that ignored SIGTERM: ${forced.join(', ')}`, { level: 'warning' });
  return { stopped, forced };
};

export default { collectProcessTrees, findProcessesInDirectory, keepProcessAcrossSessions, logProcessesSurvivingSession, readParentPids, releaseKeptProcess, stopProcessesLeftByKilledTool, wasToolKilled };
