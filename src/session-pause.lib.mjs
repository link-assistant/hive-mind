/** Lifecycle of tracked Docker tasks controlled from Telegram. */
import { stripVTControlCharacters } from 'node:util';
import { readLastSessionIdFromLog, stripResumeFlag } from './session-resume.lib.mjs';
import { readLogMarkerLines } from './log-bounded-read.lib.mjs';
import { getCarriedContainerDiskUsage, resumeKilledSessionInPlace } from './session-kill-resume.in-place.lib.mjs';
import { isFormalAiTask } from './formal-ai-sidecar.lib.mjs';
import { hasUseRouterFlag } from './router-isolation.lib.mjs';
import { TASK_PAUSE_MARKER } from './task-pause-marker.lib.mjs';
import { COMPLETION_STATE_FIELDS } from './session-completion-state.lib.mjs';

export const isSessionPaused = info => info?.paused === true;
export const isStoppedDockerState = state => state === 'exited' || state === 'created';

export function extractPauseWorkingDirectory(text) {
  const clean = stripVTControlCharacters(String(text || ''));
  const markers = [...clean.matchAll(/^(?:Creating temporary directory:|📂\s+Working directory:|\s+Repository dir:)\s*(\/[^\r\n]+)$/gm)];
  return markers.at(-1)?.[1]?.trim() || null;
}

export function buildPausedTaskCommand(info, lastSessionId) {
  const command = info.command || 'solve';
  let args = Array.isArray(info.args) ? [...info.args] : [info.url].filter(Boolean);
  if (command === 'solve') {
    args = stripResumeFlag(args);
    if (info.pauseWorkingDirectory) {
      args = args.filter((arg, index) => arg !== '--working-directory' && args[index - 1] !== '--working-directory' && !arg.startsWith('--working-directory='));
      args.push('--working-directory', info.pauseWorkingDirectory);
    }
    if (lastSessionId) args.push('--resume', lastSessionId);
  }
  // Remove the stop marker in the retained filesystem before invoking the task.
  return { args, launch: { binary: 'sh', args: ['-c', 'rm -f -- "$1"; shift; exec "$@"', 'resume-task', TASK_PAUSE_MARKER, command, ...args] } };
}

/** Reconcile the durable record with Docker, including externally frozen tasks. */
export function reconcileDockerPause(info, state, metadata = {}, now = () => new Date()) {
  if (!state || state === 'unknown' || state === 'restarting' || state === 'removing') return false;
  if (state === 'paused') {
    if (isSessionPaused(info)) return false;
    info.paused = true;
    info.pausedAt = metadata.pausedAt || now().toISOString();
    info.pausedBy = metadata.pausedBy || null;
    info.pauseReason = metadata.pauseReason || null;
    info.pauseCount = Math.max((info.pauseCount || 0) + 1, metadata.pauseCount || 0);
    return true;
  }
  if (!isSessionPaused(info)) return false;
  // A frozen task that exits cannot do more work. Preserve its files and
  // require an explicit resume rather than automatically launching a solve.
  if (state !== 'running') info.stopRequestedByUser = true;
  for (const key of ['paused', 'pausedAt', 'pausedBy', 'pauseReason', 'pauseAlertedAt']) delete info[key];
  return true;
}

const fail = error => ({ success: false, error });
const isLive = state => state === 'running' || state === 'paused';

export function createSessionPauseControls({ activeSessions, sessionsInFlight, findSession, getRunner, persist, logEvent = () => {} }) {
  async function withDockerTask(identifier, options, operation) {
    const entry = findSession(identifier);
    if (!entry) return fail('No tracked task found for this session.');
    if (entry.sessionInfo.isolationBackend !== 'docker') return fail('This command requires Docker isolation. Screen and tmux tasks can be stopped with /stop.');
    const { sessionName } = entry;
    if (sessionsInFlight.has(sessionName)) return fail('This task is being monitored or controlled. Try again shortly.');
    sessionsInFlight.add(sessionName);
    try {
      const runner = options.runner || (await getRunner());
      return await operation(entry, runner);
    } catch (error) {
      return fail(error.message);
    } finally {
      sessionsInFlight.delete(sessionName);
    }
  }

  async function inspect(entry, runner, verbose, { readOnly = false } = {}) {
    const info = entry.sessionInfo;
    const status = await runner.querySessionStatus(info.executionUuid || info.sessionId || entry.sessionName, verbose);
    const container = status.sessionName || info.dockerContainerName || info.sessionId || entry.sessionName;
    const identifier = status.uuid || info.executionUuid || container;
    const state = await runner.inspectDockerContainerState(container, verbose);
    if (readOnly) return { state };
    if (status.logPath) info.logPath = status.logPath;
    if (status.uuid) info.executionUuid = status.uuid;
    const changed = reconcileDockerPause(info, state, status);
    if (changed || (status.sessionName && info.dockerContainerName !== container)) {
      info.dockerContainerName = container;
      await persist(entry.sessionName, info);
    }
    return { status, container, identifier, state };
  }

  const unavailableState = state => fail(`Docker container state is ${state || 'unavailable'}. Check /status; /resume requires an exited container with its files intact.`);

  async function freeze(identifier, action, options = {}) {
    return withDockerTask(identifier, options, async (entry, runner) => {
      const { sessionName, sessionInfo: info } = entry;
      const current = await inspect(entry, runner, options.verbose);
      if (!isLive(current.state)) return unavailableState(current.state);
      const pause = action === 'pause';
      const run = pause ? runner.pauseDockerSession : runner.unpauseDockerSession;
      const result = await run(current.identifier, options);
      if (!result.success) {
        // The CLI may have lost its reply after Docker already changed state.
        await inspect(entry, runner, options.verbose);
        return result;
      }
      const state = pause ? 'paused' : 'running';
      reconcileDockerPause(info, state, { ...result, pausedBy: options.requestedBy, pauseReason: options.reason });
      await persist(sessionName, info);
      logEvent(pause ? 'session_paused' : 'session_unpaused', { sessionName, requestedBy: options.requestedBy || null, status: result.status });
      return { success: true, sessionId: sessionName, alreadyPaused: result.status === 'already-paused', notPaused: result.status === 'not-paused' };
    });
  }

  async function stopTrackedDockerSession(identifier, options = {}) {
    return withDockerTask(identifier, options, async (entry, runner) => {
      const { sessionName, sessionInfo: info } = entry;
      const current = await inspect(entry, runner, options.verbose);
      if (!isLive(current.state)) return unavailableState(current.state);
      // start thaws a frozen container before delivering SIGTERM.
      const previous = [info.stopRequestedByUser, info.stopRequestedBy];
      info.stopRequestedByUser = true;
      info.stopRequestedBy = options.requestedBy || null;
      try {
        await persist(sessionName, info);
        if (info.command === 'solve') await runner.markDockerTaskForStop(current.container);
      } catch (error) {
        [info.stopRequestedByUser, info.stopRequestedBy] = previous;
        await persist(sessionName, info);
        throw error;
      }
      logEvent('session_stop_requested', { sessionName, requestedBy: info.stopRequestedBy });
      const result = await runner.stopIsolatedSession(current.identifier, options.verbose);
      const after = await inspect(entry, runner, options.verbose);
      if (!result.success && isLive(after.state)) {
        [info.stopRequestedByUser, info.stopRequestedBy] = previous;
        await persist(sessionName, info);
      }
      return result;
    });
  }

  async function adopt(entry, result, args) {
    const { sessionName, sessionInfo: info } = entry;
    const next = result.containerName || result.sessionId || sessionName;
    const updated = { ...info, args, sessionId: next, executionUuid: result.executionUuid || info.executionUuid, startTime: new Date(), rootSessionName: info.rootSessionName || sessionName, rootStartTime: info.rootStartTime || info.startTime };
    for (const key of [...COMPLETION_STATE_FIELDS, 'retainedForResume', 'explicitResumePending', 'stopRequestedByUser', 'stopRequestedBy', 'lastKnownStatus', 'lastKnownExitCode', 'oomEventObservedAt', 'containerResourceLimitExceeded', 'dockerBackendGoneFirstSeenAt', 'containerFilesystemLastBytes', 'containerFilesystemLastObservedAt', 'pauseCardState', 'pauseState', 'pauseRequestedBy', 'killRecoverySessionId', 'killRecoveryContainerName', 'recoveryLifecycle', 'launchPending', 'launchedAt', 'containerSeenAt', 'statusQueryErrorCount']) delete updated[key];
    updated.dockerContainerName = next;
    updated.containerFilesystemInheritedBytes = result.containerFilesystemInheritedBytes ?? info.containerFilesystemInheritedBytes;
    activeSessions.delete(sessionName);
    activeSessions.set(next, updated);
    await persist(next, updated, sessionName);
    logEvent('session_explicitly_resumed', { sessionName, sessionId: next });
    return { success: true, sessionId: next };
  }

  async function reconcileInterruptedResume(entry, runner, verbose) {
    const { sessionName, sessionInfo: info } = entry;
    const current = await inspect(entry, runner, verbose);
    const replaced = current.container !== info.sessionId && current.container !== sessionName;
    if (isLive(current.state) || (replaced && isStoppedDockerState(current.state)) || (current.status.resumeCount || 0) > info.explicitResumePending.resumeCount) {
      return adopt(
        entry,
        {
          sessionId: current.container,
          executionUuid: current.identifier,
          containerFilesystemInheritedBytes: replaced ? getCarriedContainerDiskUsage(info) : info.containerFilesystemInheritedBytes,
        },
        info.args
      );
    }
    if (current.state) {
      delete info.explicitResumePending;
      await persist(sessionName, info);
    }
    return null;
  }

  async function getDockerTaskControlState(identifier, options = {}) {
    const entry = findSession(identifier);
    if (entry?.sessionInfo.isolationBackend !== 'docker') return fail('No tracked Docker task found for this session.');
    try {
      const { state } = await inspect(entry, options.runner || (await getRunner()), options.verbose, { readOnly: true });
      return state ? { success: true, state } : unavailableState(state);
    } catch (error) {
      return fail(error.message);
    }
  }

  async function resumeStoppedSession(identifier, options = {}) {
    return withDockerTask(identifier, options, async (entry, runner) => {
      const { sessionName, sessionInfo: info } = entry;
      if (info.explicitResumePending) {
        const adopted = await reconcileInterruptedResume(entry, runner, options.verbose);
        if (adopted) return adopted;
        if (info.explicitResumePending) return fail('The previous resume is unresolved. Check /status and try again.');
      }
      const current = await inspect(entry, runner, options.verbose);
      if (current.state === 'paused') return fail('Task is paused. Use /unpause to continue the same process, or /stop then /resume to restart with its files.');
      if (current.state === 'running') return fail('Task is already running.');
      if (!isStoppedDockerState(current.state)) return unavailableState(current.state);
      if (isFormalAiTask({ args: info.args || [], model: info.model }) || hasUseRouterFlag(info.args || [])) return fail('Retained-filesystem resume is unavailable for tasks using the router or a Formal AI sidecar.');
      const markers = await readLogMarkerLines(info.logPath, /Creating temporary directory:|Working directory:|Repository dir:/);
      info.pauseWorkingDirectory ||= extractPauseWorkingDirectory(markers);
      const lastSessionId = await readLastSessionIdFromLog(info.logPath, { verbose: options.verbose });
      if (info.command === 'solve' && (lastSessionId || info.args?.includes('--auto-cleanup')) && !info.pauseWorkingDirectory) return fail('The original working directory could not be found. The container is retained.');
      const command = buildPausedTaskCommand(info, lastSessionId);
      const size = await runner.getDockerContainerWritableLayerSize?.(current.container, options.verbose);
      if (Number.isFinite(size)) info.containerFilesystemLastBytes = size;
      const previousArgs = info.args;
      info.args = command.args;
      info.explicitResumePending = { resumeCount: current.status.resumeCount || 0 };
      try {
        await persist(sessionName, info);
      } catch (error) {
        info.args = previousArgs;
        delete info.explicitResumePending;
        throw error;
      }
      const resumed = await resumeKilledSessionInPlace({ sessionName, sessionInfo: { ...info, sessionId: current.container }, plan: { command: command.launch }, runner, requireRetained: true, verbose: options.verbose });
      if (!resumed.resumed) {
        const adopted = await reconcileInterruptedResume(entry, runner, options.verbose);
        return adopted || fail(`Cannot resume the retained container (${resumed.error || resumed.reason}).`);
      }
      return adopt(entry, resumed, command.args);
    });
  }

  return {
    pauseTrackedSession: (id, options) => freeze(id, 'pause', options),
    unpauseTrackedSession: (id, options) => freeze(id, 'unpause', options),
    resumeStoppedSession,
    getDockerTaskControlState,
    stopTrackedDockerSession,
    reconcileInterruptedResume,
  };
}
