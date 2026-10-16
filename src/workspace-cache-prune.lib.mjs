/**
 * Issue #2293 (item 3): a kept task container's workspace drops its
 * regenerable build caches once the work is pushed.
 *
 * The link-foundation/meta-language#196 container stayed `Exited (1)` for 15 h
 * holding 27.7 GB, mostly the Rust `target/` of a workspace kept because
 * auto-cleanup is off by default for public repositories. Keeping the
 * container (HIVE_MIND_KEEP_TASK_CONTAINER, on-failure by default) and the
 * workspace for inspection stays as it is; only the directories a build
 * regenerates are removed, and only when nothing in the clone is lost:
 *
 * - the run is a Docker-isolated task (`HIVE_MIND_PARENT_SESSION_ID`), whose
 *   workspace lives as long as the container. Host workspaces have their own
 *   cleanup (`cleanup.os.lib.mjs`);
 * - the workspace is not kept for a resume after a usage limit, which would
 *   only rebuild the caches;
 * - `git status --porcelain` is empty and HEAD is not ahead of its upstream.
 *
 * What counts as a cache is the same as for kill-recovery snapshots (#2889):
 * directories marked by `CACHEDIR.TAG` (Cargo's `target/`) and
 * `node_modules/.cache`, never a directory holding sources.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2293
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildSnapshotCachePruneScript, parseSnapshotCachePruneOutput } from './kill-recovery-snapshot-cleanup.lib.mjs';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 30_000;
const PRUNE_TIMEOUT_MS = 10 * 60 * 1000;

/** Why the caches of `tempDir` must stay, or null when they can go. */
export async function workspaceCachePruneBlocker(tempDir, { argv = {}, limitReached = false, env = process.env, run = execFileAsync } = {}) {
  if (!String(env?.HIVE_MIND_PARENT_SESSION_ID || '').trim()) return 'not a Docker-isolated task';
  if (limitReached || (argv.autoResumeOnLimitReset && global.limitResetTime)) return 'the workspace is kept for a resume';
  const git = async args => (await run('git', ['-C', tempDir, ...args], { timeout: GIT_TIMEOUT_MS })).stdout.trim();
  try {
    if ((await git(['status', '--porcelain'])).length > 0) return 'the workspace has uncommitted changes';
  } catch (error) {
    return `git status failed: ${error?.message || error}`;
  }
  let upstream;
  try {
    upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  } catch {
    return 'the branch has no upstream';
  }
  try {
    const ahead = Number(await git(['rev-list', '--count', `${upstream}..HEAD`]));
    if (ahead !== 0) return `${ahead} commit${ahead === 1 ? ' is' : 's are'} not pushed to ${upstream}`;
  } catch (error) {
    return `git rev-list failed: ${error?.message || error}`;
  }
  return null;
}

/**
 * Prune the build caches of a kept workspace. Never throws.
 * @returns {Promise<{pruned: boolean, freedBytes: number, paths: string[], reason: string|null}>}
 */
export async function pruneKeptWorkspaceCaches(tempDir, { argv = {}, limitReached = false, env = process.env, run = execFileAsync, timeoutMs = PRUNE_TIMEOUT_MS } = {}) {
  const reason = await workspaceCachePruneBlocker(tempDir, { argv, limitReached, env, run });
  if (reason) return { pruned: false, freedBytes: 0, paths: [], reason };
  let stdout;
  let failure = null;
  try {
    ({ stdout } = await run('sh', ['-c', buildSnapshotCachePruneScript({ roots: [tempDir], requireGate: false })], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }));
  } catch (error) {
    stdout = error?.stdout;
    failure = error?.message || String(error);
  }
  const { paths, freedBytes } = parseSnapshotCachePruneOutput(stdout);
  return { pruned: paths.length > 0, freedBytes, paths, reason: failure };
}

export default { workspaceCachePruneBlocker, pruneKeptWorkspaceCaches };
