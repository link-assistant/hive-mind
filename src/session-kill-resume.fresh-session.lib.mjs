/**
 * Decide what a *fresh* kill-recovery run may resume (issue #2888).
 *
 * When a killed session cannot be re-entered in place, the recovery is a new
 * isolated run of `solve … --resume <tool session id>`. In a new Docker task
 * container that only works when the tool's session store is on a volume the
 * container mounts, and the session is actually there. Before this module the
 * fallback always passed `--resume`; for Codex the rollout lived in the killed
 * container's own repository-scoped CODEX_HOME, so the run failed within a
 * minute with "no rollout found for thread id …".
 *
 * Per tool, the store a fresh container can see (see
 * `DOCKER_ISOLATION_TOOL_MOUNTS` in `isolation-runner.lib.mjs`):
 *
 * | tool                          | store read by `--resume`                      | mounted? |
 * |-------------------------------|-----------------------------------------------|----------|
 * | claude                        | `~/.claude/projects/<cwd slug>/<id>.jsonl`    | yes      |
 * | codex                         | `$CODEX_HOME/sessions/…/rollout-…-<id>.jsonl` | yes (#2888 links the scoped home there) |
 * | agent, opencode, gemini, qwen | the tool's own data directory                 | no       |
 *
 * Claude finds a transcript by id from any working directory
 * (experiments/issue-2888/claude-resume-cross-cwd.sh), so a mounted transcript
 * is enough. For Codex a rollout that never reached the mounted volume (a task
 * started before #2888) is copied out of the killed container with `docker cp`,
 * which works on stopped containers. When the session still cannot be found
 * the run is launched without `--resume`: `--auto-continue` (on by default)
 * picks the existing pull request up, which is what a guaranteed-to-fail
 * resume was trying to do.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2888
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findCodexRolloutFile, isCodexRolloutFileName } from './codex-sessions.lib.mjs';
import { buildCodexCapabilityStatePath } from './codex-capability-preflight.lib.mjs';
import { parseGitHubUrl } from './github-url-parser.lib.mjs';
import { hasUseRouterFlag } from './router-isolation.lib.mjs';
import { quoteArg, stripResumeFlag } from './session-resume.lib.mjs';

/** Home directory inside Docker task containers (mirrors isolation-runner). */
const DEFAULT_CONTAINER_HOME = '/home/box';

/** Why the fresh run keeps or drops `--resume`. Reported, never thrown. */
export const FRESH_RESUME_REASONS = Object.freeze({
  NO_RESUME: 'no-resume-flag',
  HOST_BACKEND: 'host-backend',
  AVAILABLE: 'tool-session-available',
  RESTORED: 'tool-session-restored',
  NOT_PERSISTED: 'tool-session-not-persisted',
  NOT_MOUNTED: 'tool-session-not-mounted',
  MISSING: 'tool-session-missing',
  CHECK_FAILED: 'tool-session-check-failed',
  CHECK_UNAVAILABLE: 'tool-session-check-unavailable',
});

/** Find `<projects>/<any project dir>/<id>.jsonl` — Claude's transcript for a session. */
export async function findClaudeTranscriptFile({ projectsDir, sessionId, fsImpl = fs } = {}) {
  if (!projectsDir || !/^[0-9a-zA-Z][0-9a-zA-Z_-]{7,127}$/u.test(String(sessionId || ''))) return null;
  let entries;
  try {
    entries = await fsImpl.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(projectsDir, entry.name, `${sessionId}.jsonl`);
    try {
      await fsImpl.access(candidate);
      return candidate;
    } catch {
      // Not in this project directory.
    }
  }
  return null;
}

/**
 * Session stores that a fresh task container can reach, keyed by tool. A tool
 * that is not listed keeps its sessions inside the container (not mounted).
 */
export const TOOL_SESSION_STORES = Object.freeze({
  claude: Object.freeze({ relativePath: path.join('.claude', 'projects'), find: ({ dir, id, fsImpl }) => findClaudeTranscriptFile({ projectsDir: dir, sessionId: id, fsImpl }) }),
  codex: Object.freeze({ relativePath: path.join('.codex', 'sessions'), find: ({ dir, id, fsImpl }) => findCodexRolloutFile({ sessionsDir: dir, threadId: id, fsImpl }) }),
});

/** The value of the last `--resume`/`-r` in `args`, or null. */
export function readResumeId(args) {
  const list = Array.isArray(args) ? args : [];
  let id = null;
  for (let i = 0; i < list.length; i++) {
    const arg = String(list[i] ?? '');
    if ((arg === '--resume' || arg === '-r') && i + 1 < list.length) id = String(list[i + 1]);
    else if (arg.startsWith('--resume=')) id = arg.slice('--resume='.length);
    else if (arg.startsWith('-r=')) id = arg.slice('-r='.length);
  }
  return id || null;
}

/**
 * Copy a killed Codex task's rollout out of its container into the host's
 * mounted sessions directory. Best effort; returns the restored host path.
 */
export async function restoreCodexRolloutFromContainer({ runner, containerName, sessionInfo, threadId, hostSessionsDir, containerHome = DEFAULT_CONTAINER_HOME, fsImpl = fs, tmpDir = os.tmpdir(), verbose = false } = {}) {
  const log = message => verbose && console.log(`[VERBOSE] Fresh recovery for ${containerName}: ${message}`);
  if (typeof runner?.copyFromDockerContainer !== 'function') return { restored: null, error: 'runner cannot copy from containers' };
  if (typeof runner?.checkDockerContainerExists === 'function' && !(await runner.checkDockerContainerExists(containerName, verbose))) return { restored: null, error: 'container gone' };
  const parsed = parseGitHubUrl(sessionInfo?.url || (Array.isArray(sessionInfo?.args) ? sessionInfo.args[0] : '') || '');
  if (!parsed?.valid || !parsed.owner || !parsed.repo) return { restored: null, error: 'no repository in the session URL' };
  const scopedSessions = path.join(buildCodexCapabilityStatePath({ baseCodexHome: path.join(containerHome, '.codex'), owner: parsed.owner, repo: parsed.repo }), 'sessions');
  let staging = null;
  try {
    staging = await fsImpl.mkdtemp(path.join(tmpDir, 'hive-mind-codex-rollout-'));
    const copied = await runner.copyFromDockerContainer(containerName, `${scopedSessions}/.`, staging, verbose);
    if (!copied?.success) return { restored: null, error: copied?.error || 'docker cp failed' };
    const found = await findCodexRolloutFile({ sessionsDir: staging, threadId, fsImpl });
    if (!found || !isCodexRolloutFileName(path.basename(found), threadId)) return { restored: null, error: `no rollout for ${threadId} in ${containerName}:${scopedSessions}` };
    const destination = path.join(hostSessionsDir, path.relative(staging, found));
    await fsImpl.mkdir(path.dirname(destination), { recursive: true });
    try {
      await fsImpl.access(destination);
    } catch {
      await fsImpl.copyFile(found, destination);
    }
    log(`restored ${containerName}:${scopedSessions}/${path.relative(staging, found)} → ${destination}`);
    return { restored: destination, error: null };
  } catch (error) {
    return { restored: null, error: error?.message || String(error) };
  } finally {
    if (staging) await fsImpl.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Resolve the command a fresh recovery run is launched with.
 *
 * @param {Object} options
 * @param {string} options.sessionName - The killed session's name
 * @param {Object} options.sessionInfo - Persisted session info (tool, url, args, isolationBackend, sessionId)
 * @param {{binary: string, args: string[], display: string}} options.command - The planned resume command
 * @param {Object} options.runner - Isolation runner (getDockerIsolationAuthMounts, copyFromDockerContainer, checkDockerContainerExists)
 * @param {Object} [options.env]
 * @param {string} [options.homeDir]
 * @param {Object} [options.fsImpl]
 * @param {boolean} [options.verbose]
 * @returns {Promise<{command: {binary: string, args: string[], display: string}, keptResume: boolean, reason: string, resumeId: string|null, restoredFrom: string|null, detail: string|null}>}
 */
export async function resolveFreshRecoveryCommand({ sessionName = null, sessionInfo = {}, command, runner = null, env = process.env, homeDir = os.homedir(), fsImpl = fs, verbose = false } = {}) {
  const resumeId = readResumeId(command?.args);
  const keep = (reason, extra = {}) => ({ command, keptResume: Boolean(resumeId), reason, resumeId, restoredFrom: null, detail: null, ...extra });
  const drop = (reason, detail = null) => {
    const args = stripResumeFlag(command.args);
    const binary = command.binary || 'solve';
    return { command: { ...command, args, display: `${binary} ${args.map(quoteArg).join(' ')}` }, keptResume: false, reason, resumeId, restoredFrom: null, detail };
  };
  if (!command || !resumeId) return keep(FRESH_RESUME_REASONS.NO_RESUME);
  // screen/tmux run on the host, which keeps every tool's own session store.
  if (sessionInfo?.isolationBackend !== 'docker') return keep(FRESH_RESUME_REASONS.HOST_BACKEND);

  const tool = String(sessionInfo?.tool || 'claude').toLowerCase();
  const store = TOOL_SESSION_STORES[tool];
  if (!store) return drop(FRESH_RESUME_REASONS.NOT_PERSISTED, `${tool} keeps its sessions inside the task container`);
  try {
    const containerHome = runner?.DOCKER_CONTAINER_HOME || DEFAULT_CONTAINER_HOME;
    const target = path.join(containerHome, store.relativePath);
    // Without the runner's mount table nothing can be checked; keep the old behaviour.
    if (typeof runner?.getDockerIsolationAuthMounts !== 'function') return keep(FRESH_RESUME_REASONS.CHECK_UNAVAILABLE);
    const mounts = runner.getDockerIsolationAuthMounts({ tool, env, homeDir, useRouter: hasUseRouterFlag(command.args) });
    const mount = mounts.find(entry => entry?.target === target);
    if (!mount) return drop(FRESH_RESUME_REASONS.NOT_MOUNTED, `${target} is not mounted into ${tool} task containers`);
    const found = await store.find({ dir: mount.source, id: resumeId, fsImpl });
    if (found) return keep(FRESH_RESUME_REASONS.AVAILABLE, { detail: found });
    if (tool === 'codex') {
      const containerName = sessionInfo?.sessionId || sessionName;
      const restore = await restoreCodexRolloutFromContainer({ runner, containerName, sessionInfo, threadId: resumeId, hostSessionsDir: mount.source, containerHome, fsImpl, verbose });
      if (restore.restored) return keep(FRESH_RESUME_REASONS.RESTORED, { restoredFrom: containerName, detail: restore.restored });
      return drop(FRESH_RESUME_REASONS.MISSING, `no rollout for ${resumeId} under ${mount.source}; restore from ${containerName}: ${restore.error}`);
    }
    return drop(FRESH_RESUME_REASONS.MISSING, `no session ${resumeId} under ${mount.source}`);
  } catch (error) {
    return drop(FRESH_RESUME_REASONS.CHECK_FAILED, error?.message || String(error));
  }
}
