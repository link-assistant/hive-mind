#!/usr/bin/env node

/**
 * Issue #3125: when the kernel OOM killer killed the AI tool (exit code 137),
 * the build it started (make -j, cc1plus) kept running. Hive Mind only logged
 * the leftovers with `--verbose`, and 32 s later a second OOM kill ended solve
 * itself. Now the leftovers and all their descendants are stopped after a
 * SIGKILL, with or without `--verbose`.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3125
 */

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as survivors from '../src/session-survivors.lib.mjs';
import { classifySessionResult } from '../src/session-result.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #3125: processes left by a killed AI tool are stopped');
console.log('='.repeat(78));

const { collectProcessTrees, readParentPids, stopProcessesLeftByKilledTool, wasToolKilled, keepProcessAcrossSessions, releaseKeptProcess } = survivors;

// ---------------------------------------------------------------------------
console.log('\n1. Which results count as a killed tool');

if (typeof wasToolKilled === 'function') {
  assert(wasToolKilled({ errorInfo: { exitCode: 137 } }), 'Claude, OpenCode, Qwen, Gemini, Agent: errorInfo.exitCode 137');
  assert(wasToolKilled({ exitCode: 137, signal: 'SIGKILL' }), 'Codex: exitCode 137 with signal SIGKILL');
  assert(wasToolKilled({ signal: 'SIGKILL' }), 'a SIGKILL signal without an exit code');
  for (const result of [null, {}, { success: true, exitCode: 0 }, { errorInfo: { exitCode: 1 } }, { exitCode: 143, signal: 'SIGTERM' }, { exitCode: 130, signal: 'SIGINT' }]) {
    assert(!wasToolKilled(result), `not killed: ${JSON.stringify(result)}`);
  }
} else {
  assert(false, 'wasToolKilled is exported');
}

// ---------------------------------------------------------------------------
console.log('\n2. Process trees from /proc/<pid>/stat');

const procRoot = await mkdtemp(join(tmpdir(), 'issue-3125-proc-'));
try {
  // pid (comm) state ppid …; the command name may contain spaces and parentheses.
  const procs = { 1: [0, 'init'], 10: [1, 'bash'], 11: [10, 'make'], 12: [11, 'cc1plus'], 13: [11, 'odd) (name'], 20: [1, 'unrelated'] };
  for (const [pid, [ppid, comm]] of Object.entries(procs)) {
    await mkdir(join(procRoot, pid));
    await writeFile(join(procRoot, pid, 'stat'), `${pid} (${comm}) S ${ppid} ${pid} ${pid} 0 -1\n`);
  }
  await mkdir(join(procRoot, 'self'));
  const parents = typeof readParentPids === 'function' ? await readParentPids(procRoot) : new Map();
  assert(parents.get(13) === 11, 'a command name with ") (" is parsed');
  assert(parents.size === 6, `only numeric entries are read (${parents.size})`);
  const tree = typeof collectProcessTrees === 'function' ? collectProcessTrees([10], parents).sort((a, b) => a - b) : [];
  assert(JSON.stringify(tree) === '[10,11,12,13]', `the leftover shell and every descendant are collected: ${tree}`);
  const pruned = typeof collectProcessTrees === 'function' ? collectProcessTrees([10], parents, new Set([11])).sort((a, b) => a - b) : [];
  assert(JSON.stringify(pruned) === '[10]', `a protected process and its subtree are skipped: ${pruned}`);
} finally {
  await rm(procRoot, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log('\n3. Injected find/kill: when cleanup runs');

if (typeof stopProcessesLeftByKilledTool === 'function') {
  const sent = [];
  const alive = new Set([4242]);
  const kill = (pid, signal) => {
    if (signal === 0) {
      if (!alive.has(pid)) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      return true;
    }
    sent.push([pid, signal]);
    if (signal === 'SIGKILL') alive.delete(pid);
    return true;
  };
  const find = async () => [{ pid: 4242, cwd: '/work', command: 'make -j' }];
  const fast = { kill, find, procRoot: '/nonexistent', graceMs: 300, sleep: async () => {} };
  let result = await stopProcessesLeftByKilledTool({ tempDir: '/work', toolResult: { errorInfo: { exitCode: 1 } }, ...fast });
  assert(result.stopped.length === 0 && sent.length === 0, 'an ordinary failure leaves processes alone');
  result = await stopProcessesLeftByKilledTool({ tempDir: null, toolResult: { errorInfo: { exitCode: 137 } }, ...fast });
  assert(result.stopped.length === 0 && sent.length === 0, 'no work directory, nothing to do');
  const logs = [];
  result = await stopProcessesLeftByKilledTool({ tempDir: '/work', toolResult: { errorInfo: { exitCode: 137 } }, log: async message => logs.push(message), ...fast });
  assert(JSON.stringify(sent) === '[[4242,"SIGTERM"],[4242,"SIGKILL"]]', `SIGTERM first, SIGKILL when it is ignored: ${JSON.stringify(sent)}`);
  assert(JSON.stringify(result) === '{"stopped":[4242],"forced":[4242]}', `the result names stopped and forced pids: ${JSON.stringify(result)}`);
  assert(
    logs.some(line => /stopping 1 process\(es\)/.test(line)),
    'the cleanup is logged without --verbose'
  );
  sent.length = 0;
  keepProcessAcrossSessions(4242, 'test');
  result = await stopProcessesLeftByKilledTool({ tempDir: '/work', toolResult: { errorInfo: { exitCode: 137 } }, ...fast, find: async ({ excludePids }) => (excludePids.includes(4242) ? [] : [{ pid: 4242 }]) });
  releaseKeptProcess(4242);
  assert(sent.length === 0 && result.stopped.length === 0, 'a process kept on purpose is never stopped');
} else {
  assert(false, 'stopProcessesLeftByKilledTool is exported');
}

// ---------------------------------------------------------------------------
console.log('\n4. Real orphans after a killed tool, through classifySessionResult()');

if (process.platform === 'linux') {
  const workDir = await mkdtemp(join(tmpdir(), 'issue-3125-work-'));
  const buildDir = await mkdtemp(join(tmpdir(), 'issue-3125-build-'));
  const pidDir = await mkdtemp(join(tmpdir(), 'issue-3125-pids-'));
  const readPid = async name => Number((await readFile(join(pidDir, name), 'utf8').catch(() => '')).trim()) || null;
  const isAlive = pid => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  // A killed orphan can stay a zombie until init reaps it.
  const isRunning = async pid => isAlive(pid) && !/^\d+ \(.*\) Z /.test(await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '0 (x) Z '));
  try {
    // The leftover shell runs in the work directory, like the Bash tool's
    // command; its child runs in a build directory outside it and ignores
    // SIGTERM, like a compiler that has to be killed.
    await writeFile(join(pidDir, 'leftover.sh'), 'echo $$ > "$1/leftover"\n(cd "$2" && exec sh "$1/compiler.sh" "$1") &\nexec sleep 60\n');
    await writeFile(join(pidDir, 'compiler.sh'), 'trap "" TERM\necho $$ > "$1/compiler"\nwhile :; do sleep 1; done\n');
    // The launcher exits at once, so the leftovers are orphans, as after the
    // AI tool was killed.
    await new Promise(resolve => spawn('sh', ['-c', `sh "${pidDir}/leftover.sh" "${pidDir}" "${buildDir}" > /dev/null 2>&1 &`], { cwd: workDir, stdio: 'ignore' }).on('exit', resolve));
    for (let i = 0; i < 50 && !((await readPid('leftover')) && (await readPid('compiler'))); i++) await new Promise(resolve => setTimeout(resolve, 100));
    const leftover = await readPid('leftover');
    const compiler = await readPid('compiler');
    assert(leftover && compiler && (await isRunning(leftover)) && (await isRunning(compiler)), `the leftover (${leftover}) and its compiler (${compiler}) are running`);

    const logs = [];
    await classifySessionResult({ toolResult: { success: false, errorInfo: { exitCode: 137, message: 'Claude command failed with exit code 137' } }, argv: {}, log: async message => logs.push(message), tempDir: workDir });
    for (let i = 0; i < 50 && ((await isRunning(leftover)) || (await isRunning(compiler))); i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert(!(await isRunning(leftover)), `the leftover in the work directory is stopped without --verbose (pid ${leftover})`);
    assert(!(await isRunning(compiler)), `its child outside the work directory, which ignores SIGTERM, is stopped too (pid ${compiler})`);
    assert(isAlive(process.pid), 'solve itself keeps running');
  } finally {
    for (const name of ['leftover', 'compiler']) {
      const pid = await readPid(name);
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // already stopped
        }
      }
    }
    for (const dir of [workDir, buildDir, pidDir]) await rm(dir, { recursive: true, force: true });
  }
} else {
  console.log('  (skipped: needs /proc)');
}

printSummary(78);
process.exit(getFailCount() > 0 ? 1 : 0);
