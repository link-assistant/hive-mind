/**
 * Which part of a tool's host application folder a Docker-isolated task shares
 * (issues #2190 and #2296).
 *
 * Issue #2190 stopped mounting the whole `~/.claude` / `~/.codex` so that a
 * plugin, skill or MCP registration synced into the host's global state could
 * not reach (or be written by) a task. It shared the credential file as a
 * single-file bind mount instead, which broke OAuth in two ways (#2296,
 * reproduced in experiments/issue-2296/probe-credential-mounts.mjs):
 *
 *   - a single-file bind mount pins the inode it was created with; Claude Code
 *     rotates `.credentials.json` atomically (temp file + rename), so the task
 *     keeps reading the token that was valid when it started, and its own
 *     rename onto the mount fails with EBUSY;
 *   - Claude Code serialises refreshes with `.oauth_refresh.lock` created next
 *     to the credential file (`join(configDir, ".oauth_refresh.lock")`), so a
 *     task that only has the file has a private lock and races the host and
 *     every other task for the single-use refresh token.
 *
 * The credential file and its lock cannot be split from the config directory,
 * so the whole directory is shared again, and the #2190 guarantee is kept with
 * per-task private overlays: the entries that carry plugins, skills, hooks,
 * settings and memory are bind-mounted from a per-task host directory on top of
 * the shared one, so the task sees an empty (or baseline) version of each and
 * whatever it writes there never reaches the host or the tasks that follow.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DOCKER_CONTAINER_HOME = '/home/box';
const PRIVATE_OVERLAY_ROOT = path.join('.hive-mind', 'docker-isolation');
const PRIVATE_OVERLAY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const freezeOverlay = (name, kind, seed = '') => Object.freeze({ name, kind, seed });

/**
 * Per tool: the shared config directory (relative to the home directory), the
 * credential file inside it, and the entries that stay private per task.
 * For Codex, `.tmp` holds the remote plugin catalog and `hive-mind` the
 * repository-scoped capability state (issue #2074), so both stay per task.
 * `settings.json` / `config.toml` are seeded with a minimal baseline; `solve`
 * re-applies the full baseline at runtime (ensureClaudeQuietConfig for Claude,
 * `-c features.remote_plugin=false` for Codex).
 */
export const DOCKER_ISOLATION_TOOL_MOUNTS = Object.freeze({
  claude: Object.freeze({
    configDir: '.claude',
    authFile: '.credentials.json',
    privateOverlays: Object.freeze([freezeOverlay('plugins', 'dir'), freezeOverlay('skills', 'dir'), freezeOverlay('agents', 'dir'), freezeOverlay('commands', 'dir'), freezeOverlay('hooks', 'dir'), freezeOverlay('output-styles', 'dir'), freezeOverlay('rules', 'dir'), freezeOverlay('settings.json', 'file', '{}\n'), freezeOverlay('CLAUDE.md', 'file')]),
  }),
  codex: Object.freeze({
    configDir: '.codex',
    authFile: 'auth.json',
    privateOverlays: Object.freeze([freezeOverlay('plugins', 'dir'), freezeOverlay('skills', 'dir'), freezeOverlay('rules', 'dir'), freezeOverlay('prompts', 'dir'), freezeOverlay('.tmp', 'dir'), freezeOverlay('hive-mind', 'dir'), freezeOverlay('config.toml', 'file', '[features]\nremote_plugin = false\n'), freezeOverlay('AGENTS.md', 'file')]),
  }),
});

export function normalizeIsolationTool(tool) {
  return String(tool || 'claude').toLowerCase();
}

function sanitizeSegment(value) {
  return String(value || 'default').replace(/[^A-Za-z0-9._-]/g, '_') || 'default';
}

/** Host directory holding one task's private overlays for one tool. */
export function resolvePrivateOverlayDir({ tool = 'claude', homeDir = os.homedir(), sessionId = null } = {}) {
  return path.join(homeDir, PRIVATE_OVERLAY_ROOT, sanitizeSegment(sessionId), normalizeIsolationTool(tool));
}

/**
 * Mount list for the tool's application folder: the shared config directory,
 * then the private overlays on top of it (order matters — Docker mounts in the
 * order given, and an overlay must land after its parent).
 *
 * A file overlay is skipped when its source is missing, because Docker would
 * create a directory in its place; {@link prepareToolConfigHostPaths} creates
 * every source before the container starts.
 */
export function getToolConfigMounts({ tool = 'claude', homeDir = os.homedir(), sessionId = null, existsSync = fs.existsSync, containerHome = DOCKER_CONTAINER_HOME } = {}) {
  const spec = DOCKER_ISOLATION_TOOL_MOUNTS[normalizeIsolationTool(tool)];
  if (!spec) return [];
  const hostConfigDir = path.join(homeDir, spec.configDir);
  if (!existsSync(hostConfigDir)) return [];
  const containerConfigDir = path.join(containerHome, spec.configDir);
  const mounts = [{ source: hostConfigDir, target: containerConfigDir, role: 'shared-config' }];
  const privateDir = resolvePrivateOverlayDir({ tool, homeDir, sessionId });
  for (const overlay of spec.privateOverlays) {
    const source = path.join(privateDir, overlay.name);
    if (overlay.kind === 'file' && !existsSync(source)) continue;
    mounts.push({ source, target: path.join(containerConfigDir, overlay.name), role: 'private' });
  }
  return mounts;
}

function ensureDir(fsImpl, dir, created) {
  if (fsImpl.existsSync(dir)) return;
  fsImpl.mkdirSync(dir, { recursive: true });
  created.push(dir);
}

function ensureFile(fsImpl, file, seed, created) {
  if (fsImpl.existsSync(file)) return;
  fsImpl.mkdirSync(path.dirname(file), { recursive: true });
  fsImpl.writeFileSync(file, seed, { flag: 'wx' });
  created.push(file);
}

/** Remove private overlay directories left behind by tasks older than `maxAgeMs`. */
export function prunePrivateOverlays({ homeDir = os.homedir(), fsImpl = fs, now = Date.now(), maxAgeMs = PRIVATE_OVERLAY_MAX_AGE_MS, keep = null } = {}) {
  const root = path.join(homeDir, PRIVATE_OVERLAY_ROOT);
  const removed = [];
  let entries;
  try {
    entries = fsImpl.readdirSync(root);
  } catch {
    return removed;
  }
  for (const entry of entries) {
    if (entry === keep) continue;
    const dir = path.join(root, entry);
    try {
      if (now - fsImpl.statSync(dir).mtimeMs < maxAgeMs) continue;
      fsImpl.rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    } catch {
      // Another launcher may be pruning the same directory.
    }
  }
  return removed;
}

/**
 * Create, on the host, everything {@link getToolConfigMounts} needs: the shared
 * config directory, the mount points of the overlays inside it (otherwise the
 * container runtime creates them root-owned in the operator's folder) and the
 * per-task overlay sources. Reports a missing credential file.
 *
 * @returns {{ created: string[], missingAuth: string[], pruned: string[] }}
 */
export function prepareToolConfigHostPaths({ tool = 'claude', homeDir = os.homedir(), sessionId = null, fsImpl = fs, useRouter = false, now = Date.now() } = {}) {
  const created = [];
  const missingAuth = [];
  const spec = DOCKER_ISOLATION_TOOL_MOUNTS[normalizeIsolationTool(tool)];
  if (useRouter || !spec) return { created, missingAuth, pruned: [] };
  const pruned = prunePrivateOverlays({ homeDir, fsImpl, now, keep: sanitizeSegment(sessionId) });
  const hostConfigDir = path.join(homeDir, spec.configDir);
  const privateDir = resolvePrivateOverlayDir({ tool, homeDir, sessionId });
  try {
    ensureDir(fsImpl, hostConfigDir, created);
    for (const overlay of spec.privateOverlays) {
      const mountPoint = path.join(hostConfigDir, overlay.name);
      const source = path.join(privateDir, overlay.name);
      if (overlay.kind === 'dir') {
        ensureDir(fsImpl, mountPoint, created);
        ensureDir(fsImpl, source, created);
      } else {
        ensureFile(fsImpl, mountPoint, overlay.seed, created);
        ensureFile(fsImpl, source, overlay.seed, created);
      }
    }
  } catch {
    // A read-only or foreign home is not fatal: getToolConfigMounts skips what is missing.
  }
  if (!fsImpl.existsSync(path.join(hostConfigDir, spec.authFile))) missingAuth.push(path.join(hostConfigDir, spec.authFile));
  return { created, missingAuth, pruned };
}

/**
 * Mount points from `/proc/self/mountinfo` (field 5, with the kernel's octal
 * escapes for space, tab, newline and backslash decoded).
 */
export function parseMountPoints(mountinfo) {
  const points = [];
  for (const line of String(mountinfo || '').split('\n')) {
    const fields = line.split(' ');
    if (fields.length < 5) continue;
    points.push(fields[4].replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8))));
  }
  return points;
}

/**
 * Issue #2296 self-check: is the tool's credential file itself a mount point?
 * That is the single-file bind mount that goes stale after the first host-side
 * token rotation and cannot share the refresh lock.
 *
 * @returns {string|null} the offending path, or null when the layout is safe
 */
export function detectSingleFileCredentialMount({ tool = 'claude', homeDir = os.homedir(), env = process.env, readMountinfo = () => fs.readFileSync('/proc/self/mountinfo', 'utf8') } = {}) {
  const spec = DOCKER_ISOLATION_TOOL_MOUNTS[normalizeIsolationTool(tool)];
  if (!spec) return null;
  const configDir = normalizeIsolationTool(tool) === 'claude' && env.CLAUDE_CONFIG_DIR ? env.CLAUDE_CONFIG_DIR : normalizeIsolationTool(tool) === 'codex' && env.CODEX_HOME ? env.CODEX_HOME : path.join(homeDir, spec.configDir);
  const authPath = path.resolve(configDir, spec.authFile);
  let mountinfo;
  try {
    mountinfo = readMountinfo();
  } catch {
    return null;
  }
  return parseMountPoints(mountinfo).includes(authPath) ? authPath : null;
}

export function formatSingleFileCredentialMountWarning(authPath) {
  return `⚠️  ${authPath} is a single-file mount: a token rotated on the host (atomic rename) will not be seen here and the OAuth refresh lock is not shared, so the session can fail with "OAuth session expired and could not be refreshed". Mount the whole directory instead (issue #2296).`;
}
