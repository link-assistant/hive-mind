/**
 * Keep Codex rollouts where a later run in another container can find them
 * (issue #2888).
 *
 * solve runs Codex with a fresh task-owned `CODEX_HOME`. Older releases used
 * `~/.codex/hive-mind/repositories/<owner>/<repo>` (issue #2074). Codex writes
 * each thread's rollout to `$CODEX_HOME/sessions/YYYY/MM/DD/
 * rollout-<timestamp>-<thread id>.jsonl`, and `codex exec resume <id>` reads only
 * that directory. A Docker task container bind-mounts just `~/.codex/auth.json`
 * and `~/.codex/sessions` (issue #2190), so the scoped home, and the only copy
 * of the thread, died with the container. A kill-recovery run in a new
 * container then failed with "no rollout found for thread id …".
 *
 * `<scoped CODEX_HOME>/sessions` is therefore a relative symlink to the operator
 * `~/.codex/sessions`, which is mounted. Config, plugins and state databases
 * stay task-owned. Full native history/index/SQLite projection remains open,
 * so successful execution homes must be retained. Checked with codex-cli
 * 0.162.1: a brand-new CODEX_HOME
 * whose `sessions` links to the shared directory resumes the thread, and one
 * without the link fails with exactly the error above.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2888
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { publishCodexRollout } from './codex-rollout-publication.lib.mjs';

/** Directory under `CODEX_HOME` that holds the rollouts. */
export const CODEX_SESSIONS_DIRNAME = 'sessions';

/** `YYYY/MM/DD` plus slack; the walk never goes deeper. */
const MAX_ROLLOUT_SEARCH_DEPTH = 5;

/** Only ids of this shape are matched against file names. */
const THREAD_ID_PATTERN = /^[0-9a-zA-Z][0-9a-zA-Z_-]{7,127}$/u;

/** True when `name` is the rollout file of `threadId`. */
export function isCodexRolloutFileName(name, threadId) {
  if (typeof name !== 'string' || typeof threadId !== 'string' || !name.startsWith('rollout-')) return false;
  const plain = name.endsWith('.zst') ? name.slice(0, -4) : name;
  if (plain.endsWith(`-${threadId}.jsonl`)) return true;
  // Native revert preserves the stable thread id and appends a rollout UUID.
  const reverted = plain.match(/_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.jsonl$/iu);
  return Boolean(reverted && plain.slice(0, reverted.index).endsWith(`-${threadId}`));
}

/**
 * Find a thread's rollout under a Codex `sessions` directory (which may itself
 * be a symlink). Newest date directories are searched first.
 *
 * @returns {Promise<string|null>} Path of the rollout, or null
 */
export async function findCodexRolloutFile({ sessionsDir, threadId, fsImpl = fs } = {}) {
  if (!sessionsDir || !THREAD_ID_PATTERN.test(String(threadId || ''))) return null;
  const walk = async (dir, depth) => {
    const entries = await fsImpl.readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!entries) return null;
    const sorted = [...entries].sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
    const file = sorted.find(entry => entry.isFile() && isCodexRolloutFileName(entry.name, threadId));
    if (file) return path.join(dir, file.name);
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
 * Check, once per solve, that the caller's `--resume <thread>` has a rollout in
 * the `CODEX_HOME` the run uses. A run in a new container may not have it, and
 * `codex exec resume` would fail at once, so solve starts a new Codex session
 * on the same branch instead. Call it on every attempt (with no `threadId` when
 * the attempt does not resume): later attempts resume threads this run just
 * wrote, so they answer true without looking.
 *
 * @returns {(options: {threadId?: string|null, codexHome?: string, log?: Function}) => Promise<boolean>}
 */
export function createCodexResumeRolloutCheck({ homeDir = os.homedir(), fsImpl = fs } = {}) {
  let checked = false;
  return async ({ threadId = null, codexHome = null, log = async () => {} } = {}) => {
    const first = !checked;
    checked = true;
    if (!threadId) return false;
    if (!first) return true;
    const sessionsDir = path.join(codexHome || path.join(homeDir, '.codex'), CODEX_SESSIONS_DIRNAME);
    const rollout = await findCodexRolloutFile({ sessionsDir, threadId, fsImpl });
    await log(`   Codex rollout for ${threadId}: ${rollout || `not found under ${sessionsDir}`}`, { verbose: true });
    if (!rollout) await log(`⚠️  Codex thread ${threadId} has no rollout under ${sessionsDir}; starting a new Codex session on the same branch instead of resuming it (issue #2888)`, { level: 'warn' });
    return Boolean(rollout);
  };
}

/** Copy legacy rollouts into shared storage, retaining their original evidence. */
async function mergeDirectoryInto({ sourceDir, targetDir, fsImpl }) {
  let moved = 0;
  let kept = 0;
  await fsImpl.mkdir(targetDir, { recursive: true, mode: 0o700 });
  for (const entry of await fsImpl.readdir(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await mergeDirectoryInto({ sourceDir: source, targetDir: target, fsImpl });
      moved += nested.moved;
      kept += nested.kept;
      continue;
    }
    if (!entry.isFile()) continue;
    if ((await publishCodexRollout({ source, target, fsImpl })).published) moved += 1;
    else kept += 1;
  }
  return { moved, kept };
}

/** True when `link` is a symlink that resolves to `target`. */
const linksTo = async (fsImpl, link, target) => {
  const current = await fsImpl.readlink(link).catch(() => null);
  return current !== null && path.resolve(path.dirname(link), current) === path.resolve(target);
};

/**
 * Make `<codexHome>/sessions` a relative symlink to `<baseCodexHome>/sessions`.
 * A real directory left by an older run is merged into the shared one first;
 * publication never replaces an existing name, and the original directory is
 * set aside even after successful copying. Never throws; callers must refuse
 * execution when sharing fails, as capability preflight does.
 *
 * @returns {Promise<{status: 'shared'|'already-shared'|'same-home'|'failed', sessionsDir: string|null, target: string|null, migrated: number, kept: number, error: string|null}>}
 */
export async function shareScopedCodexSessions({ baseCodexHome, codexHome, fsImpl = fs, now = Date.now } = {}) {
  const result = { status: 'failed', sessionsDir: null, target: null, migrated: 0, kept: 0, error: null };
  if (!baseCodexHome || !codexHome) return { ...result, error: 'baseCodexHome and codexHome are required' };
  const sessionsDir = path.join(codexHome, CODEX_SESSIONS_DIRNAME);
  const target = path.join(baseCodexHome, CODEX_SESSIONS_DIRNAME);
  Object.assign(result, { sessionsDir, target });
  if (path.resolve(sessionsDir) === path.resolve(target)) return { ...result, status: 'same-home' };
  try {
    await fsImpl.mkdir(target, { recursive: true, mode: 0o700 });
    const stat = await fsImpl.lstat(sessionsDir).catch(() => null);
    if (stat?.isSymbolicLink()) {
      if (await linksTo(fsImpl, sessionsDir, target)) return { ...result, status: 'already-shared' };
      await fsImpl.rm(sessionsDir, { force: true });
    } else if (stat?.isDirectory()) {
      const merged = await mergeDirectoryInto({ sourceDir: sessionsDir, targetDir: target, fsImpl });
      Object.assign(result, { migrated: merged.moved, kept: merged.kept });
      // Preserve even unrecognized entries and writes arriving during migration.
      await fsImpl.rename(sessionsDir, `${sessionsDir}.pre-issue-2888-${now()}`);
    } else if (stat) {
      await fsImpl.rm(sessionsDir, { force: true });
    }
    await fsImpl.mkdir(path.dirname(sessionsDir), { recursive: true });
    try {
      await fsImpl.symlink(path.relative(path.dirname(sessionsDir), target), sessionsDir, 'dir');
    } catch (error) {
      // Another solve of the same repository linked it first.
      if (error?.code !== 'EEXIST' || !(await linksTo(fsImpl, sessionsDir, target))) throw error;
      return { ...result, status: 'already-shared' };
    }
    return { ...result, status: 'shared' };
  } catch (error) {
    return { ...result, status: 'failed', error: error?.message || String(error) };
  }
}

/** One log line for {@link shareScopedCodexSessions}'s outcome, or null. */
export function describeScopedCodexSessions(outcome) {
  if (!outcome || outcome.status === 'same-home') return null;
  if (outcome.status === 'shared' || outcome.status === 'already-shared') {
    const notes = [outcome.status === 'already-shared' ? 'already shared' : null, outcome.migrated ? `copied ${outcome.migrated} existing rollout file(s); retained originals` : null, outcome.kept ? `kept ${outcome.kept} conflicting file(s) aside` : null].filter(Boolean);
    return `   🧵 Codex rollouts: ${outcome.sessionsDir} → ${outcome.target}${notes.length ? ` (${notes.join(', ')})` : ''}`;
  }
  return `   ⚠️  Codex rollouts stay in ${outcome.sessionsDir || 'the repository-scoped CODEX_HOME'}: could not share them with ${outcome.target || 'the operator CODEX_HOME'} (${outcome.error || 'unknown error'}). A recovery run in another container will not be able to resume this thread (issue #2888).`;
}
