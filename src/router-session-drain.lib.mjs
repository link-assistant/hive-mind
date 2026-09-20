/**
 * Draining a finished task's agent session data into the audit archive
 * (issue #2164, R7).
 *
 * A routed task never receives `~/.claude` or `~/.codex` from the host, so the
 * session transcripts the agent CLI writes — the tool calls it made, the files
 * it touched, the reasoning it recorded — live only inside that task's own
 * container and die with it. The router's request log answers "what went to the
 * model"; this answers "what the agent did with the answer", and a security
 * audit needs both.
 *
 * So when a lease ends, the data is copied out *before* the container is
 * reclaimed and merged into the router's preserved data volume next to the
 * request logs. `docker cp` works on a stopped container, which is what makes
 * the lease-drop path — the one that also catches killed and crashed tasks — a
 * usable hook.
 *
 * Nothing sensitive is being moved here: the routed container never held a
 * vendor credential in the first place, which is the entire point of the
 * feature. What is copied is the record of an agent's own behaviour.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2164
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

import { dockerOk, inspectDockerContainer } from './docker-sidecar.lib.mjs';
import { ROUTER_DATA_MOUNT, ROUTER_SIDECAR_CONTAINER_NAME } from './router-isolation.lib.mjs';

const execFileAsync = promisify(execFile);
const LOG_PREFIX = 'router-session-drain';

/** Home directory inside every Docker-isolated task container (see isolation-runner.lib.mjs). */
export const TASK_CONTAINER_HOME = '/home/box';

/** Where drained sessions land inside the router's data volume. */
export const TASK_SESSION_ARCHIVE_DIR = `${ROUTER_DATA_MOUNT}/task-sessions`;

/**
 * What is worth taking out of a finished task.
 *
 * `.claude.json` is included because it carries the session index; the vendor
 * OAuth block it would normally hold is absent in a routed task, which never
 * logged in.
 */
export const DRAINABLE_SESSION_PATHS = Object.freeze([Object.freeze({ label: 'claude', source: `${TASK_CONTAINER_HOME}/.claude` }), Object.freeze({ label: 'claude.json', source: `${TASK_CONTAINER_HOME}/.claude.json` }), Object.freeze({ label: 'codex', source: `${TASK_CONTAINER_HOME}/.codex` })]);

/**
 * Is draining switched on?
 *
 * On by default whenever routing is: an audit trail that has to be enabled
 * separately is an audit trail that will be missing exactly when it matters.
 */
export const isSessionDrainEnabled = (env = process.env) => {
  const raw = String(env?.HIVE_MIND_ROUTER_DRAIN_SESSIONS ?? '')
    .trim()
    .toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'no');
};

/**
 * Optional host directory to archive into instead of the router volume.
 *
 * Issue #2164 allows either "the router container or root hive-mind container";
 * an operator who would rather keep the transcripts on the root host — where
 * they can be rotated and backed up with everything else — sets this.
 */
export const resolveSessionArchiveHostDir = (env = process.env) => {
  const raw = String(env?.HIVE_MIND_SESSION_ARCHIVE_DIR || '').trim();
  return raw || null;
};

/**
 * Copy one path out of a task container into a staging directory.
 *
 * A missing path is not a failure: a task that only ever ran Codex has no
 * `.claude`, and a task that died during startup may have neither.
 *
 * @returns {Promise<boolean>} whether anything was copied
 */
export const copyTaskPath = async ({ sessionId, source, destination, run = execFileAsync, timeoutMs }) => dockerOk(run, ['cp', `${sessionId}:${source}`, destination], { timeoutMs });

/**
 * Drain a finished task's session data into the audit archive.
 *
 * Always resolves. A drain failure must never keep a lease alive or block a
 * sidecar teardown — the request log, which is the primary record, is already
 * safe in the volume either way.
 *
 * @returns {Promise<{drained: string[], destination: string|null, skipped: string|null, error: string|null}>}
 */
export const drainTaskSessionData = async ({ sessionId, env = process.env, run = execFileAsync, timeoutMs, fsImpl = fs, tmpDir = os.tmpdir(), paths = DRAINABLE_SESSION_PATHS, routerContainer = ROUTER_SIDECAR_CONTAINER_NAME, log = null, verbose = false, now = () => new Date() } = {}) => {
  const empty = { drained: [], destination: null, skipped: null, error: null };
  if (!sessionId) return { ...empty, skipped: 'no sessionId' };
  if (!isSessionDrainEnabled(env)) return { ...empty, skipped: 'disabled' };

  let staging = null;
  try {
    const task = await inspectDockerContainer(sessionId, { run, timeoutMs });
    // Nothing left to copy from: the container was already reclaimed.
    if (!task.exists) return { ...empty, skipped: 'task container is gone' };

    staging = fsImpl.mkdtempSync(path.join(tmpDir, `hive-mind-drain-${sessionId}-`));
    const drained = [];
    for (const entry of paths) {
      if (await copyTaskPath({ sessionId, source: entry.source, destination: path.join(staging, entry.label), run, timeoutMs })) drained.push(entry.label);
    }
    if (drained.length === 0) return { ...empty, skipped: 'task recorded no session data' };

    // A manifest makes an archived directory self-describing: an auditor reading
    // it months later should not have to correlate it with a lease file to learn
    // which task it came from.
    fsImpl.writeFileSync(path.join(staging, 'manifest.json'), `${JSON.stringify({ sessionId, drainedAt: now().toISOString(), paths: drained, source: 'hive-mind router session drain (issue #2164)' }, null, 2)}\n`, { encoding: 'utf8' });

    const hostDir = resolveSessionArchiveHostDir(env);
    if (hostDir) {
      const destination = path.join(hostDir, sessionId);
      fsImpl.mkdirSync(destination, { recursive: true });
      fsImpl.cpSync(staging, destination, { recursive: true });
      if (log) await log(`🗄️ Archived session data for '${sessionId}' to ${destination} (${drained.join(', ')})`);
      return { drained, destination, skipped: null, error: null };
    }

    const destination = `${TASK_SESSION_ARCHIVE_DIR}/${sessionId}`;
    if (!(await dockerOk(run, ['exec', routerContainer, 'mkdir', '-p', destination], { timeoutMs }))) {
      return { drained: [], destination: null, skipped: null, error: `router container '${routerContainer}' is not available to archive into` };
    }
    // The trailing `/.` copies the directory's *contents*, so the archive is
    // `<sessionId>/claude`, not `<sessionId>/<staging-name>/claude`.
    if (!(await dockerOk(run, ['cp', `${staging}/.`, `${routerContainer}:${destination}`], { timeoutMs }))) {
      return { drained: [], destination: null, skipped: null, error: `could not copy session data into '${routerContainer}'` };
    }
    if (log) await log(`🗄️ Archived session data for '${sessionId}' into the router volume at ${destination} (${drained.join(', ')})`);
    if (verbose && log) await log(`[VERBOSE] ${LOG_PREFIX}: drained ${drained.join(', ')} from '${sessionId}'`);
    return { drained, destination, skipped: null, error: null };
  } catch (error) {
    return { ...empty, error: error?.message || String(error) };
  } finally {
    if (staging) {
      try {
        fsImpl.rmSync(staging, { recursive: true, force: true });
      } catch {
        // A leftover staging directory in /tmp is harmless; failing here is not.
      }
    }
  }
};

export default { DRAINABLE_SESSION_PATHS, TASK_SESSION_ARCHIVE_DIR, copyTaskPath, drainTaskSessionData, isSessionDrainEnabled, resolveSessionArchiveHostDir };
