/**
 * Keep Codex rollouts where every later run can find them (issue #2888).
 *
 * `solve` runs Codex with a repository-scoped `CODEX_HOME`
 * (`~/.codex/hive-mind/repositories/<owner>/<repo>`, issue #2074), and Codex
 * writes every thread's rollout to `$CODEX_HOME/sessions/YYYY/MM/DD/
 * rollout-<timestamp>-<thread id>.jsonl`. `codex exec resume <id>` only looks
 * there. A Docker task container, however, bind-mounts just `~/.codex/auth.json`
 * and `~/.codex/sessions` (issue #2190), so the scoped home — and with it the
 * only copy of the thread — died with the container. A kill-recovery run in a
 * new container then failed with
 *
 *   Error: thread/resume: thread/resume failed: no rollout found for thread id … (code -32600)
 *
 * Making `<scoped CODEX_HOME>/sessions` a relative symlink to the operator's
 * `~/.codex/sessions` puts every rollout on the mounted volume while each
 * repository keeps its own config, plugins and state databases. Reproduced and
 * verified with codex-cli 0.161.0 in
 * experiments/issue-2888/codex-resume-rollout-location.sh.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2888
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Directory under `CODEX_HOME` that holds the rollouts. */
export const CODEX_SESSIONS_DIRNAME = 'sessions';

/** `YYYY/MM/DD` plus slack for future layouts; the walk never goes deeper. */
const MAX_ROLLOUT_SEARCH_DEPTH = 5;

/** Codex thread ids are UUIDs; anything else is never used to build a file pattern. */
const THREAD_ID_PATTERN = /^[0-9a-zA-Z][0-9a-zA-Z_-]{7,127}$/u;

/** True when `name` is the rollout file of `threadId`. */
export const isCodexRolloutFileName = (name, threadId) => typeof name === 'string' && typeof threadId === 'string' && name.startsWith('rollout-') && name.endsWith(`-${threadId}.jsonl`);

/**
 * Find a thread's rollout under a Codex `sessions` directory.
 *
 * @param {Object} options
 * @param {string} options.sessionsDir - `$CODEX_HOME/sessions` (may itself be a symlink)
 * @param {string} options.threadId - Codex thread id, as passed to `codex exec resume`
 * @param {Object} [options.fsImpl] - `node:fs/promises`-compatible, for tests
 * @returns {Promise<string|null>} Absolute path of the rollout, or null
 */
export async function findCodexRolloutFile({ sessionsDir, threadId, fsImpl = fs } = {}) {
  if (!sessionsDir || !THREAD_ID_PATTERN.test(String(threadId || ''))) return null;
  const walk = async (dir, depth) => {
    let entries;
    try {
      entries = await fsImpl.readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    // Newest date directories first: a resumed thread is usually recent.
    const sorted = [...entries].sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
    for (const entry of sorted) {
      if (entry.isFile() && isCodexRolloutFileName(entry.name, threadId)) return path.join(dir, entry.name);
    }
    if (depth >= MAX_ROLLOUT_SEARCH_DEPTH) return null;
    for (const entry of sorted) {
      if (!entry.isDirectory()) continue;
      const found = await walk(path.join(dir, entry.name), depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(sessionsDir, 0);
}

/**
 * A check for the caller's `--resume <thread>`, run once per solve. `codex exec
 * resume` reads only `$CODEX_HOME/sessions`; a run in a new container (kill
 * recovery) may not have the thread, and resuming it would fail with "no
 * rollout found", so the check answers false and solve starts a new exec on the
 * same branch instead. Call it on every attempt, with no `threadId` when the
 * attempt does not resume: only the first attempt carries the caller's thread.
 * In-run retries resume threads an earlier attempt just wrote, so later calls
 * answer true without looking.
 *
 * @returns {(options: {threadId?: string|null, codexHome?: string, log?: Function}) => Promise<boolean>}
 */
export function createCodexResumeRolloutCheck({ homeDir = os.homedir(), fsImpl = fs } = {}) {
  let checked = false;
  return async ({ threadId = null, codexHome, log = async () => {} } = {}) => {
    const first = !checked;
    checked = true;
    if (!threadId) return false;
    if (!first) return true;
    const sessionsDir = path.join(codexHome || path.join(homeDir, '.codex'), CODEX_SESSIONS_DIRNAME);
    const rollout = await findCodexRolloutFile({ sessionsDir, threadId, fsImpl });
    await log(`   Codex rollout for ${threadId}: ${rollout || `not found under ${sessionsDir}`}`, { verbose: true });
    if (!rollout) await log(`⚠️  Codex thread ${threadId} has no rollout under ${sessionsDir}; starting a new Codex session instead of resuming it (issue #2888)`, { level: 'warning' });
    return Boolean(rollout);
  };
}

/** Move every file of `sourceDir` into `targetDir` without overwriting anything there. */
const mergeDirectoryInto = async ({ sourceDir, targetDir, fsImpl }) => {
  let moved = 0;
  let kept = 0;
  const entries = await fsImpl.readdir(sourceDir, { withFileTypes: true });
  await fsImpl.mkdir(targetDir, { recursive: true });
  for (const entry of entries) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await mergeDirectoryInto({ sourceDir: source, targetDir: target, fsImpl });
      moved += nested.moved;
      kept += nested.kept;
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      await fsImpl.access(target);
      // Same name already on the shared volume: never overwrite another run's rollout.
      kept += 1;
      continue;
    } catch {
      // Not there yet — move it below.
    }
    try {
      await fsImpl.rename(source, target);
    } catch (error) {
      if (error?.code !== 'EXDEV') throw error;
      // The scoped home and the mounted sessions directory are usually on different filesystems.
      await fsImpl.copyFile(source, target);
      await fsImpl.rm(source, { force: true });
    }
    moved += 1;
  }
  return { moved, kept };
};

/**
 * Make `<codexHome>/sessions` a relative symlink to `<baseCodexHome>/sessions`.
 *
 * A real directory left by an older run is merged into the shared one first
 * (files that already exist there are kept, never overwritten), so no thread is
 * lost. Never throws: a run whose sessions could not be shared still works — it
 * just cannot be resumed from another container — so the caller logs the
 * returned status instead of failing the task.
 *
 * @param {Object} options
 * @param {string} options.baseCodexHome - Operator `CODEX_HOME` (its `sessions` is what task containers mount)
 * @param {string} options.codexHome - Repository-scoped `CODEX_HOME`
 * @param {Object} [options.fsImpl] - `node:fs/promises`-compatible, for tests
 * @returns {Promise<{status: 'shared'|'already-shared'|'same-home'|'failed', sessionsDir: string|null, target: string|null, migrated: number, kept: number, error: string|null}>}
 */
export async function shareScopedCodexSessions({ baseCodexHome, codexHome, fsImpl = fs } = {}) {
  const result = { status: 'failed', sessionsDir: null, target: null, migrated: 0, kept: 0, error: null };
  if (!baseCodexHome || !codexHome) return { ...result, error: 'baseCodexHome and codexHome are required' };
  const sessionsDir = path.join(codexHome, CODEX_SESSIONS_DIRNAME);
  const target = path.join(baseCodexHome, CODEX_SESSIONS_DIRNAME);
  Object.assign(result, { sessionsDir, target });
  if (path.resolve(sessionsDir) === path.resolve(target)) return { ...result, status: 'same-home' };
  try {
    await fsImpl.mkdir(target, { recursive: true });
    let stat = null;
    try {
      stat = await fsImpl.lstat(sessionsDir);
    } catch {
      stat = null;
    }
    if (stat?.isSymbolicLink()) {
      const current = await fsImpl.readlink(sessionsDir);
      if (path.resolve(path.dirname(sessionsDir), current) === path.resolve(target)) return { ...result, status: 'already-shared' };
      await fsImpl.rm(sessionsDir, { force: true });
    } else if (stat?.isDirectory()) {
      const merged = await mergeDirectoryInto({ sourceDir: sessionsDir, targetDir: target, fsImpl });
      Object.assign(result, { migrated: merged.moved, kept: merged.kept });
      if (merged.kept > 0) {
        // Keep the conflicting copies next to the scoped home instead of deleting them.
        await fsImpl.rename(sessionsDir, `${sessionsDir}.pre-issue-2888-${Date.now()}`);
      } else {
        await fsImpl.rm(sessionsDir, { recursive: true, force: true });
      }
    } else if (stat) {
      await fsImpl.rm(sessionsDir, { force: true });
    }
    await fsImpl.mkdir(path.dirname(sessionsDir), { recursive: true });
    await fsImpl.symlink(path.relative(path.dirname(sessionsDir), target), sessionsDir, 'dir');
    return { ...result, status: 'shared' };
  } catch (error) {
    return { ...result, status: 'failed', error: error?.message || String(error) };
  }
}

/** One log line describing {@link shareScopedCodexSessions}'s outcome. */
export function describeScopedCodexSessions(outcome) {
  if (!outcome) return null;
  switch (outcome.status) {
    case 'shared':
      return `   🧵 Codex rollouts: ${outcome.sessionsDir} → ${outcome.target}${outcome.migrated ? ` (moved ${outcome.migrated} existing rollout file(s))` : ''}${outcome.kept ? ` (kept ${outcome.kept} conflicting file(s) aside)` : ''}`;
    case 'already-shared':
      return `   🧵 Codex rollouts: ${outcome.sessionsDir} → ${outcome.target} (already shared)`;
    case 'same-home':
      return null;
    default:
      return `   ⚠️  Codex rollouts stay in ${outcome.sessionsDir || 'the repository-scoped CODEX_HOME'}: could not share them with ${outcome.target || 'the operator CODEX_HOME'} (${outcome.error || 'unknown error'}). A recovery run in another container will not be able to resume this thread (issue #2888).`;
  }
}
