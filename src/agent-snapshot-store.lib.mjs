/**
 * Reclaim orphaned `@link-assistant/agent` snapshot stores (issue #2186).
 *
 * Agent keeps a rollback snapshot per project in
 * `$XDG_DATA_HOME/link-assistant-agent/snapshot/<project id>`, where the project
 * id is the worktree's *root commit*, and records the worktree it belongs to in
 * `storage/project/<project id>.json`. Hive Mind runs its tools in throwaway
 * checkouts, so every fresh `git init` looks like a brand-new project and gets
 * its own store; up to agent 0.26.0 that store was a standalone object database
 * (no `objects/info/alternates`) that nothing ever removed. One 9.5 h task left
 * 115 stores / 31 GB behind, ~270 MB each, at ~5 GB/h.
 *
 * Agent 0.26.1 fixes both halves upstream — it shares the repository's objects
 * and prunes dead projects itself (link-assistant/agent#298) — and
 * `src/agent.lib.mjs` refuses to run on anything older. That is not the whole
 * story for Hive Mind, for three reasons:
 *
 *   - agent only prunes when agent runs, and the disk gate that decides whether
 *     a task may start at all runs *before* that (and before any `--tool codex`
 *     / `--tool claude` task, which never runs agent);
 *   - a host upgraded from 0.26.0 still carries whatever it leaked before;
 *   - `disk-guard.lib.mjs`, `cleanup.lib.mjs` and the 10 GB pre-flight gate only
 *     ever looked at `/tmp`, so this growth was invisible to every disk check
 *     Hive Mind owns — the exact blind spot issue #2186 reported.
 *
 * The pruning rule is the conservative one from the issue: a store is garbage
 * only when the worktree its project record points at no longer exists (or the
 * record is gone entirely) *and* the store has been idle for `minIdleMs`. A
 * store whose worktree is still on disk belongs to a live checkout and is never
 * touched, so this cannot interfere with a concurrent session. Orphans have no
 * debugging value either — there is nothing left to restore them into — so this
 * is not gated on `--auto-cleanup`.
 *
 * Every side effect (readdir, stat, rm, clock) is injectable so the behaviour is
 * unit-testable without a real agent installation.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2186
 * @see https://github.com/link-assistant/agent/issues/298
 */

import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Directory agent creates under the XDG data home. */
export const AGENT_DATA_DIR_NAME = 'link-assistant-agent';

/**
 * A store modified this recently is never reclaimed. 15 minutes is agent's own
 * `recentSnapshotAge` (src/project/project.ts), which is what keeps a store that
 * was just created — before its project record has been written — from being
 * mistaken for an orphan.
 */
export const DEFAULT_AGENT_SNAPSHOT_MIN_IDLE_MS = 15 * 60 * 1000;

/** `$XDG_DATA_HOME/link-assistant-agent`, or `~/.local/share/link-assistant-agent`. */
export const getAgentDataHome = ({ env = process.env, homeDir = os.homedir } = {}) => {
  const xdgDataHome = String(env?.XDG_DATA_HOME || '').trim();
  const dataRoot = xdgDataHome || path.join(homeDir(), '.local', 'share');
  return path.join(dataRoot, AGENT_DATA_DIR_NAME);
};

/** Every `snapshot/<project id>` directory, oldest modification first. */
export const listAgentSnapshotStores = async ({ dataHome = getAgentDataHome(), fileSystem = fsPromises } = {}) => {
  const snapshotRoot = path.join(dataHome, 'snapshot');
  let names;
  try {
    names = await fileSystem.readdir(snapshotRoot);
  } catch {
    return [];
  }
  const stores = [];
  for (const entry of names) {
    const name = typeof entry === 'string' ? entry : entry?.name;
    if (!name) continue;
    const storePath = path.join(snapshotRoot, name);
    try {
      const stats = await fileSystem.stat(storePath);
      if (!stats.isDirectory()) continue;
      stores.push({ id: name, path: storePath, mtimeMs: Number(stats.mtimeMs) || 0 });
    } catch {
      continue;
    }
  }
  return stores.sort((a, b) => a.mtimeMs - b.mtimeMs);
};

/**
 * The worktree agent recorded for a project id, `null` when there is no usable
 * record. A missing record is not an error: agent writes the store first.
 */
export const readAgentProjectWorktree = async ({ dataHome = getAgentDataHome(), projectId, fileSystem = fsPromises } = {}) => {
  try {
    const raw = await fileSystem.readFile(path.join(dataHome, 'storage', 'project', `${projectId}.json`), 'utf8');
    const worktree = JSON.parse(String(raw))?.worktree;
    return typeof worktree === 'string' && worktree ? worktree : null;
  } catch {
    return null;
  }
};

/** True when `worktree` still exists as a directory. */
const isWorktreeAlive = async (worktree, fileSystem) => {
  if (!worktree) return false;
  try {
    return (await fileSystem.stat(worktree)).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Split the stores into the ones that are safe to delete and the ones that must
 * stay, with the reason for each so `hive-cleanup --dry-run` can explain itself.
 *
 * @returns {Promise<{orphaned: Array<{id: string, path: string, mtimeMs: number, worktree: string|null, reason: string}>, keep: Array<{id: string, path: string, mtimeMs: number, worktree: string|null, reason: string}>}>}
 */
export const classifyAgentSnapshotStores = async ({ dataHome = getAgentDataHome(), minIdleMs = DEFAULT_AGENT_SNAPSHOT_MIN_IDLE_MS, now = Date.now, fileSystem = fsPromises, stores = null } = {}) => {
  const candidates = stores || (await listAgentSnapshotStores({ dataHome, fileSystem }));
  const currentTime = now();
  const orphaned = [];
  const keep = [];
  for (const store of candidates) {
    const worktree = await readAgentProjectWorktree({ dataHome, projectId: store.id, fileSystem });
    if (await isWorktreeAlive(worktree, fileSystem)) {
      keep.push({ ...store, worktree, reason: 'worktree_alive' });
      continue;
    }
    if (currentTime - store.mtimeMs < minIdleMs) {
      keep.push({ ...store, worktree, reason: 'recently_modified' });
      continue;
    }
    orphaned.push({ ...store, worktree, reason: worktree ? 'worktree_gone' : 'no_project_record' });
  }
  return { orphaned, keep };
};

/** Human-readable form of the reasons produced by {@link classifyAgentSnapshotStores}. */
export const describeAgentSnapshotReason = reason =>
  ({
    worktree_alive: 'worktree still exists',
    recently_modified: 'modified too recently to be considered idle',
    worktree_gone: 'recorded worktree no longer exists',
    no_project_record: 'no project record, idle',
    remove_failed: 'could not be removed',
  })[reason] || reason;

const defaultRemove = async targetPath => fsPromises.rm(targetPath, { recursive: true, force: true });

/**
 * Delete every orphaned store. Stops early once `stopWhenFreeMB` megabytes are
 * free, which is what lets the disk guard reclaim only as much as a task needs.
 *
 * @returns {Promise<{removed: Array<string>, skipped: Array<object>, freeMB: number|null}>}
 */
export const reclaimAgentSnapshotStores = async ({ dataHome = getAgentDataHome(), minIdleMs = DEFAULT_AGENT_SNAPSHOT_MIN_IDLE_MS, stopWhenFreeMB = null, getFreeMB = null, now = Date.now, log = async () => {}, fileSystem = fsPromises, remove = defaultRemove } = {}) => {
  const { orphaned, keep } = await classifyAgentSnapshotStores({ dataHome, minIdleMs, now, fileSystem });
  const removed = [];
  const skipped = keep.map(store => ({ path: store.path, reason: store.reason }));
  let freeMB = getFreeMB ? await getFreeMB(dataHome) : null;
  for (const store of orphaned) {
    if (stopWhenFreeMB !== null && freeMB !== null && freeMB >= stopWhenFreeMB) break;
    try {
      await remove(store.path);
      removed.push(store.path);
      await log(`   🧹 Reclaimed orphaned agent snapshot store: ${store.path} (${describeAgentSnapshotReason(store.reason)})`);
    } catch (error) {
      skipped.push({ path: store.path, reason: 'remove_failed', error });
      await log(`   ⚠️  Could not remove ${store.path}: ${error.message}`, { level: 'warning' });
      continue;
    }
    if (getFreeMB) freeMB = await getFreeMB(dataHome);
  }
  return { removed, skipped, freeMB };
};

/**
 * Upper bound on directory entries visited while sizing the agent data home.
 * The whole point of issue #2186 is that this tree can hold tens of gigabytes of
 * loose git objects, so an unbounded `du` in the middle of a logging call would
 * be the second bug. When the cap is hit the result is reported as `truncated`
 * and the byte count is a lower bound.
 */
export const AGENT_SNAPSHOT_USAGE_ENTRY_LIMIT = 20_000;

/**
 * How much disk the agent snapshot stores currently occupy, for the resource
 * snapshots in `solve.resource-diagnostics.lib.mjs`. Before issue #2186 the
 * `RESOURCE_PHASE_AFTER_AGENT` line only showed a flat `/` reading, so 5 GB/h of
 * growth under `~/.local/share` was invisible in the solve log.
 *
 * @returns {Promise<{path: string, count: number, bytes: number, truncated: boolean}>}
 */
export const measureAgentSnapshotUsage = async ({ dataHome = getAgentDataHome(), fileSystem = fsPromises, entryLimit = AGENT_SNAPSHOT_USAGE_ENTRY_LIMIT } = {}) => {
  const stores = await listAgentSnapshotStores({ dataHome, fileSystem });
  const statPath = fileSystem.lstat ? fileSystem.lstat.bind(fileSystem) : fileSystem.stat.bind(fileSystem);
  let bytes = 0;
  let visited = 0;
  let truncated = false;

  const walk = async directory => {
    let names;
    try {
      names = await fileSystem.readdir(directory);
    } catch {
      return;
    }
    for (const entry of names) {
      if (visited >= entryLimit) {
        truncated = true;
        return;
      }
      const name = typeof entry === 'string' ? entry : entry?.name;
      if (!name) continue;
      visited += 1;
      const child = path.join(directory, name);
      let stats;
      try {
        stats = await statPath(child);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        await walk(child);
        continue;
      }
      // Symlinks are counted as their own (tiny) size, never followed: agent
      // 0.26.1 links stores to the repository object database, and following
      // those would report the checkout's objects as agent state.
      bytes += Number(stats.size) || 0;
    }
  };

  for (const store of stores) {
    await walk(store.path);
  }

  return { path: dataHome, count: stores.length, bytes, truncated };
};

export default {
  AGENT_DATA_DIR_NAME,
  AGENT_SNAPSHOT_USAGE_ENTRY_LIMIT,
  classifyAgentSnapshotStores,
  DEFAULT_AGENT_SNAPSHOT_MIN_IDLE_MS,
  describeAgentSnapshotReason,
  getAgentDataHome,
  listAgentSnapshotStores,
  measureAgentSnapshotUsage,
  readAgentProjectWorktree,
  reclaimAgentSnapshotStores,
};
