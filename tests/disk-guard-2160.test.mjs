#!/usr/bin/env node

/**
 * Regression test for issue #2160: `❌ 4 task(s) failed (completed: 6)`.
 *
 * The 4 "failures" were a full disk, not broken tasks. hive checked disk space once at startup
 * (73.2 GB free), solve kept every ~10 GB workspace because the repository was public, and once free
 * space dropped below `--min-disk-space` each remaining task died in solve's pre-flight check
 * (`❌ Insufficient disk space: 10047MB available, 10240MB required`) and was counted as a task
 * failure.
 *
 * These tests pin the guard that fixes it:
 *   - free space is re-checked before every task, not once per run;
 *   - idle workspaces are reclaimed oldest first, and in-flight ones are never touched;
 *   - the guard waits for in-flight work instead of spawning a doomed solver;
 *   - when space cannot be recovered the task is deferred, not failed.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2160
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_CODE_INSUFFICIENT_DISK_SPACE, extractSolverWorkspacePaths, findBusySolverWorkspaces, getFreeDiskSpaceMB, listSolverWorkspaces, reclaimSolverWorkspaces, ensureDiskSpaceForWorker } from '../src/disk-guard.lib.mjs';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

const test = async (description, fn) => {
  try {
    await fn();
    console.log(`  ${GREEN}PASS:${RESET} ${description}`);
    passed++;
  } catch (e) {
    console.log(`  ${RED}FAIL:${RESET} ${description}`);
    console.log(`      Error: ${e.message}`);
    failed++;
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * A fake /tmp holding solver workspaces, plus a fake df whose free space grows as they are removed.
 * `workspaces` maps directory name -> { mtimeMs, sizeMB }.
 */
const createFakeDisk = ({ freeMB, workspaces, procCwds = [] }) => {
  const remaining = new Map(Object.entries(workspaces));
  const state = { freeMB, removed: [] };
  return {
    state,
    getFreeMB: async () => state.freeMB,
    remove: async targetPath => {
      const name = targetPath.split('/').pop();
      const workspace = remaining.get(name);
      if (!workspace) throw new Error(`no such workspace: ${targetPath}`);
      remaining.delete(name);
      state.freeMB += workspace.sizeMB;
      state.removed.push(targetPath);
    },
    fileSystem: {
      readdir: async dir => (dir === '/proc' ? procCwds.map((_, index) => String(index + 100)) : ['some-other-dir', ...remaining.keys()]),
      stat: async targetPath => {
        const name = targetPath.split('/').pop();
        const workspace = remaining.get(name);
        if (!workspace) throw new Error(`ENOENT: ${targetPath}`);
        return { mtimeMs: workspace.mtimeMs, isDirectory: () => true };
      },
      readlink: async linkPath => {
        const pid = Number(linkPath.split('/')[2]);
        const cwd = procCwds[pid - 100];
        if (!cwd) throw new Error(`ENOENT: ${linkPath}`);
        return cwd;
      },
    },
  };
};

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

console.log('================================================================================');
console.log('Regression: a full disk defers tasks instead of failing them (Issue #2160)');
console.log('================================================================================\n');

console.log('listSolverWorkspaces():\n');

await test('lists only solver workspaces, oldest first', async () => {
  const disk = createFakeDisk({
    freeMB: 1000,
    workspaces: {
      'gh-issue-solver-3': { mtimeMs: NOW - HOUR, sizeMB: 10 },
      'gh-issue-solver-1': { mtimeMs: NOW - 3 * HOUR, sizeMB: 10 },
      'gh-issue-solver-2': { mtimeMs: NOW - 2 * HOUR, sizeMB: 10 },
    },
  });
  const workspaces = await listSolverWorkspaces({ tmpRoot: '/tmp', fileSystem: disk.fileSystem });
  assert(workspaces.length === 3, `expected 3 workspaces, got ${workspaces.length}`);
  assert(workspaces.map(w => w.name).join(',') === 'gh-issue-solver-1,gh-issue-solver-2,gh-issue-solver-3', `expected oldest-first order, got ${workspaces.map(w => w.name).join(',')}`);
});

console.log('\nfindBusySolverWorkspaces():\n');

await test('a workspace that is a live process cwd is busy', async () => {
  const disk = createFakeDisk({
    freeMB: 1000,
    workspaces: { 'gh-issue-solver-1': { mtimeMs: NOW - HOUR, sizeMB: 10 }, 'gh-issue-solver-2': { mtimeMs: NOW - HOUR, sizeMB: 10 } },
    procCwds: ['/tmp/gh-issue-solver-2/subdir', '/home/box'],
  });
  const workspaces = await listSolverWorkspaces({ tmpRoot: '/tmp', fileSystem: disk.fileSystem });
  const busy = await findBusySolverWorkspaces({ workspaces, fileSystem: disk.fileSystem });
  assert(busy.has('/tmp/gh-issue-solver-2'), 'a process sitting inside the workspace must protect it');
  assert(!busy.has('/tmp/gh-issue-solver-1'), 'an unused workspace must not be reported busy');
});

await test('an unreadable /proc protects every workspace', async () => {
  const workspaces = [{ path: '/tmp/gh-issue-solver-1', name: 'gh-issue-solver-1', mtimeMs: 0 }];
  const busy = await findBusySolverWorkspaces({
    workspaces,
    fileSystem: {
      readdir: async () => {
        throw new Error('EACCES');
      },
    },
  });
  assert(busy.has('/tmp/gh-issue-solver-1'), 'without evidence of idleness nothing may be deleted');
});

console.log('\nreclaimSolverWorkspaces():\n');

await test('removes oldest workspaces until the requirement is met and then stops', async () => {
  const disk = createFakeDisk({
    freeMB: 9800,
    workspaces: {
      'gh-issue-solver-old': { mtimeMs: NOW - 3 * HOUR, sizeMB: 300 },
      'gh-issue-solver-older': { mtimeMs: NOW - 5 * HOUR, sizeMB: 200 },
      'gh-issue-solver-newest': { mtimeMs: NOW - 2 * HOUR, sizeMB: 5000 },
    },
  });
  const result = await reclaimSolverWorkspaces({ requiredMB: 10240, tmpRoot: '/tmp', now: () => NOW, getFreeMB: disk.getFreeMB, remove: disk.remove, fileSystem: disk.fileSystem });
  assert(result.removed.join(',') === '/tmp/gh-issue-solver-older,/tmp/gh-issue-solver-old', `expected oldest-first removal, got ${result.removed.join(',')}`);
  assert(result.freeMB === 10300, `expected 10300MB free, got ${result.freeMB}`);
  assert(!disk.state.removed.includes('/tmp/gh-issue-solver-newest'), 'reclamation must stop as soon as the requirement is met');
});

await test('never removes in-flight, busy or freshly modified workspaces', async () => {
  const disk = createFakeDisk({
    freeMB: 100,
    workspaces: {
      'gh-issue-solver-inflight': { mtimeMs: NOW - 3 * HOUR, sizeMB: 5000 },
      'gh-issue-solver-busy': { mtimeMs: NOW - 3 * HOUR, sizeMB: 5000 },
      'gh-issue-solver-fresh': { mtimeMs: NOW - 1000, sizeMB: 5000 },
    },
    procCwds: ['/tmp/gh-issue-solver-busy'],
  });
  const result = await reclaimSolverWorkspaces({
    requiredMB: 10240,
    tmpRoot: '/tmp',
    protectedPaths: new Set(['/tmp/gh-issue-solver-inflight']),
    now: () => NOW,
    getFreeMB: disk.getFreeMB,
    remove: disk.remove,
    fileSystem: disk.fileSystem,
  });
  assert(result.removed.length === 0, `nothing should have been removed, got ${result.removed.join(',')}`);
  const reasons = Object.fromEntries(result.skipped.map(entry => [entry.path.split('-').pop(), entry.reason]));
  assert(reasons.inflight === 'in_flight', `unexpected reason for the in-flight workspace: ${reasons.inflight}`);
  assert(reasons.busy === 'process_cwd', `unexpected reason for the busy workspace: ${reasons.busy}`);
  assert(reasons.fresh === 'recently_modified', `unexpected reason for the fresh workspace: ${reasons.fresh}`);
});

console.log('\nensureDiskSpaceForWorker():\n');

await test('the reported scenario: 10047MB free is recovered by reclaiming a finished workspace', async () => {
  // Verbatim numbers from the run log: the guard runs before solve would have refused to start.
  const disk = createFakeDisk({ freeMB: 10047, workspaces: { 'gh-issue-solver-finished': { mtimeMs: NOW - 2 * HOUR, sizeMB: 12000 } } });
  const result = await ensureDiskSpaceForWorker({ requiredMB: 10240, tmpRoot: '/tmp', now: () => NOW, getFreeMB: disk.getFreeMB, remove: disk.remove, fileSystem: disk.fileSystem });
  assert(result.ok, `expected the task to proceed, got ${JSON.stringify(result)}`);
  assert(result.reason === 'reclaimed', `expected reclamation, got ${result.reason}`);
  assert(result.reclaimed.join(',') === '/tmp/gh-issue-solver-finished', `expected the finished workspace to be reclaimed, got ${result.reclaimed.join(',')}`);
});

await test('waits for in-flight work to release space instead of deferring immediately', async () => {
  const disk = createFakeDisk({ freeMB: 5000, workspaces: {} });
  let clock = NOW;
  const sleeps = [];
  const result = await ensureDiskSpaceForWorker({
    requiredMB: 10240,
    tmpRoot: '/tmp',
    maxWaitMs: 10 * 60 * 1000,
    pollIntervalMs: 60 * 1000,
    now: () => clock,
    sleep: async ms => {
      sleeps.push(ms);
      clock += ms;
      // The in-flight worker finishes and its cleanup releases space.
      if (sleeps.length === 2) disk.state.freeMB = 20000;
    },
    getFreeMB: disk.getFreeMB,
    remove: disk.remove,
    fileSystem: disk.fileSystem,
  });
  assert(result.ok, `expected the task to proceed after waiting, got ${JSON.stringify(result)}`);
  assert(sleeps.length === 2, `expected two polls, got ${sleeps.length}`);
  assert(result.waitedMs === 2 * 60 * 1000, `expected the waited time to be reported, got ${result.waitedMs}`);
});

await test('defers when space cannot be recovered within the wait budget', async () => {
  const disk = createFakeDisk({ freeMB: 10047, workspaces: { 'gh-issue-solver-inflight': { mtimeMs: NOW - 3 * HOUR, sizeMB: 12000 } } });
  const result = await ensureDiskSpaceForWorker({
    requiredMB: 10240,
    tmpRoot: '/tmp',
    protectedPaths: new Set(['/tmp/gh-issue-solver-inflight']),
    maxWaitMs: 0,
    now: () => NOW,
    getFreeMB: disk.getFreeMB,
    remove: disk.remove,
    fileSystem: disk.fileSystem,
  });
  assert(!result.ok, 'the guard must refuse to start work it knows will fail');
  assert(result.reason === 'insufficient_disk_space', `unexpected reason: ${result.reason}`);
  assert(result.freeMB === 10047, `the free space must be reported, got ${result.freeMB}`);
  assert(disk.state.removed.length === 0, 'the in-flight workspace must survive');
});

await test('an unreadable df never blocks work', async () => {
  const result = await ensureDiskSpaceForWorker({ requiredMB: 10240, getFreeMB: async () => null });
  assert(result.ok && result.reason === 'unknown_free_space', `expected work to proceed, got ${JSON.stringify(result)}`);
});

await test('getFreeDiskSpaceMB parses df -Pk output', async () => {
  const exec = async () => ({ stdout: 'Filesystem     1024-blocks      Used Available Capacity Mounted on\n/dev/sda1      202086432  191796000  10288128      95% /\n' });
  // 10288128 KiB is exactly the "10047MB available" the reported run refused to start on.
  const freeMB = await getFreeDiskSpaceMB('/tmp', { exec });
  assert(freeMB === 10047, `expected 10047MB, got ${freeMB}`);
  const broken = await getFreeDiskSpaceMB('/tmp', {
    exec: async () => {
      throw new Error('df: not found');
    },
  });
  assert(broken === null, `an unusable df must report null, got ${broken}`);
});

console.log('\nextractSolverWorkspacePaths():\n');

await test('finds the workspace a worker reports in its output', async () => {
  const paths = extractSolverWorkspacePaths('   [solve worker-1] 📁 Keeping directory (auto-cleanup is off by default for public repositories): /tmp/gh-issue-solver-1786954907505');
  assert(paths.join(',') === '/tmp/gh-issue-solver-1786954907505', `unexpected extraction: ${paths.join(',')}`);
  assert(extractSolverWorkspacePaths('nothing here').length === 0, 'unrelated output must not yield paths');
});

console.log('\nWiring in src/hive.mjs and src/solve.mjs:\n');

const hiveSrc = readFileSync(join(__dirname, '..', 'src', 'hive.mjs'), 'utf8');
const solveSrc = readFileSync(join(__dirname, '..', 'src', 'solve.mjs'), 'utf8');
const validationSrc = readFileSync(join(__dirname, '..', 'src', 'solve.validation.lib.mjs'), 'utf8');

await test('hive guards disk space before spawning each worker', async () => {
  assert(hiveSrc.includes('ensureDiskSpaceForWorker'), 'hive.mjs should call the guard');
  const guardIndex = hiveSrc.indexOf('ensureDiskSpaceForWorker(');
  const spawnIndex = hiveSrc.indexOf('const child = spawn(solveCommand');
  assert(guardIndex !== -1 && spawnIndex !== -1 && guardIndex < spawnIndex, 'the guard must run before the solver is spawned');
});

await test('hive requeues a disk-blocked task instead of failing it', async () => {
  assert(hiveSrc.includes('requeue('), 'IssueQueue should support requeueing');
  assert(hiveSrc.includes('EXIT_CODE_INSUFFICIENT_DISK_SPACE'), 'hive should recognise the solver environment exit code');
  const failIndex = hiveSrc.indexOf('issueQueue.markFailed(issueUrl)');
  const exitCodeIndex = hiveSrc.indexOf('exitCode === EXIT_CODE_INSUFFICIENT_DISK_SPACE');
  assert(exitCodeIndex !== -1 && exitCodeIndex < failIndex, 'the environment exit code must be handled before the generic failure path');
});

await test('solve exits with the environment code and posts no failure comment for a full disk', async () => {
  assert(solveSrc.includes('EXIT_CODE_INSUFFICIENT_DISK_SPACE'), 'solve.mjs should use the shared exit code');
  assert(solveSrc.includes('skipPreExit: true'), 'a host-side pre-flight failure must not post a "Solution Draft Failed" comment on the issue');
  assert(validationSrc.includes('systemCheckFailure'), 'performSystemChecks should record which check failed');
  assert(/systemCheckFailure\s*=\s*\{\s*check:\s*'disk-space'/.test(validationSrc), 'the disk-space branch should record its own failure details');
});

console.log('\nEnd-to-end: solve refuses to start on a full disk:\n');

await test('solve exits 75 with an environment reason and without touching the issue', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const execFileAsync = promisify(execFile);
  // An impossible requirement reproduces the reported pre-flight refusal on any host. --dry-run
  // keeps the run offline: the check happens before any GitHub call.
  const workingDirectory = await mkdtemp(join(tmpdir(), 'disk-guard-2160-'));
  try {
    let exitCode = 0;
    let stdout = '';
    try {
      const result = await execFileAsync(process.execPath, [join(__dirname, '..', 'src', 'solve.mjs'), 'https://github.com/link-assistant/hive-mind/issues/2160', '--min-disk-space', '999999999', '--dry-run', '--no-tool-check'], { cwd: workingDirectory, timeout: 180000 });
      stdout = result.stdout;
    } catch (error) {
      exitCode = error.code;
      stdout = `${error.stdout || ''}${error.stderr || ''}`;
    }
    assert(exitCode === EXIT_CODE_INSUFFICIENT_DISK_SPACE, `expected exit ${EXIT_CODE_INSUFFICIENT_DISK_SPACE}, got ${exitCode}\n${stdout.slice(-2000)}`);
    assert(stdout.includes('the issue itself was not attempted'), `the exit reason should name the environment, got:\n${stdout.slice(-2000)}`);
    assert(!stdout.includes('Solution Draft Failed'), 'a host-side refusal must not post a solver-failure comment');
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
});

console.log('');
console.log('================================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================================');

process.exit(failed === 0 ? 0 : 1);
