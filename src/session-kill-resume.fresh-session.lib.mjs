/**
 * Resume a Codex thread from a *fresh* kill-recovery container (issue #2888).
 *
 * When the killed container cannot be re-entered (issue #2189 lists the
 * exceptions), recovery starts a new container with `solve … --resume <thread>`.
 * That container sees only the host mounts of issue #2190, which for Codex
 * include `~/.codex/sessions`. Before issue #2888 solve wrote rollouts to its
 * repository-scoped `CODEX_HOME` inside the container instead, so the thread
 * existed only in the killed container and `codex exec resume` failed at once
 * with "no rollout found for thread id …" (link-assistant/router#727).
 *
 * New runs write their rollouts to the mounted directory
 * (`./codex-sessions.lib.mjs`). For a run started before that, this module
 * copies the rollout out of the stopped container with `docker cp`. If the
 * thread still cannot be found, `--resume` is dropped so the recovery starts a
 * new Codex session on the same branch, and the notice says so, instead of
 * launching a run that is certain to fail.
 *
 * Only Docker recoveries are checked: screen/tmux recoveries run on the same
 * host and keep the scoped `CODEX_HOME`. Claude's transcripts are on a mounted
 * folder ({@link DOCKER_ISOLATION_TOOL_MOUNTS}). agent, gemini, qwen and
 * opencode keep their sessions inside the killed container, which no new
 * container can read, so their `--resume` is dropped the same way.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2888
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCodexCapabilityStatePath } from './codex-capability-preflight.lib.mjs';
import { CODEX_SESSIONS_DIRNAME, findCodexRolloutFile } from './codex-sessions.lib.mjs';
import { publishCodexRollout } from './codex-rollout-publication.lib.mjs';
import { parseGitHubUrl } from './github-url-parser.lib.mjs';
import { DOCKER_ISOLATION_TOOL_MOUNTS } from './isolation-runner.lib.mjs';
import { hasUseRouterFlag } from './router-isolation.lib.mjs';
import { quoteArg, stripResumeFlag } from './session-resume.lib.mjs';

/** Home directory of the task user inside a Hive Mind task container. */
export const TASK_CONTAINER_CODEX_HOME = '/home/box/.codex';

/** What happened to the recovery command's `--resume`. */
export const FRESH_RESUME_OUTCOMES = Object.freeze({
  NOT_CHECKED: 'not-checked',
  KEPT: 'kept',
  RESTORED: 'restored',
  DROPPED: 'dropped',
});

/** The value of the last `--resume`/`-r` in `args`, or null. */
export function readResumeId(args) {
  if (!Array.isArray(args)) return null;
  let id = null;
  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i] ?? '');
    if ((arg === '--resume' || arg === '-r') && i + 1 < args.length) id = String(args[++i]);
    else if (arg.startsWith('--resume=')) id = arg.slice('--resume='.length);
    else if (arg.startsWith('-r=')) id = arg.slice('-r='.length);
  }
  return id || null;
}

/** `command` without `--resume`, with both displays rebuilt. */
export function withoutResume(command) {
  const args = stripResumeFlag(command.args);
  const argDisplay = args.map(quoteArg).join(' ');
  const oldArgDisplay = command.args.map(quoteArg).join(' ');
  const chatPrefix = typeof command.chatDisplay === 'string' && command.chatDisplay.endsWith(` ${oldArgDisplay}`) ? command.chatDisplay.slice(0, -oldArgDisplay.length - 1) : quoteArg(command.binary);
  return { ...command, args, display: `${quoteArg(command.binary)} ${argDisplay}`, chatDisplay: `${chatPrefix} ${argDisplay}` };
}

/**
 * Copy `threadId`'s rollout out of the stopped container into the host
 * sessions directory the next container mounts. Never throws.
 *
 * @returns {Promise<{restored: boolean, file: string|null, conflictFile?: string|null, error: string|null}>}
 */
export async function restoreCodexRolloutFromContainer({ containerName, sessionInfo, threadId, hostSessionsDir, runner, fsImpl = fs, tmpDir = os.tmpdir(), verbose = false }) {
  const parsed = sessionInfo?.url ? parseGitHubUrl(sessionInfo.url) : null;
  if (!containerName || typeof runner?.copyFromDockerContainer !== 'function') return { restored: false, file: null, error: 'docker cp unavailable' };
  if (!parsed?.valid || !parsed.owner || !parsed.repo) return { restored: false, file: null, error: 'repository unknown' };
  const scopedSessions = path.posix.join(buildCodexCapabilityStatePath({ baseCodexHome: TASK_CONTAINER_CODEX_HOME, owner: parsed.owner, repo: parsed.repo }), CODEX_SESSIONS_DIRNAME);
  const sources = [path.posix.join(TASK_CONTAINER_CODEX_HOME, CODEX_SESSIONS_DIRNAME), scopedSessions];
  let staging = null;
  try {
    staging = await fsImpl.mkdtemp(path.join(tmpDir, 'hive-mind-codex-rollout-'));
    for (const [index, source] of sources.entries()) {
      const destination = path.join(staging, String(index));
      await fsImpl.mkdir(destination);
      let copied;
      try {
        copied = await runner.copyFromDockerContainer(containerName, `${source}/.`, destination, verbose);
      } catch {
        continue;
      }
      if (!copied?.success) continue;
      const found = await findCodexRolloutFile({ sessionsDir: destination, threadId, fsImpl });
      if (!found) continue;
      const file = path.join(hostSessionsDir, path.relative(destination, found));
      await fsImpl.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const publication = await publishCodexRollout({ source: found, target: file, fsImpl, retainConflict: true });
      return { restored: true, file, conflictFile: publication.conflictFile, error: null };
    }
    return { restored: false, file: null, error: `no recoverable rollout for ${threadId} in ${containerName}` };
  } catch (error) {
    return { restored: false, file: null, conflictFile: error?.conflictFile || null, error: error?.message || String(error) };
  } finally {
    if (staging) await fsImpl.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Decide the command a fresh recovery container runs.
 *
 * @returns {Promise<{command: Object, outcome: string, detail: string|null}>}
 */
export async function resolveFreshRecoveryCommand({ sessionName, sessionInfo, command, runner, homeDir = os.homedir(), fsImpl = fs, tmpDir, verbose = false }) {
  const keep = (outcome, detail = null) => ({ command, outcome, detail });
  const threadId = readResumeId(command?.args);
  const tool = String(sessionInfo?.tool || 'claude').toLowerCase();
  if (!threadId || sessionInfo?.isolationBackend !== 'docker') return keep(FRESH_RESUME_OUTCOMES.NOT_CHECKED);
  const drop = detail => {
    if (verbose) console.log(`[VERBOSE] Fresh recovery of ${sessionName}: ${detail}`);
    return { command: withoutResume(command), outcome: FRESH_RESUME_OUTCOMES.DROPPED, detail };
  };
  if (tool !== 'codex') {
    const mounted = DOCKER_ISOLATION_TOOL_MOUNTS[tool]?.some(entry => entry.role === 'sessions');
    if (mounted && !hasUseRouterFlag(command.args)) return keep(FRESH_RESUME_OUTCOMES.NOT_CHECKED);
    return drop(`${tool} session ${threadId} stayed in the killed container: ${mounted ? 'a --use-router container gets no' : 'task containers get no'} mount of ${tool}'s session store. Starting a new ${tool} session on the same branch instead.`);
  }
  // --use-router tasks get no ~/.codex mounts, so no host rollout can reach them.
  if (hasUseRouterFlag(command.args)) return drop(`Codex thread ${threadId} cannot be resumed in a new --use-router container (no ~/.codex/sessions mount). Starting a new Codex session on the same branch instead.`);
  const hostSessionsDir = path.join(homeDir, '.codex', CODEX_SESSIONS_DIRNAME);
  const present = await findCodexRolloutFile({ sessionsDir: hostSessionsDir, threadId, fsImpl });
  if (present) {
    if (verbose) console.log(`[VERBOSE] Fresh recovery of ${sessionName}: Codex rollout ${present} is mounted; resuming thread ${threadId}`);
    return keep(FRESH_RESUME_OUTCOMES.KEPT);
  }
  const containerName = sessionInfo?.sessionId || sessionName || null;
  const restored = await restoreCodexRolloutFromContainer({ containerName, sessionInfo, threadId, hostSessionsDir, runner, fsImpl, tmpDir, verbose });
  if (restored.restored) {
    if (restored.conflictFile) {
      return keep(FRESH_RESUME_OUTCOMES.RESTORED, `Kept the concurrently written canonical Codex thread ${threadId}; preserved recovered evidence at ${restored.conflictFile}.`);
    }
    if (verbose) console.log(`[VERBOSE] Fresh recovery of ${sessionName}: copied Codex rollout of ${threadId} from ${containerName} to ${restored.file}`);
    return keep(FRESH_RESUME_OUTCOMES.RESTORED, `Copied Codex thread ${threadId} out of the killed container so the new one can resume it.`);
  }
  return drop(`Codex thread ${threadId} is not in ${hostSessionsDir} and could not be copied out of ${containerName || 'the killed container'} (${restored.error}). Starting a new Codex session on the same branch instead.`);
}
