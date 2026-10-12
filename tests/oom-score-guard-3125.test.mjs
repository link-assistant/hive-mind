/** @hive-mind-test-suite default */
// Issue #3125: every process in the container had oom_score_adj 0, so the
// kernel OOM killer killed `claude` (the largest process) instead of the
// cmake build it ran. The commands an AI tool runs now get oom_score_adj 500.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { findToolCommands, isToolCommand, raiseToolCommandsOomScore, resolveToolOomScoreAdj, startToolOomScoreGuard } from '../src/oom-score-guard.lib.mjs';

test('AI tool command lines are recognized, run directly or by a runtime', () => {
  for (const argv of [['claude', '-p'], ['/usr/local/bin/codex', 'exec'], ['/node_modules/opencode-ai/bin/opencode.exe', 'run'], ['node', '--no-warnings', '/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js'], ['bun', '/home/box/.bun/bin/agent'], ['/usr/bin/node', '/usr/bin/gemini'], ['opencode'], ['qwen']]) {
    assert.ok(isToolCommand(argv), argv.join(' '));
  }
  for (const argv of [[], ['/bin/sh', '-l', '-c', 'claude -p'], ['node', '/app/src/solve.mjs'], ['make', '-j'], ['cc1plus'], ['node'], ['node', '-e', 'x'], ['/home/box/claude-notes/run.sh']]) {
    assert.ok(!isToolCommand(argv), argv.join(' ') || '(empty)');
  }
});

test('HIVE_MIND_TOOL_OOM_SCORE_ADJ sets or turns off the value', () => {
  assert.equal(resolveToolOomScoreAdj({}), 500);
  assert.equal(resolveToolOomScoreAdj({ HIVE_MIND_TOOL_OOM_SCORE_ADJ: '' }), 500);
  assert.equal(resolveToolOomScoreAdj({ HIVE_MIND_TOOL_OOM_SCORE_ADJ: '800' }), 800);
  assert.equal(resolveToolOomScoreAdj({ HIVE_MIND_TOOL_OOM_SCORE_ADJ: '5000' }), 1000);
  for (const off of ['0', '-100', 'false', 'off']) assert.equal(resolveToolOomScoreAdj({ HIVE_MIND_TOOL_OOM_SCORE_ADJ: off }), 0, off);
});

// solve(100) → sh(101) → claude(102) → bash(103) → make(104) → cc1plus(105)
//                      ↘ helper(110)        claude(102) → mcp(106)
// unrelated(200) → claude(201) → bash(202)
const PROCS = {
  1: [0, ['init']],
  100: [1, ['node', '/app/src/solve.mjs']],
  101: [100, ['/bin/sh', '-l', '-c', 'claude -p']],
  102: [101, ['claude', '-p']],
  103: [102, ['/bin/bash', '-c', 'cmake --build build --parallel']],
  104: [103, ['make', '-j']],
  105: [104, ['cc1plus']],
  106: [102, ['node', 'playwright-mcp']],
  110: [100, ['git', 'status']],
  200: [1, ['other']],
  201: [200, ['claude']],
  202: [201, ['bash']],
};

test('only processes below the AI tool under solve are selected', async () => {
  const parents = new Map(Object.entries(PROCS).map(([pid, [ppid]]) => [Number(pid), ppid]));
  const { tools, commands } = await findToolCommands({ rootPid: 100, parents, readCommand: async pid => PROCS[pid][1] });
  assert.deepEqual(tools, [102]);
  assert.deepEqual(
    commands.sort((a, b) => a - b),
    [103, 104, 105, 106]
  );
});

test('oom_score_adj files under a fake /proc are raised once, never lowered', async () => {
  const procRoot = await mkdtemp(join(tmpdir(), 'issue-3125-oom-proc-'));
  try {
    for (const [pid, [ppid, argv]] of Object.entries(PROCS)) {
      await mkdir(join(procRoot, pid));
      await writeFile(join(procRoot, pid, 'stat'), `${pid} (${argv[0]}) S ${ppid} ${pid} ${pid} 0 -1\n`);
      await writeFile(join(procRoot, pid, 'cmdline'), `${argv.join('\0')}\0`);
      await writeFile(join(procRoot, pid, 'oom_score_adj'), pid === '105' ? '900\n' : '0\n');
    }
    const raised = await raiseToolCommandsOomScore({ rootPid: 100, adj: 500, procRoot });
    assert.deepEqual(
      raised.sort((a, b) => a - b),
      [103, 104, 106],
      'cc1plus already at 900 is left alone'
    );
    const adj = async pid => (await readFile(join(procRoot, String(pid), 'oom_score_adj'), 'utf8')).trim();
    for (const pid of [1, 100, 101, 102, 110, 200, 201, 202]) assert.equal(await adj(pid), '0', `pid ${pid} is untouched`);
    assert.equal(await adj(105), '900');
    assert.deepEqual(await raiseToolCommandsOomScore({ rootPid: 100, adj: 500, procRoot }), [], 'a second pass changes nothing');
  } finally {
    await rm(procRoot, { recursive: true, force: true });
  }
});

test('the guard does nothing off Linux or when turned off, and reports once', async () => {
  let calls = 0;
  const raise = async () => (++calls === 1 ? [7, 8] : [9]);
  for (const options of [{ platform: 'darwin' }, { platform: 'linux', adj: 0 }]) {
    const guard = startToolOomScoreGuard({ ...options, raise });
    assert.deepEqual(await guard.tick(), []);
    guard.stop();
  }
  assert.equal(calls, 0);
  const logs = [];
  const guard = startToolOomScoreGuard({ platform: 'linux', adj: 500, intervalMs: 60000, raise, log: async message => logs.push(message) });
  assert.deepEqual(await guard.tick(), [7, 8]);
  assert.deepEqual(await guard.tick(), [9]);
  guard.stop();
  assert.equal(logs.length, 1);
  assert.match(logs[0], /oom_score_adj to 500 .*pids 7, 8/);
  const failing = startToolOomScoreGuard({ platform: 'linux', adj: 500, raise: async () => Promise.reject(new Error('EACCES')) });
  assert.deepEqual(await failing.tick(), [], 'errors are swallowed');
  failing.stop();
});

test('a real command below a process named claude gets 500, the tool keeps its value', { skip: process.platform !== 'linux' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'issue-3125-oom-real-'));
  // A fake AI tool: a node script named `claude` that runs a "build" through a shell, like the Bash tool.
  const tool = join(dir, 'claude');
  await writeFile(tool, `const { spawn } = require('node:child_process');\nrequire('node:fs').writeFileSync(${JSON.stringify(join(dir, 'tool.pid'))}, String(process.pid));\nspawn('/bin/sh', ['-c', 'echo $$ > ${join(dir, 'build.pid')}; exec sleep 30'], { stdio: 'ignore' });\n`);
  const child = spawn('/bin/sh', ['-c', `exec "${process.execPath}" "${tool}" & wait`], { stdio: 'ignore' });
  const readPid = async name => Number((await readFile(join(dir, name), 'utf8').catch(() => '')).trim()) || null;
  try {
    for (let i = 0; i < 50 && !((await readPid('tool.pid')) && (await readPid('build.pid'))); i++) await new Promise(resolve => setTimeout(resolve, 100));
    const toolPid = await readPid('tool.pid');
    const buildPid = await readPid('build.pid');
    assert.ok(toolPid && buildPid, 'the fake tool and its build started');
    const before = Number((await readFile(`/proc/${toolPid}/oom_score_adj`, 'utf8')).trim());
    const raised = await raiseToolCommandsOomScore({ adj: Math.max(before + 1, 500) });
    assert.ok(raised.includes(buildPid), `the build (${buildPid}) is raised: ${raised}`);
    assert.ok(!raised.includes(toolPid) && !raised.includes(child.pid), 'the tool and its launcher are not');
    assert.equal(Number((await readFile(`/proc/${buildPid}/oom_score_adj`, 'utf8')).trim()), Math.max(before + 1, 500));
    assert.equal(Number((await readFile(`/proc/${toolPid}/oom_score_adj`, 'utf8')).trim()), before);
    assert.equal(Number((await readFile(`/proc/${process.pid}/oom_score_adj`, 'utf8')).trim()), before, 'this process keeps its value');
  } finally {
    for (const name of ['build.pid', 'tool.pid']) {
      const pid = await readPid(name);
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // already stopped
        }
      }
    }
    child.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true });
  }
});

test('solve starts the guard', async () => {
  const source = await readFile(new URL('../src/solve.mjs', import.meta.url), 'utf8');
  assert.match(source, /\(await import\('\.\/oom-score-guard\.lib\.mjs'\)\)\.startToolOomScoreGuard\(\{ log \}\)/);
});
