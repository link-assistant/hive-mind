#!/usr/bin/env node

/**
 * Issue #2187, item E — the disk gate must answer "how much COULD be free",
 * not only "how much IS free".
 *
 * Reported: hive stops with
 *
 *     🛑 Stopping: no in-flight work can release disk space.
 *
 * while `docker system df` reports 24 GB reclaimable, orphaned agent snapshot
 * stores (#2186) hold gigabytes more, and superseded toolchains sit next to the
 * pinned ones. The operator is told to "free space on this host" with no hint of
 * where that space actually is.
 *
 * These tests build a real fixture — solver workspaces with real files and real
 * mtimes, an agent data home with one orphaned and one live store, a node root
 * with a superseded version — and a stubbed docker daemon, then assert the
 * summary reports each source, sums only non-overlapping ones, and reaches both
 * the per-task gate and the startup check.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2187
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { assert as check, printSummary, getFailCount } from './test-helpers.mjs';
import { collectReclaimableSpace, formatReclaimableSpaceLines } from '../src/reclaimable-space.lib.mjs';
import { ensureDiskSpaceForWorker } from '../src/disk-guard.lib.mjs';
import { runStartupChecks } from '../src/hive.startup-checks.lib.mjs';

const MB = 1024 * 1024;
const OLD_MTIME = new Date(Date.now() - 60 * 60 * 1000);

const writeFileOfSize = async (filePath, megabytes) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, Buffer.alloc(megabytes * MB, 7));
};

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2187-reclaimable-'));
const tmpRoot = path.join(root, 'tmp');
const agentDataHome = path.join(root, 'agent');
const homeDir = path.join(root, 'home');
const emptyProcRoot = path.join(root, 'proc');
await fs.mkdir(emptyProcRoot, { recursive: true });

// Solver workspaces: one idle (reclaimable), one in flight, one just touched.
await writeFileOfSize(path.join(tmpRoot, 'gh-issue-solver-idle', 'blob.bin'), 3);
await writeFileOfSize(path.join(tmpRoot, 'gh-issue-solver-inflight', 'blob.bin'), 5);
await writeFileOfSize(path.join(tmpRoot, 'gh-issue-solver-fresh', 'blob.bin'), 7);
await fs.utimes(path.join(tmpRoot, 'gh-issue-solver-idle'), OLD_MTIME, OLD_MTIME);
await fs.utimes(path.join(tmpRoot, 'gh-issue-solver-inflight'), OLD_MTIME, OLD_MTIME);

// Agent snapshot stores: one orphaned, one whose worktree still exists (#2186).
await writeFileOfSize(path.join(agentDataHome, 'snapshot', 'orphan-1', 'pack.bin'), 2);
await writeFileOfSize(path.join(agentDataHome, 'snapshot', 'alive-1', 'pack.bin'), 4);
await fs.mkdir(path.join(agentDataHome, 'storage', 'project'), { recursive: true });
await fs.writeFile(path.join(agentDataHome, 'storage', 'project', 'orphan-1.json'), JSON.stringify({ worktree: path.join(root, 'gone') }));
await fs.writeFile(path.join(agentDataHome, 'storage', 'project', 'alive-1.json'), JSON.stringify({ worktree: tmpRoot }));
for (const store of ['orphan-1', 'alive-1']) await fs.utimes(path.join(agentDataHome, 'snapshot', store), OLD_MTIME, OLD_MTIME);

// Toolchains: nvm keeps the superseded version around forever (item A).
await writeFileOfSize(path.join(homeDir, '.nvm', 'versions', 'node', 'v20.20.2', 'bin', 'node'), 6);
await writeFileOfSize(path.join(homeDir, '.nvm', 'versions', 'node', 'v24.20.0', 'bin', 'node'), 6);
await fs.mkdir(path.join(homeDir, '.nvm', 'alias'), { recursive: true });
await fs.writeFile(path.join(homeDir, '.nvm', 'alias', 'default'), '24\n');

const DOCKER_IMAGES = [
  { ID: 'sha256:new', Repository: 'konard/hive-mind', Tag: 'latest', CreatedAt: '2026-08-30 10:00:00 +0000 UTC', Size: '12GB' },
  { ID: 'sha256:old', Repository: 'konard/hive-mind', Tag: 'v2.16.0', CreatedAt: '2026-08-20 10:00:00 +0000 UTC', Size: '8GB' },
];
const DOCKER_SYSTEM_DF = ['TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE', 'Images          2         1         20GB      8GB (40%)', 'Containers      1         0         0B        0B', 'Local Volumes   3         0         16GB      16GB (100%)', 'Build Cache     12        0         0B        0B'].join('\n');

const dockerExec = async (file, args) => {
  const command = args.join(' ');
  if (file !== 'docker') throw new Error(`unexpected command: ${file}`);
  if (command.startsWith('image ls')) return { stdout: DOCKER_IMAGES.map(image => JSON.stringify(image)).join('\n') };
  if (command.startsWith('ps')) return { stdout: '' };
  if (command.startsWith('system df')) return { stdout: DOCKER_SYSTEM_DF };
  throw new Error(`unexpected docker command: ${command}`);
};

const collectOptions = {
  tmpRoot,
  agentDataHome,
  homeDir,
  protectedPaths: new Set([path.join(tmpRoot, 'gh-issue-solver-inflight')]),
  // A readable proc root with no processes in it: nothing is another process's
  // cwd. (An unreadable one makes the guard treat every workspace as busy, which
  // is the right call for a real host and the wrong fixture for this test.)
  procRoot: emptyProcRoot,
  exec: dockerExec,
};

const summary = await collectReclaimableSpace(collectOptions);
const sourceById = id => summary.sources.find(source => source.id === id);

// --- solver workspaces ------------------------------------------------------
const workspaces = sourceById('idle_workspaces');
check(Boolean(workspaces), 'idle solver workspaces are reported as reclaimable');
check(workspaces?.count === 1, `only the idle workspace counts, not the in-flight or freshly touched ones (got ${workspaces?.count})`);
check(workspaces?.bytes >= 3 * MB && workspaces?.bytes < 5 * MB, `the idle workspace is measured, not guessed (got ${workspaces?.bytes})`);
check(workspaces?.automatic === true, 'the guard can reclaim idle workspaces itself');

// --- orphaned agent snapshot stores (#2186) ---------------------------------
const snapshots = sourceById('orphaned_agent_snapshots');
check(snapshots?.count === 1, `only the orphaned store counts, not the one whose worktree is alive (got ${snapshots?.count})`);
check(snapshots?.bytes >= 2 * MB && snapshots?.bytes < 4 * MB, `the orphaned store is measured (got ${snapshots?.bytes})`);
check(snapshots?.automatic === true, 'the guard can reclaim orphaned snapshot stores itself');

// --- docker -----------------------------------------------------------------
const images = sourceById('docker_images');
check(images?.count === 1, 'the superseded hive-mind tag is reported');
check(images?.bytes >= 7 * 1024 ** 3, `the superseded image size is reported (got ${images?.bytes})`);
const daemon = sourceById('docker_daemon');
check(daemon?.bytes === 24 * 1024 ** 3, `docker's own reclaimable figure is surfaced (got ${daemon?.bytes})`);
check(images?.counted === false && daemon?.counted === true, "the image plan is a subset of docker's figure, so it is not summed twice");
check(Boolean(daemon?.command), 'the docker figure comes with the command that reclaims it');

// --- toolchains (item A) ----------------------------------------------------
const toolchains = sourceById('superseded_toolchains');
check(toolchains?.count === 1, 'the superseded node version is reported');
check(toolchains?.bytes >= 6 * MB, `the superseded toolchain is measured (got ${toolchains?.bytes})`);
check(toolchains?.automatic === false, 'toolchains are never removed automatically');

// --- totals -----------------------------------------------------------------
const countedBytes = summary.sources.filter(source => source.counted).reduce((sum, source) => sum + source.bytes, 0);
check(summary.totalBytes === countedBytes, 'totalBytes sums exactly the non-overlapping sources');
check(summary.automaticBytes === workspaces.bytes + snapshots.bytes, 'automaticBytes is what the guard itself can release');
check(summary.totalBytes > summary.automaticBytes, 'the total exceeds what the guard can do alone, which is the point of reporting it');

// --- report -----------------------------------------------------------------
const lines = formatReclaimableSpaceLines(summary).join('\n');
check(lines.includes('Reclaimable'), 'the report announces reclaimable space');
check(lines.includes('idle solver workspace'), 'the report names the workspaces');
check(lines.includes('agent snapshot'), 'the report names the orphaned snapshot stores');
check(lines.includes('docker'), 'the report names the docker reclaim');
check(lines.includes('nvm uninstall v20.20.2') || lines.includes('toolchain'), 'the report names the superseded toolchains');
check(formatReclaimableSpaceLines(null).length === 0, 'a missing summary prints nothing');

// --- nothing to reclaim -----------------------------------------------------
const emptyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2187-empty-'));
const emptySummary = await collectReclaimableSpace({
  tmpRoot: path.join(emptyRoot, 'tmp'),
  agentDataHome: path.join(emptyRoot, 'agent'),
  homeDir: path.join(emptyRoot, 'home'),
  procRoot: path.join(emptyRoot, 'no-proc'),
  exec: async () => {
    throw new Error('docker: command not found');
  },
});
check(emptySummary.totalBytes === 0 && emptySummary.sources.length === 0, 'an empty host reports no reclaimable space');
check(formatReclaimableSpaceLines(emptySummary).length === 0, 'nothing is printed when there is nothing to reclaim');

// --- the per-task gate reports it when it gives up --------------------------
let collectCalls = 0;
const collectReclaimable = async () => {
  collectCalls += 1;
  return summary;
};
const guardOptions = {
  requiredMB: 10240,
  tmpRoot: path.join(root, 'no-workspaces'),
  agentDataHome: null,
  maxWaitMs: 0,
  procRoot: path.join(root, 'no-proc'),
  collectReclaimable,
};
const denied = await ensureDiskSpaceForWorker({ ...guardOptions, getFreeMB: async () => 100 });
check(denied.ok === false, 'the gate still defers the task when the disk is full');
check(denied.reclaimable === summary, 'the deferral carries the reclaimable-space summary');
check(collectCalls === 1, 'the summary is collected once, on the failure path only');

const allowed = await ensureDiskSpaceForWorker({ ...guardOptions, getFreeMB: async () => 999_999 });
check(allowed.ok === true && collectCalls === 1, 'a healthy disk never pays for the summary');

const brokenCollect = async () => {
  throw new Error('df exploded');
};
const stillDenied = await ensureDiskSpaceForWorker({ ...guardOptions, getFreeMB: async () => 100, collectReclaimable: brokenCollect });
check(stillDenied.ok === false && stillDenied.reclaimable === null, 'a failing collector never breaks the gate');

// --- the gate reclaims superseded images before deferring -------------------
// "reclaim and continue rather than stop" (#2187 E): a rebuild's leftovers are
// dead weight no in-flight task can release, so the gate drops them itself.
const dockerCalls = [];
const guardDocker = async (file, args) => {
  const command = args.join(' ');
  dockerCalls.push(`${file} ${command}`);
  if (command.startsWith('image ls')) return { stdout: DOCKER_IMAGES.map(image => JSON.stringify(image)).join('\n') };
  if (command.startsWith('ps')) return { stdout: '' };
  if (command.startsWith('image rm')) return { stdout: 'Untagged: konard/hive-mind:v2.16.0' };
  throw new Error(`unexpected docker command: ${command}`);
};
const recovered = await ensureDiskSpaceForWorker({
  ...guardOptions,
  // Full until the superseded image is gone, then enough to start the task.
  getFreeMB: async () => (dockerCalls.some(call => call.startsWith('docker image rm')) ? 999_999 : 100),
  dockerImageReclaimMode: 'superseded',
  exec: guardDocker,
});
check(recovered.ok === true && recovered.reason === 'reclaimed', 'the gate continues once the superseded image is gone instead of stopping the run');
check(recovered.reclaimedImages.includes('konard/hive-mind:v2.16.0'), 'the reclaimed image is reported');
check(dockerCalls.includes('docker image rm konard/hive-mind:v2.16.0'), 'the superseded tag is removed by reference');
check(!dockerCalls.some(call => call.includes('konard/hive-mind:latest')), 'the image the next task needs is never removed');

dockerCalls.length = 0;
const withoutDocker = await ensureDiskSpaceForWorker({ ...guardOptions, getFreeMB: async () => 100, exec: guardDocker });
check(withoutDocker.ok === false && dockerCalls.length === 0, 'the docker daemon is left alone unless the run opted into cleanup');

// --- and the startup check prints it before exiting -------------------------
const logged = [];
let exitCode = null;
await runStartupChecks({
  argv: {},
  log: async message => logged.push(String(message)),
  safeExit: async code => {
    exitCode = code;
  },
  ensureDiskSpaceForWorker: async () => ({ ok: false, freeMB: 512, reclaimable: summary }),
  checkSystem: async () => ({ success: false }),
  validateToolConnection: async () => false,
  validateClaudeConnection: async () => false,
  EXIT_CODE_INSUFFICIENT_DISK_SPACE: 75,
});
check(exitCode === 75, 'the startup check still exits 75 (EX_TEMPFAIL) on a full disk');
const startupReport = logged.join('\n');
check(startupReport.includes('Reclaimable'), 'the startup check prints where the space is before giving up');
check(startupReport.includes('docker'), 'the startup check names the docker reclaim it found');

await fs.rm(root, { recursive: true, force: true });
await fs.rm(emptyRoot, { recursive: true, force: true });

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
