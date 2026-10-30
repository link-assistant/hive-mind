/** Tool auth/history mounts and host preparation for Docker isolation. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getRouterSuppressedCredentialPaths } from './router-isolation.lib.mjs';
import { prepareToolDataMount, toolDataMount } from './tool-data-mounts.lib.mjs';
import { prepareStorageDirectory } from './storage-directory.lib.mjs';

export const DOCKER_CONTAINER_HOME = '/home/box';
function normalizeTool(tool) {
  return String(tool || 'claude')
    .trim()
    .toLowerCase();
}
const historyUnavailable = tool => new Error(`Canonical ${tool === 'codex' ? 'Codex' : 'Claude'} history storage is unavailable; private fallback is prohibited.`);

/** Whether a host path exists, without blocking the bot's event loop on a stat (issue #3278). */
export const pathExists = target =>
  fs.promises.access(target).then(
    () => true,
    () => false
  );
async function maybeAddMount(mounts, source, target, exists) {
  if (!source) return;
  if (!(await exists(source))) return;
  mounts.push({ source, target });
}
/**
 * Per-tool host paths that a Docker-isolated task receives (issue #2190).
 *
 * Only the credential *file* and the session/transcript *directories* are
 * mounted — never the whole `~/.claude` / `~/.codex` application directory and
 * never `~/.claude.json` or `~/.agents`:
 *
 *   - a credential file mount shares its initial inode. Atomic replacement and
 *     scoped-home copies can still diverge (issue #3785); this list alone does
 *     not attest a canonical credential authority;
 *   - `projects/` and `sessions/` stay on the host for audit and discovery;
 *   - everything else (config, plugins, marketplaces, skills, MCP registrations,
 *     settings) comes from the image, so a task can neither inherit a globally
 *     synced plugin such as Superpowers nor reconfigure the global state for the
 *     tasks that follow it.
 *
 * `kind: 'file'` entries are only mounted when the host file exists (Docker
 * would otherwise create a directory in its place); `kind: 'dir'` entries are
 * created on the host by {@link prepareDockerIsolationHostPaths}.
 */
export const DOCKER_ISOLATION_TOOL_MOUNTS = Object.freeze({
  claude: Object.freeze([Object.freeze({ relativePath: path.join('.claude', '.credentials.json'), kind: 'file', role: 'auth' }), Object.freeze({ relativePath: path.join('.claude', 'projects'), kind: 'dir', role: 'sessions' }), Object.freeze({ relativePath: path.join('.claude', 'sessions'), kind: 'dir', role: 'sessions' })]),
  codex: Object.freeze([Object.freeze({ relativePath: path.join('.codex', 'auth.json'), kind: 'file', role: 'auth' }), Object.freeze({ relativePath: path.join('.codex', 'sessions'), kind: 'dir', role: 'sessions' }), Object.freeze({ relativePath: path.join('.codex', 'archived_sessions'), kind: 'dir', role: 'sessions' }), Object.freeze({ relativePath: path.join('.codex', 'thread-writer-locks'), kind: 'dir', role: 'coordination' })]),
});
/**
 * Is `relativePath` covered by one of the router-suppressed credential paths?
 * Suppression is by prefix so that `.claude` withholds `.claude/.credentials.json`
 * and `.claude/projects` alike: a routed task gets no vendor state at all.
 */
function isSuppressedPath(relativePath, suppressed) {
  for (const prefix of suppressed) {
    if (relativePath === prefix || relativePath.startsWith(`${prefix}${path.sep}`)) return true;
  }
  return false;
}
/**
 * Build host auth mounts for a Docker-isolated task.
 *
 * GitHub auth is mounted for every task because solve/hive/task need gh. Git
 * identity (`~/.gitconfig` and the XDG `~/.config/git` directory) is mounted for
 * every task too: it is tool-agnostic and `solve` aborts early with "Git
 * identity not configured" when `user.name`/`user.email` are absent, so a child
 * container that authenticates with gh but inherits no git identity still cannot
 * commit. See issue #1939. Tool credentials are deliberately scoped: Codex
 * sessions do not receive Claude files and Claude sessions do not receive Codex
 * files, and (issue #2190) only the entries in {@link DOCKER_ISOLATION_TOOL_MOUNTS}
 * are shared — the application directories themselves stay per container.
 *
 * Issue #2164 (EXPERIMENTAL): with `useRouter` the vendor credential mounts are
 * withheld entirely, so the task never holds the subscription — it reaches the
 * `hive-mind-router` sidecar with its own scoped token instead. Git identity is
 * still mounted, because it carries no secret and `solve` aborts without it
 * (issue #1939). The gh config is only withheld when `ghRouted` says gh has
 * somewhere else to go; otherwise the task would lose GitHub access entirely.
 */
export async function getDockerIsolationAuthMounts({ tool = 'claude', env = process.env, homeDir = os.homedir(), existsSync: exists = pathExists, useRouter = false, ghRouted = false } = {}) {
  const mounts = [];
  const normalizedTool = normalizeTool(tool);
  const suppressed = useRouter ? getRouterSuppressedCredentialPaths({ tool: normalizedTool, ghRouted }) : [];
  if (!isSuppressedPath(path.join('.config', 'gh'), suppressed)) {
    await maybeAddMount(mounts, env.GH_CONFIG_DIR || path.join(homeDir, '.config', 'gh'), path.join(DOCKER_CONTAINER_HOME, '.config', 'gh'), exists);
  }
  // Git identity (tool-agnostic, required for commits). Honor the same env vars git itself reads for an alternate global config location (GIT_CONFIG_GLOBAL) and the XDG base dir, falling back to the conventional `~/.gitconfig` and `~/.config/git`. Missing host paths are skipped, so a container image that already bakes a git identity is left untouched. See issue #1939.
  await maybeAddMount(mounts, env.GIT_CONFIG_GLOBAL || path.join(homeDir, '.gitconfig'), path.join(DOCKER_CONTAINER_HOME, '.gitconfig'), exists);
  await maybeAddMount(mounts, env.XDG_CONFIG_HOME ? path.join(env.XDG_CONFIG_HOME, 'git') : path.join(homeDir, '.config', 'git'), path.join(DOCKER_CONTAINER_HOME, '.config', 'git'), exists);
  for (const entry of DOCKER_ISOLATION_TOOL_MOUNTS[normalizedTool] || []) {
    if (isSuppressedPath(entry.relativePath, suppressed)) continue;
    const source = path.join(homeDir, entry.relativePath);
    const target = path.join(DOCKER_CONTAINER_HOME, entry.relativePath);
    if (entry.kind === 'dir') {
      if (!(await exists(source))) throw historyUnavailable(normalizedTool);
      mounts.push({ source, target });
    } else {
      await maybeAddMount(mounts, source, target, exists);
    }
  }
  const dataMount = !useRouter && toolDataMount({ tool: normalizedTool, homeDir, env });
  if (dataMount) {
    if (!(await exists(dataMount.source))) throw new Error('Shared tool data storage is missing; private data fallback is prohibited.');
    mounts.push(dataMount);
  }
  return mounts;
}
/**
 * Create the host-side session directories a Docker-isolated task mounts and
 * report a missing credential file, so a first run on a fresh host does not
 * silently launch a task with no `projects/` to write to or no credentials.
 *
 * Kept separate from {@link getDockerIsolationAuthMounts} because that function
 * is pure and is exercised in tests with paths that must not be created.
 *
 * @returns {Promise<{ created: string[], missingAuth: string[] }>}
 */
export async function prepareDockerIsolationHostPaths({ tool = 'claude', homeDir = os.homedir(), env = process.env, fsImpl = fs, useRouter = false } = {}) {
  const created = [];
  const missingAuth = [];
  if (useRouter) return { created, missingAuth };
  const normalizedTool = normalizeTool(tool);
  const data = await prepareToolDataMount({ tool: normalizedTool, homeDir, env, io: fsImpl.promises });
  if (data) return { ...data, missingAuth };
  for (const entry of DOCKER_ISOLATION_TOOL_MOUNTS[normalizedTool] || []) {
    const hostPath = path.join(homeDir, entry.relativePath);
    const exists = await fsImpl.promises.access(hostPath).then(
      () => true,
      () => false
    );
    if (entry.kind === 'dir') {
      try {
        const directory = await prepareStorageDirectory(hostPath, { io: fsImpl.promises });
        if (directory.created) created.push(hostPath);
      } catch {
        throw historyUnavailable(normalizedTool);
      }
    } else if (entry.role === 'auth' && !exists) {
      missingAuth.push(hostPath);
    }
  }
  return { created, missingAuth };
}
