/**
 * Disk-space guard for solver workspaces (issue #2160).
 *
 * Reported symptom: `hive … --all-issues` finished with `❌ 4 task(s) failed (completed: 6)` even
 * though nothing was wrong with those 4 issues. The run log shows why:
 *
 *   - the target repository was public, so solve's auto-cleanup default resolved to OFF and every
 *     `/tmp/gh-issue-solver-*` workspace (~10 GB each) was kept;
 *   - hive checked free disk space exactly once, at startup (73.2 GB free), and kept dequeuing;
 *   - after 6 completed tasks only 9.8 GB were left, so each remaining task tripped solve's
 *     pre-flight check (`❌ Insufficient disk space: 10047MB available, 10240MB required`), exited
 *     after ~12s, posted a "Solution Draft Failed" comment and was counted as a *task* failure.
 *
 * An exhausted disk is an environment condition: the task is still perfectly solvable once space is
 * available. This module lets the orchestrator (a) reclaim workspaces nobody is using any more,
 * (b) wait for in-flight work to release space, and (c) report the condition as a deferral instead
 * of a task failure.
 *
 * Everything that touches the outside world (df, readdir, rm, clock, sleep) is injectable so the
 * behaviour can be tested without a full disk.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2160
 */

import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Exit code a solver uses when it refuses to start because the host is out of disk space.
 * 75 is EX_TEMPFAIL ("temporary failure, the user is invited to retry") from sysexits.h — the
 * closest standard meaning to "nothing is wrong with the request, retry later".
 */
export const EXIT_CODE_INSUFFICIENT_DISK_SPACE = 75;

/** Prefix of the temporary directories solve clones repositories into. */
export const SOLVER_WORKSPACE_PREFIX = 'gh-issue-solver-';

export const DEFAULT_TMP_ROOT = '/tmp';

/** A workspace whose contents changed this recently is never reclaimed. */
export const DEFAULT_MIN_IDLE_MS = 5 * 60 * 1000;

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const defaultRemove = async targetPath => fsPromises.rm(targetPath, { recursive: true, force: true });

/**
 * Free space in MB on the filesystem holding `targetPath`, or null when it cannot be determined.
 * `df -Pk` is POSIX-portable output (single line per filesystem, 1K blocks).
 */
export const getFreeDiskSpaceMB = async (targetPath = DEFAULT_TMP_ROOT, { exec = execFileAsync } = {}) => {
  try {
    const { stdout } = await exec('df', ['-Pk', targetPath]);
    const lines = String(stdout).trim().split('\n');
    if (lines.length < 2) return null;
    const columns = lines[lines.length - 1].trim().split(/\s+/);
    const availableKB = Number.parseInt(columns[3], 10);
    if (!Number.isFinite(availableKB)) return null;
    return Math.floor(availableKB / 1024);
  } catch {
    return null;
  }
};

/** Every `/tmp/gh-issue-solver-*` directory, oldest modification first. */
export const listSolverWorkspaces = async ({ tmpRoot = DEFAULT_TMP_ROOT, fileSystem = fsPromises } = {}) => {
  let entries;
  try {
    entries = await fileSystem.readdir(tmpRoot);
  } catch {
    return [];
  }
  const workspaces = [];
  for (const entry of entries) {
    const name = typeof entry === 'string' ? entry : entry.name;
    if (!name || !name.startsWith(SOLVER_WORKSPACE_PREFIX)) continue;
    const workspacePath = path.join(tmpRoot, name);
    let stats;
    try {
      stats = await fileSystem.stat(workspacePath);
    } catch {
      continue;
    }
    if (typeof stats.isDirectory === 'function' && !stats.isDirectory()) continue;
    workspaces.push({ path: workspacePath, name, mtimeMs: Number(stats.mtimeMs) || 0 });
  }
  return workspaces.sort((a, b) => a.mtimeMs - b.mtimeMs);
};

/**
 * Workspaces that a live process is currently sitting in. The AI tool runs with its workspace as
 * cwd, so /proc/<pid>/cwd is an authoritative "do not touch" signal on Linux. When /proc cannot be
 * read (macOS, restricted container) every workspace is reported as busy — refusing to guess is the
 * only safe answer, since deleting a live workspace would destroy real work.
 */
export const findBusySolverWorkspaces = async ({ workspaces = [], procRoot = '/proc', fileSystem = fsPromises } = {}) => {
  if (!workspaces.length) return new Set();
  let pids;
  try {
    pids = (await fileSystem.readdir(procRoot)).map(entry => (typeof entry === 'string' ? entry : entry.name)).filter(name => /^\d+$/.test(name));
  } catch {
    return new Set(workspaces.map(workspace => workspace.path));
  }
  const cwds = [];
  for (const pid of pids) {
    try {
      cwds.push(String(await fileSystem.readlink(path.join(procRoot, pid, 'cwd'))));
    } catch {
      // The process exited, or its cwd is not readable by this user — nothing to protect here.
    }
  }
  const busy = new Set();
  for (const workspace of workspaces) {
    if (cwds.some(cwd => cwd === workspace.path || cwd.startsWith(`${workspace.path}/`))) busy.add(workspace.path);
  }
  return busy;
};

/**
 * Entries of the given temp roots that `--auto-cleanup` may delete.
 *
 * The old implementation ran `sudo rm -rf /tmp/* /var/tmp/*`, which also destroys the workspaces,
 * lock directories and log files of any *concurrent* hive/solve run on the same host — the run
 * doing the cleanup is rarely the only tenant of /tmp. This builds an explicit list instead and
 * leaves alone anything a live process is sitting in, anything the caller marked as protected, and
 * the run's own log file.
 *
 * @param {Object} [options]
 * @param {Array<string>} [options.roots=['/tmp','/var/tmp']] - Directories to clean
 * @param {Iterable<string>} [options.protectedPaths] - Paths that must survive
 * @returns {Promise<{remove: Array<string>, keep: Array<{path: string, reason: string}>}>}
 */
export const listCleanableTempEntries = async ({ roots = ['/tmp', '/var/tmp'], protectedPaths = new Set(), fileSystem = fsPromises, procRoot = '/proc' } = {}) => {
  const protectedSet = new Set(Array.from(protectedPaths).filter(Boolean).map(String));
  const remove = [];
  const keep = [];
  const candidates = [];
  for (const root of roots) {
    let entries;
    try {
      entries = await fileSystem.readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const name = typeof entry === 'string' ? entry : entry.name;
      if (!name || name === '.' || name === '..') continue;
      candidates.push({ path: path.join(root, name), name, mtimeMs: 0 });
    }
  }
  const busy = await findBusySolverWorkspaces({ workspaces: candidates, procRoot, fileSystem });
  for (const candidate of candidates) {
    const isProtected = protectedSet.has(candidate.path) || Array.from(protectedSet).some(protectedPath => protectedPath.startsWith(`${candidate.path}/`));
    if (isProtected) {
      keep.push({ path: candidate.path, reason: 'protected' });
      continue;
    }
    if (busy.has(candidate.path)) {
      keep.push({ path: candidate.path, reason: 'process_cwd' });
      continue;
    }
    remove.push(candidate.path);
  }
  return { remove, keep };
};

/** Workspace paths mentioned in a line of solver output, used to protect in-flight workspaces. */
export const extractSolverWorkspacePaths = (text, { tmpRoot = DEFAULT_TMP_ROOT } = {}) => {
  if (!text) return [];
  const pattern = new RegExp(`${tmpRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/${SOLVER_WORKSPACE_PREFIX}[A-Za-z0-9_-]+`, 'g');
  return Array.from(new Set(String(text).match(pattern) || []));
};

/**
 * Remove idle solver workspaces, oldest first, until `requiredMB` is free.
 * A workspace is skipped when it is in flight, is some process's cwd, or was modified recently.
 */
export const reclaimSolverWorkspaces = async ({ requiredMB = 0, tmpRoot = DEFAULT_TMP_ROOT, protectedPaths = new Set(), minIdleMs = DEFAULT_MIN_IDLE_MS, now = Date.now, log = async () => {}, fileSystem = fsPromises, procRoot = '/proc', getFreeMB = getFreeDiskSpaceMB, remove = defaultRemove } = {}) => {
  const removed = [];
  const skipped = [];
  let freeMB = await getFreeMB(tmpRoot);
  const workspaces = await listSolverWorkspaces({ tmpRoot, fileSystem });
  if (!workspaces.length) return { removed, skipped, freeMB };
  const busy = await findBusySolverWorkspaces({ workspaces, procRoot, fileSystem });
  const currentTime = now();
  for (const workspace of workspaces) {
    if (freeMB !== null && freeMB >= requiredMB) break;
    if (protectedPaths.has(workspace.path)) {
      skipped.push({ path: workspace.path, reason: 'in_flight' });
      continue;
    }
    if (busy.has(workspace.path)) {
      skipped.push({ path: workspace.path, reason: 'process_cwd' });
      continue;
    }
    if (currentTime - workspace.mtimeMs < minIdleMs) {
      skipped.push({ path: workspace.path, reason: 'recently_modified' });
      continue;
    }
    try {
      await remove(workspace.path);
      removed.push(workspace.path);
      await log(`   🧹 Reclaimed idle solver workspace: ${workspace.path}`);
    } catch (error) {
      skipped.push({ path: workspace.path, reason: 'remove_failed', error });
      await log(`   ⚠️  Could not remove ${workspace.path}: ${error.message}`, { level: 'warning' });
      continue;
    }
    freeMB = await getFreeMB(tmpRoot);
  }
  return { removed, skipped, freeMB };
};

/**
 * Make sure `requiredMB` is free before a worker starts a task.
 *
 * Returns `{ ok: true }` when there is (or there now is) enough space, and
 * `{ ok: false, reason: 'insufficient_disk_space' }` when the caller should defer the task instead
 * of spawning a solver that would die in its pre-flight check.
 *
 * An unreadable `df` never blocks work: the guard is an optimisation over solve's own pre-flight
 * check, not a replacement for it.
 */
export const ensureDiskSpaceForWorker = async ({ requiredMB = 10240, tmpRoot = DEFAULT_TMP_ROOT, protectedPaths = new Set(), minIdleMs = DEFAULT_MIN_IDLE_MS, maxWaitMs = 0, pollIntervalMs = 30000, log = async () => {}, now = Date.now, sleep = defaultSleep, getFreeMB = getFreeDiskSpaceMB, fileSystem = fsPromises, procRoot = '/proc', remove = defaultRemove } = {}) => {
  const startedAt = now();
  const reclaimed = [];
  let freeMB = await getFreeMB(tmpRoot);
  if (freeMB === null) {
    await log('   💾 Could not determine free disk space — continuing and letting the solver pre-flight check decide', { verbose: true });
    return { ok: true, freeMB: null, reason: 'unknown_free_space', reclaimed, waitedMs: 0 };
  }
  if (freeMB >= requiredMB) {
    await log(`   💾 Disk space before starting work: ${freeMB}MB free (${requiredMB}MB required)`, { verbose: true });
    return { ok: true, freeMB, reason: 'sufficient', reclaimed, waitedMs: 0 };
  }
  await log(`   💾 Low disk space: ${freeMB}MB free, ${requiredMB}MB required — reclaiming idle solver workspaces before starting work`, { level: 'warning' });
  for (;;) {
    const result = await reclaimSolverWorkspaces({ requiredMB, tmpRoot, protectedPaths, minIdleMs, now, log, fileSystem, procRoot, getFreeMB, remove });
    reclaimed.push(...result.removed);
    if (result.freeMB !== null && result.freeMB !== undefined) freeMB = result.freeMB;
    if (freeMB >= requiredMB) {
      await log(`   ✅ Disk space recovered: ${freeMB}MB free after reclaiming ${result.removed.length} workspace(s)`);
      return { ok: true, freeMB, reason: 'reclaimed', reclaimed, waitedMs: now() - startedAt };
    }
    const elapsedMs = now() - startedAt;
    if (elapsedMs + pollIntervalMs > maxWaitMs) {
      return { ok: false, freeMB, reason: 'insufficient_disk_space', reclaimed, waitedMs: elapsedMs, skipped: result.skipped };
    }
    await log(`   ⏳ Still ${freeMB}MB free of the ${requiredMB}MB required — waiting ${Math.round(pollIntervalMs / 1000)}s for in-flight work to release disk space`);
    await sleep(pollIntervalMs);
  }
};
