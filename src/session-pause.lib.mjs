/** Explicit task suspension. Docker stop releases CPU/RAM; its disk survives. */
import { stripVTControlCharacters } from 'node:util';
import { readLastSessionIdFromLog, stripResumeFlag } from './session-resume.lib.mjs';
import { readLogMarkerLines } from './log-bounded-read.lib.mjs';
import { getCarriedContainerDiskUsage, resumeKilledSessionInPlace } from './session-kill-resume.in-place.lib.mjs';
import { isFormalAiTask } from './formal-ai-sidecar.lib.mjs';
import { hasUseRouterFlag } from './router-isolation.lib.mjs';
import { TASK_PAUSE_MARKER } from './task-pause-marker.lib.mjs';

export const isSessionPaused = info => Boolean(info?.pauseState);
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

/** Only actual startup lines are accepted, never a directory in agent prose. */
export function extractPauseWorkingDirectory(text) {
  const clean = stripVTControlCharacters(String(text || ''));
  const markers = [...clean.matchAll(/^(?:Creating temporary directory:|📂\s+Working directory:|\s+Repository dir:)\s*(\/[^\r\n]+)$/gm)];
  return markers.at(-1)?.[1]?.trim() || null;
}

/** Reuse the original invocation, the original clone, and the latest AI context. */
export function buildPausedTaskCommand(info, lastSessionId) {
  const command = info.command || 'solve';
  let args = Array.isArray(info.args) ? [...info.args] : [info.url].filter(Boolean);
  if (command === 'solve') {
    args = stripResumeFlag(args);
    // A saved directory takes precedence over any spelling of the old option.
    if (info.pauseWorkingDirectory) {
      args = args.filter((arg, index) => arg !== '--working-directory' && args[index - 1] !== '--working-directory' && !arg.startsWith('--working-directory='));
      args.push('--working-directory', info.pauseWorkingDirectory);
    }
    if (lastSessionId) args.push('--resume', lastSessionId);
  }
  return { args, display: `rm -f ${quote(TASK_PAUSE_MARKER)} && ${[command, ...args].map(quote).join(' ')}` };
}

/** Shares the monitor's lock so completion, pause and resume cannot overlap. */
export function createSessionPauseControls({ activeSessions, sessionsInFlight, getRunner, persist, logEvent = () => {} }) {
  function findControllableSession(identifier) {
    for (const [sessionName, sessionInfo] of activeSessions) {
      if ([sessionName, sessionInfo.sessionId, sessionInfo.executionUuid, sessionInfo.rootSessionName, sessionInfo.killRecoveryOfSession].includes(identifier)) return { sessionName, sessionInfo };
    }
    return null;
  }

  function getPausedSessions() {
    return [...activeSessions].filter(([, info]) => isSessionPaused(info)).map(([sessionName, sessionInfo]) => ({ sessionName, sessionInfo }));
  }

  const fail = error => ({ success: false, error });
  async function pauseTrackedSession(identifier, { runner = null, requestedBy = null, verbose = false } = {}) {
    const entry = findControllableSession(identifier);
    if (!entry) return fail('No tracked task found for this session.');
    const { sessionName, sessionInfo: info } = entry;
    if (info.pauseState === 'paused') return { success: true, alreadyPaused: true, sessionId: sessionName };
    if (sessionsInFlight.has(sessionName)) return fail('This task is being monitored or controlled. Try again shortly.');
    if (info.isolationBackend !== 'docker') return fail('Pause requires Docker isolation so the entire task can stop while its disk is preserved.');
    if (isFormalAiTask({ args: info.args || [], model: info.model }) || hasUseRouterFlag(info.args || [])) return fail('Pause/resume is unavailable for tasks using the router or a Formal AI sidecar.');
    if (info.completionNotifiedAt) return fail('This task has already completed.');
    sessionsInFlight.add(sessionName);
    const before = { ...info };
    let stopSent = false;
    let stopAttempted = false;
    try {
      runner ||= await getRunner();
      const status = await runner.querySessionStatus(info.executionUuid || info.sessionId, verbose);
      if (status.logPath) info.logPath = status.logPath;
      if (status.uuid) info.executionUuid = status.uuid;
      const container = info.sessionId || sessionName;
      const running = await runner.checkDockerContainerRunning(container, verbose);
      if (!running && info.pauseState !== 'pausing') return fail('The task container is no longer running.');
      info.pauseState = 'pausing';
      info.pauseRequestedBy = requestedBy;
      info.stopRequestedByUser = true;
      // Persist BEFORE the stop, so a bot restart cannot mistake it for an OOM.
      persist(sessionName, info);
      if (running) {
        const marked = await runner.markDockerTaskPaused(container, true, verbose);
        if (!marked?.success) throw new Error(marked?.error || 'Could not preserve the workspace before stopping.');
        stopAttempted = true;
        const stopped = await runner.stopIsolatedSession(info.executionUuid || container, verbose);
        if (!stopped?.success) throw new Error(stopped?.error || 'The stop request failed.');
      }
      stopSent = true;
      if (await runner.checkDockerContainerRunning(container, verbose)) throw new Error('The container is still running; retry /pause to finish stopping it.');
      if (!(await runner.checkDockerContainerExists(container, verbose))) throw new Error('The stopped container is missing; its filesystem cannot be resumed.');
      const markers = await readLogMarkerLines(info.logPath, /Creating temporary directory:|Working directory:|Repository dir:/);
      info.pauseWorkingDirectory = extractPauseWorkingDirectory(markers) || info.pauseWorkingDirectory || null;
      if (typeof runner.getDockerContainerWritableLayerSize === 'function') {
        const size = await runner.getDockerContainerWritableLayerSize(container, verbose);
        if (Number.isFinite(size)) info.containerFilesystemLastBytes = size;
      }
      info.pauseState = 'paused';
      info.pausedAt = new Date().toISOString();
      persist(sessionName, info);
      logEvent('session_paused', { sessionName, requestedBy });
      if (verbose) console.log(`[VERBOSE] Session ${sessionName} paused; container filesystem retained`);
      return { success: true, sessionId: sessionName };
    } catch (error) {
      // A failed CLI can still have stopped Docker. Only roll back when we
      // know the command was never sent, or the container is still running.
      let canRollback = !stopSent && !before.pauseState;
      if (canRollback && stopAttempted) {
        try {
          canRollback = await runner.checkDockerContainerRunning(info.sessionId || sessionName, verbose);
        } catch {
          canRollback = false;
        }
      }
      if (canRollback) {
        for (const key of Object.keys(info)) delete info[key];
        Object.assign(info, before);
        if (typeof runner?.markDockerTaskPaused === 'function') await runner.markDockerTaskPaused(info.sessionId || sessionName, false, verbose).catch(() => {});
        try {
          persist(sessionName, info);
        } catch {
          /* Keep the original in-memory state. */
        }
      }
      // After a stop, retain the pausing state even on error: recovery and
      // cleanup must stay disabled until the operator resolves the refusal.
      return fail(error.message);
    } finally {
      sessionsInFlight.delete(sessionName);
    }
  }

  function adoptResumedSession(entry, result, args) {
    const { sessionName, sessionInfo: info } = entry;
    const next = result.sessionId || sessionName;
    const updated = { ...info, args, sessionId: next, executionUuid: result.executionUuid || info.executionUuid, startTime: new Date(), rootSessionName: info.rootSessionName || sessionName, rootStartTime: info.rootStartTime || info.startTime, pauseState: undefined, pausedAt: undefined, pauseRequestedBy: undefined, stopRequestedByUser: undefined, stopRequestedBy: undefined, lastToolSessionId: undefined, lastKnownStatus: undefined, lastKnownExitCode: undefined, oomEventObservedAt: undefined, dockerBackendGoneFirstSeenAt: undefined, containerFilesystemInheritedBytes: result.containerFilesystemInheritedBytes ?? info.containerFilesystemInheritedBytes, containerFilesystemLastBytes: undefined, containerFilesystemLastObservedAt: undefined };
    // Replace the durable key in one write: a crash must not leave both the
    // paused original and its resumed replacement in the registry.
    persist(next, updated, sessionName);
    activeSessions.set(next, updated);
    if (next !== sessionName) {
      activeSessions.delete(sessionName);
    }
    logEvent('session_explicitly_resumed', { sessionName, sessionId: next });
    return { success: true, sessionId: next };
  }

  async function findInterruptedResume(entry, runner, verbose) {
    const info = entry.sessionInfo;
    const status = await runner.querySessionStatus(info.executionUuid || info.sessionId, verbose);
    if (!status.sessionName) return null;
    const previous = info.sessionId || entry.sessionName;
    const replaced = status.sessionName !== previous;
    // A resumed command may finish before the bot restarts. Adopt its stopped
    // replacement too, so normal monitoring can report the actual completion.
    if (replaced ? await runner.checkDockerContainerExists(status.sessionName, verbose) : await runner.checkDockerContainerRunning(previous, verbose)) {
      return adoptResumedSession(entry, { sessionId: status.sessionName, executionUuid: status.uuid, containerFilesystemInheritedBytes: replaced ? getCarriedContainerDiskUsage(info) : info.containerFilesystemInheritedBytes }, info.args);
    }
    return null;
  }

  async function resumePausedSession(identifier, { runner = null, verbose = false } = {}) {
    const entry = findControllableSession(identifier);
    if (!entry) return fail('No tracked task found for this session.');
    const { sessionName, sessionInfo: info } = entry;
    if (!isSessionPaused(info)) return fail('This task is not paused.');
    if (sessionsInFlight.has(sessionName)) return fail('This task is being controlled. Try again shortly.');
    sessionsInFlight.add(sessionName);
    try {
      runner ||= await getRunner();
      if (info.pauseState === 'resuming') {
        const adopted = await findInterruptedResume(entry, runner, verbose);
        if (adopted) return adopted;
      }
      if (await runner.checkDockerContainerRunning(info.sessionId || sessionName, verbose)) return fail('The task container is still running. Use /pause again before resuming.');
      if (!(await runner.checkDockerContainerExists(info.sessionId || sessionName, verbose))) return fail('The paused container is missing. Resume refused to avoid discarding its workspace.');
      const lastSessionId = readLastSessionIdFromLog(info.logPath, { verbose });
      if (info.command === 'solve' && lastSessionId && !info.pauseWorkingDirectory) return fail('The original working directory could not be found. The paused filesystem is preserved.');
      const command = buildPausedTaskCommand(info, lastSessionId);
      info.pauseState = 'resuming';
      // Persist the exact next invocation before handing it to start-command.
      info.args = command.args;
      persist(sessionName, info);
      const resumed = await resumeKilledSessionInPlace({ sessionName, sessionInfo: info, plan: { command }, runner, verbose });
      if (!resumed.resumed) {
        info.pauseState = 'paused';
        persist(sessionName, info);
        return fail(`Cannot resume this container (${resumed.reason}). Its filesystem is preserved.`);
      }
      return adoptResumedSession(entry, resumed, command.args);
    } catch (error) {
      // An uncertain launch stays 'resuming'; the next request checks liveness
      // before starting anything, avoiding a duplicate after a bot crash.
      return fail(error.message);
    } finally {
      sessionsInFlight.delete(sessionName);
    }
  }

  async function reconcilePausedSession(identifier, options = {}) {
    const entry = findControllableSession(identifier);
    if (entry?.sessionInfo.pauseState === 'pausing') return pauseTrackedSession(identifier, options);
    if (entry?.sessionInfo.pauseState === 'resuming') {
      const runner = options.runner || (await getRunner());
      const info = entry.sessionInfo;
      const adopted = await findInterruptedResume(entry, runner, options.verbose);
      if (adopted) return adopted;
      info.pauseState = 'paused';
      persist(entry.sessionName, info);
    }
    return { success: true };
  }

  return { findControllableSession, getPausedSessions, pauseTrackedSession, resumePausedSession, reconcilePausedSession };
}
