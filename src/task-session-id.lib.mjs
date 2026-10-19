/**
 * One UUID per task across every layer (issue #3530).
 *
 * The bot launches each task with `$ --session <uuid> --session-id <uuid>`, so
 * the start-command session, its execution (and log file) and the Docker
 * container share one id. start-command (>= 0.38.0) exports that id as
 * `START_EXECUTION_ID`, but to every descendant — including the many `solve`
 * children of a `hive` run — so the isolation runner passes it to a `solve`
 * task only, as `HIVE_MIND_TASK_SESSION_ID`, and the first fresh Claude Code
 * session of the run is started with `claude --session-id <uuid>`: the AI
 * session then has the same id as well.
 *
 * A kill recovery that needs a new container keeps the id too: it is launched
 * as `--session <new container> --session-id <uuid> --append-attempt`, the next
 * attempt of the same execution, written to the same log (start#229).
 *
 * Only the first fresh session of the first attempt takes it — Claude Code
 * refuses a session id that already has a transcript — so later fresh sessions
 * of the same run, and every recovery attempt (`START_ATTEMPT` > 1, whose new
 * container cannot see the first transcript), keep Claude's own ids.
 * `--resume` never needs it: resuming keeps the session id it resumes.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3530
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import semver from 'semver';

export const TASK_SESSION_ID_ENV = 'HIVE_MIND_TASK_SESSION_ID';

/**
 * Whether the launched command is one task whose AI session can take the task's
 * id (issue #3530). `hive` runs many `solve` children, which must not share it.
 */
export function ownsTaskSessionId(command, sessionId) {
  return Boolean(sessionId) && path.basename(String(command || '')) === 'solve';
}

/** First start-command release that refuses a reused `--session-id` and accepts `--append-attempt` (start#229). */
export const MIN_START_COMMAND_APPEND_ATTEMPT_VERSION = '0.38.0';

/** Whether the installed `$` (output of getStartCommandVersion()) can append an attempt to an execution. */
export function startCommandSupportsAppendAttempt(version) {
  const parsed = semver.valid(semver.coerce(version || ''));
  return Boolean(parsed && semver.gte(parsed, MIN_START_COMMAND_APPEND_ATTEMPT_VERSION));
}

/**
 * One ID for every layer: `--session` names the screen/tmux session or docker
 * container, and `--session-id` makes start-command use the same UUID for the
 * execution record instead of generating a second one (issue #3530). With
 * both set, `$ --status`, `$ --resume` and the container all answer to the
 * task's UUID.
 *
 * A recovery attempt in a new container passes the container name and the
 * task's execution id separately, with `appendAttempt` (start#229).
 * @param {string} sessionId - The screen/tmux session or container name.
 * @param {{executionId?: string|null, appendAttempt?: boolean}} [options]
 * @returns {string[]} The start-command identity flags.
 */
export function buildSessionIdentityArgs(sessionId, { executionId = null, appendAttempt = false } = {}) {
  const args = ['--session', sessionId, '--session-id', executionId || sessionId];
  if (appendAttempt && executionId) args.push('--append-attempt');
  return args;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The task's UUID, when the bot launched this run.
 * @param {Object} [env]
 * @returns {string|null}
 */
export function resolveTaskSessionId(env = process.env) {
  const value = String(env?.[TASK_SESSION_ID_ENV] || '').trim();
  return UUID_RE.test(value) ? value.toLowerCase() : null;
}

/** Whether any Claude Code project already has a transcript with this session id. */
async function claudeTranscriptExists(sessionId, homeDir) {
  const projectsDir = path.join(homeDir, '.claude', 'projects');
  let projects;
  try {
    projects = await fs.readdir(projectsDir);
  } catch {
    return false;
  }
  const found = await Promise.all(
    projects.map(project =>
      fs.access(path.join(projectsDir, project, `${sessionId}.jsonl`)).then(
        () => true,
        () => false
      )
    )
  );
  return found.includes(true);
}

/**
 * Build the per-process claimer, so tests can start from a clean state.
 * @returns {(options?: {env?: Object, homeDir?: string, log?: Function, verbose?: boolean}) => Promise<string[]>}
 */
export function createClaudeTaskSessionIdClaimer() {
  let claimed = false;
  return async function claimClaudeTaskSessionIdArgs({ env = process.env, homeDir = os.homedir(), log = null, verbose = false } = {}) {
    const sessionId = resolveTaskSessionId(env);
    if (!sessionId || claimed || Number(env?.START_ATTEMPT) > 1) return [];
    claimed = true;
    if (await claudeTranscriptExists(sessionId, homeDir)) {
      if (verbose && log) await log(`🆔 Task id ${sessionId} already names a Claude session here; the new session keeps Claude's own id`, { verbose: true });
      return [];
    }
    if (verbose && log) await log(`🆔 Claude session id = task id ${sessionId} (claude --session-id)`, { verbose: true });
    return ['--session-id', sessionId];
  };
}

/** `['--session-id', <task uuid>]` for the first fresh Claude session of this run, else `[]`. */
export const claimClaudeTaskSessionIdArgs = createClaudeTaskSessionIdClaimer();
