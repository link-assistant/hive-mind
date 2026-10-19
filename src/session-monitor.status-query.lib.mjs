/**
 * Issue #2303 (RC4): a failed `$ --status` query is not an outcome.
 *
 * The query can fail while the session is fine (a locked or corrupt store, a
 * start-command upgrade in progress, a crash of `$` itself) or because the host
 * is in trouble (a full disk). It used to end tracking on the first failure as
 * "⚠️ Work session ended, but its exit status is unknown", so neither the kill
 * diagnosis nor `--on-session-kill=resume` ever ran.
 *
 * Now every failed query is counted (`statusQueryErrorCount`, persisted):
 *
 *   1. A written log footer settles the outcome at once — it is authoritative.
 *   2. Below STATUS_QUERY_ERROR_LIMIT consecutive failures the session stays
 *      tracked (`unverifiedRunning`), so a transient failure costs nothing.
 *   3. From the limit on, the backend is asked directly on every poll:
 *      docker sessions with `docker inspect` (still running / exited with
 *      docker's own exit code / gone), others with the backend liveness probe.
 *      A backend that is gone without a footer was killed, which is reported as
 *      such — so the kill diagnosis and the automatic resume run. Only when the
 *      backend cannot be asked either is the outcome given up as unknown.
 *
 * A successful query clears the streak.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2303
 */

import { getCommandStreamDollar } from './start-command-cli.lib.mjs';
import { classifyExitStatus } from './session-status.lib.mjs';
import { isDockerIsolation } from './session-monitor.stale-executing.lib.mjs';
import { probeSessionBackendAlive, resolveSessionContainerName } from './session-container-identity.lib.mjs';

/** Consecutive failed status queries (monitor ticks, 30 s apart) before the backend is asked directly. */
export const STATUS_QUERY_ERROR_LIMIT = 5;

/** Session-snapshot field holding the current streak of failed status queries. */
export const STATUS_QUERY_ERROR_COUNT_FIELD = 'statusQueryErrorCount';

// docker inspect answers in milliseconds; past this the daemon is hung, so docker cannot be asked (null).
const DOCKER_INSPECT_TIMEOUT_MS = 30 * 1000;
/** Docker's `FinishedAt` for a container that never finished. */
const DOCKER_ZERO_TIME = /^0001-01-01T00:00:00/;

/**
 * Parse `docker inspect -f '{{json .State}}'` output.
 *
 * @param {string} output
 * @returns {{exists: true, running: boolean, exitCode: number|null, oomKilled: boolean, finishedAt: string|null}|null}
 */
export function parseDockerContainerState(output) {
  let state;
  try {
    state = JSON.parse(String(output || '').trim());
  } catch {
    return null;
  }
  if (!state || typeof state !== 'object') return null;
  const running = state.Running === true;
  const finishedAt = typeof state.FinishedAt === 'string' && state.FinishedAt && !DOCKER_ZERO_TIME.test(state.FinishedAt) ? state.FinishedAt : null;
  // A running container, or one docker never saw finish, carries the zero ExitCode — no result.
  const exitCode = !running && finishedAt && Number.isInteger(state.ExitCode) ? state.ExitCode : null;
  return { exists: true, running, exitCode, oomKilled: state.OOMKilled === true, finishedAt };
}

/**
 * Ask docker for the container's own state.
 *
 * @param {string} containerName - The session UUID (start-command names the container after it)
 * @param {boolean} [verbose]
 * @returns {Promise<Object|null>} Parsed state, `{exists: false}` when there is no such container, or null when docker cannot be asked
 */
export async function inspectDockerContainerState(containerName, verbose = false) {
  try {
    const $ = await getCommandStreamDollar();
    // Issue #3278: the session monitor runs in the bot process; a hung docker daemon must not stall it.
    const result = await $({ mirror: false, signal: AbortSignal.timeout(DOCKER_INSPECT_TIMEOUT_MS) })`docker inspect -f ${'{{json .State}}'} ${containerName}`;
    const stderr = result.stderr?.toString() || '';
    if (result.code !== 0) return /No such (object|container)/i.test(stderr) ? { exists: false } : null;
    return parseDockerContainerState(result.stdout?.toString());
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] docker inspect for '${containerName}' failed: ${error?.message || error}`);
    return null;
  }
}

/**
 * @param {Object|null} statusResult
 * @returns {string|null} Why the status query failed, or null when it answered
 */
export function getStatusQueryError(statusResult) {
  return !statusResult?.exists && statusResult?.queryError ? String(statusResult.queryError) : null;
}

/**
 * Clear the failed-query streak after a query answered.
 *
 * @param {Object} sessionInfo
 * @param {Function} [persistSnapshot]
 */
export function clearStatusQueryErrors(sessionInfo, persistSnapshot = () => {}) {
  if (!sessionInfo?.[STATUS_QUERY_ERROR_COUNT_FIELD]) return;
  delete sessionInfo[STATUS_QUERY_ERROR_COUNT_FIELD];
  persistSnapshot();
}

function terminal(exitCode, status, statusResult) {
  return { running: false, exitCode, status, statusResult: { ...statusResult, status, exitCode } };
}

/**
 * Decide what a failed status query means for a tracked session.
 *
 * @param {string} sessionName
 * @param {Object} sessionInfo - Tracked session info (mutated: the error streak)
 * @param {string} error - Why the query failed
 * @param {Object} context
 * @param {Object|null} context.runner - Isolation runner (may be null when it could not be loaded)
 * @param {Object|null} [context.statusResult]
 * @param {Function|null} [context.exitFromLog]
 * @param {Function|null} [context.backendAlive]
 * @param {Function} [context.persistSnapshot]
 * @param {boolean} [context.verbose]
 * @returns {Promise<Object>} Isolation state
 */
export async function resolveStatusQueryFailure(sessionName, sessionInfo, error, { runner = null, statusResult = null, exitFromLog = null, backendAlive = null, persistSnapshot = () => {}, verbose = false } = {}) {
  const count = (Number(sessionInfo[STATUS_QUERY_ERROR_COUNT_FIELD]) || 0) + 1;
  sessionInfo[STATUS_QUERY_ERROR_COUNT_FIELD] = count;
  persistSnapshot();
  const backend = sessionInfo.isolationBackend || statusResult?.isolation || null;
  const docker = isDockerIsolation(sessionInfo, statusResult);
  const logPath = statusResult?.logPath || sessionInfo.logPath || null;
  const base = { ...(statusResult || {}), exists: false, queryError: error, isolation: backend, logPath };

  // 1. The log footer is authoritative; a docker `-1` footer only says the watcher lost the container.
  const readFooter = exitFromLog || runner?.readSessionExitFromLog;
  const footer = logPath && readFooter ? await readFooter(logPath, { verbose }) : null;
  const unknownDockerFooter = docker && typeof runner?.isUnknownDockerExitCode === 'function' && runner.isUnknownDockerExitCode(footer?.exitCode);
  if (footer?.finished && !unknownDockerFooter) {
    const status = classifyExitStatus(footer.exitCode) || (footer.exitCode === 0 ? 'executed' : 'failed');
    if (verbose) console.log(`[VERBOSE] Session ${sessionName}: status query failed (${error}), but the log footer says exit ${footer.exitCode} (${status}) (issue #2303)`);
    return terminal(footer.exitCode, status, { ...base, endTime: footer.endTime || null });
  }

  // 2. Below the limit: keep tracking, the next poll may answer.
  if (count < STATUS_QUERY_ERROR_LIMIT) {
    if (verbose) console.log(`[VERBOSE] Session ${sessionName}: status query failed (${error}); keeping it tracked (attempt ${count}/${STATUS_QUERY_ERROR_LIMIT}, issue #2303)`);
    return { running: true, exitCode: null, status: null, statusResult: null, statusQueryError: error, unverifiedRunning: true };
  }

  // 3. At the limit: ask the backend itself.
  const failure = `the session status could not be read ${count} times in a row (${error})`;
  if (docker) {
    const inspect = runner?.inspectDockerContainerState || inspectDockerContainerState;
    const state = await inspect(resolveSessionContainerName(sessionName, sessionInfo), verbose).catch(() => null);
    if (state?.running) {
      if (verbose) console.log(`[VERBOSE] Session ${sessionName}: ${failure}, but docker reports the container running; keeping it tracked (issue #2303)`);
      return { running: true, exitCode: null, status: null, statusResult: null, statusQueryError: error };
    }
    if (state?.exists && state.exitCode !== null) {
      const status = state.oomKilled ? 'killed' : classifyExitStatus(state.exitCode) || 'failed';
      console.log(`Session ${sessionName}: ${failure}; docker reports the container exited with ${state.exitCode} at ${state.finishedAt} (${status})`);
      return terminal(state.exitCode, status, { ...base, endTime: state.finishedAt, oomKilled: state.oomKilled, statusQueryFailure: `${failure}; docker reports exit ${state.exitCode}${state.oomKilled ? ' with OOMKilled=true' : ''}` });
    }
    if (state && (state.exists === false || state.running === false)) {
      const reason = `${failure}, and its docker container is gone without an exit footer${state.exists ? ' (it exists, but docker never saw it finish)' : ''}`;
      console.log(`Session ${sessionName}: ${reason}; reporting it as killed (issue #2303)`);
      return terminal(null, 'killed', { ...base, statusQueryFailure: reason, ...(state.exists ? {} : { containerRemoved: true }) });
    }
  }
  const probe = backendAlive || runner?.checkBackendSessionAlive;
  let alive = null;
  if (probe && backend) {
    try {
      alive = await probeSessionBackendAlive(sessionName, sessionInfo, { probe, runner, backend, verbose });
    } catch {
      alive = null;
    }
  }
  if (alive === true) {
    if (verbose) console.log(`[VERBOSE] Session ${sessionName}: ${failure}, but its ${backend} backend is alive; keeping it tracked (issue #2303)`);
    return { running: true, exitCode: null, status: null, statusResult: null, statusQueryError: error };
  }
  if (alive === false) {
    const reason = `${failure}, and its ${backend} backend is gone without an exit footer`;
    console.log(`Session ${sessionName}: ${reason}; reporting it as killed (issue #2303)`);
    return terminal(null, 'killed', { ...base, statusQueryFailure: reason });
  }
  console.error(`[session-monitor] Session ${sessionName}: ${failure}, and its backend cannot be checked; its outcome is unknown`);
  return { running: false, exitCode: null, status: null, statusResult: base, statusQueryError: error };
}
