/**
 * One UUID per task across every layer (issue #3530).
 *
 * The bot launches each task with `$ --session <uuid> --session-id <uuid>`, so
 * the start-command session, its execution (and log file) and the Docker
 * container share one id. start-command does not export that id to the task,
 * so the isolation runner passes it as `HIVE_MIND_TASK_SESSION_ID`, and the
 * first fresh Claude Code session of the run is started with
 * `claude --session-id <uuid>`: the AI session then has the same id as well.
 *
 * Only the first fresh session can take it — Claude Code refuses a session id
 * that already has a transcript — so later fresh sessions of the same run (and a
 * restart in a container whose transcript survived) keep Claude's own ids.
 * `--resume` never needs it: resuming keeps the session id it resumes.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3530
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const TASK_SESSION_ID_ENV = 'HIVE_MIND_TASK_SESSION_ID';

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
    if (!sessionId || claimed) return [];
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
