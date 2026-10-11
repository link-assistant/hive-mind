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

export default { findProcessesInDirectory, keepProcessAcrossSessions, logProcessesSurvivingSession, releaseKeptProcess };
