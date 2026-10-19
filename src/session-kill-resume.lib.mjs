/**
 * Automatic recovery of a killed working session (issue #2134).
 *
 * `--on-session-kill=resume` (env `HIVE_MIND_ON_SESSION_KILL`) asks for a new
 * working session to be started when the previous one was killed by the kernel
 * (out of memory), by a full disk, or by a forced kill. This module performs
 * that restart, and — just as importantly — reports it: the caller puts the
 * returned facts into the Telegram completion message AND into the pull request
 * notice, so a reader of either surface knows a recovery session exists.
 *
 * The restart is bounded by `--session-kill-resume-attempts` (default 3), so a
 * job that reliably runs the host out of memory cannot storm the queue.
 *
 * Issue #2189 made `resume` the default: a killed session that is only ever
 * *offered* for resume is a session nobody resumes. `--on-session-kill=report`
 * turns everything below back off, and `planKillRecovery` still returns
 * `reason: 'policy-report'` in that case.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2134
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 */

import fs from 'node:fs/promises';
import { readLastSessionIdFromLog, planKilledSessionResume } from './session-resume.lib.mjs';
import { resolveOnSessionKillPolicy, resolveSessionKillResumeAttempts, pickSessionKillResumeDelayMs, shouldResumeKilledSession, ON_SESSION_KILL_RESUME } from './session-kill-policy.lib.mjs';
import { argvFromSessionArgs } from './session-monitor.kill-sections.lib.mjs';
import { formatKillResumeSection } from './session-kill-diagnostics.lib.mjs';
import { resumeKilledSessionInPlace } from './session-kill-resume.in-place.lib.mjs';
import { FRESH_RESUME_OUTCOMES, resolveFreshRecoveryCommand } from './session-kill-resume.fresh-session.lib.mjs';
import { isDiskRefusedRecovery, relaunchDiskRefusedRecovery } from './session-kill-resume.disk-retry.lib.mjs';
import { detectFailedInPlaceStart, relaunchFailedInPlaceStart } from './session-kill-resume.start-failure.lib.mjs';
import { findRunningSessionContainers, nextContainerNameHistory, resolveSessionContainerRoot } from './session-container-identity.lib.mjs';
import { waitForRecoveryResources } from './session-kill-resume.resource-gate.lib.mjs';

/** Field recording how many automatic recovery sessions this session produced. */
export const KILL_RESUME_ATTEMPTS_FIELD = 'killRecoveryAttempts';

/** Default wait used before a recovery starts; replaced in tests. */
export const sleepBeforeRecovery = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Decide whether a killed session should be auto-resumed, and with which
 * command. Pure — no process is started here, so the decision is testable on
 * its own and the caller can report a skipped resume just as precisely.
 *
 * @param {Object} options
 * @param {Object} options.sessionInfo - Persisted session info
 * @param {string|null} [options.logPath] - Working-session log to scan for the tool session id
 * @param {boolean} options.killed - The completion outcome is a kill
 * @param {Object} [options.env]
 * @param {boolean} [options.verbose]
 * @param {Function} [options.readLastSessionId] - Override for tests
 * @returns {Promise<{shouldResume: boolean, reason: string, policy: string, command: Object|null, attempt: number, maxAttempts: number, lastSessionId: string|null}>}
 */
export async function planKillRecovery({ sessionInfo = {}, logPath = null, killed = false, env = process.env, verbose = false, readLastSessionId = readLastSessionIdFromLog } = {}) {
  const argv = argvFromSessionArgs(sessionInfo?.args);
  const policy = resolveOnSessionKillPolicy({ argv, env, sessionInfo, verbose });
  const maxAttempts = resolveSessionKillResumeAttempts({ argv, env });
  const attempts = Number.isFinite(sessionInfo?.[KILL_RESUME_ATTEMPTS_FIELD]) ? sessionInfo[KILL_RESUME_ATTEMPTS_FIELD] : 0;
  const base = { shouldResume: false, policy, command: null, attempt: attempts, maxAttempts, lastSessionId: null };

  if (!shouldResumeKilledSession({ policy, killed })) {
    return { ...base, reason: killed ? 'policy-report' : 'not-killed' };
  }
  if (sessionInfo?.stopRequestedByUser === true) {
    // A `/stop` is a kill the operator asked for; restarting it would fight them.
    return { ...base, reason: 'stopped-by-user' };
  }

  const lastSessionId = await readLastSessionId(logPath, { verbose });
  const plan = planKilledSessionResume({ sessionInfo, lastSessionId, attempts, maxAttempts });
  return { ...base, shouldResume: plan.resumable, reason: plan.reason, command: plan.command, attempt: plan.attempt, lastSessionId: lastSessionId || null };
}

/**
 * Execution UUIDs whose start-command logs precede a recovery session's own
 * (issue #2408). An in-place resume keeps its UUID and adds nothing.
 *
 * @param {Object} sessionInfo - The killed session's info
 * @param {string|null} nextExecutionUuid - The recovery session's execution UUID
 * @returns {string[]}
 */
export function collectPreviousExecutionUuids(sessionInfo, nextExecutionUuid) {
  const chain = Array.isArray(sessionInfo?.previousExecutionUuids) ? sessionInfo.previousExecutionUuids.filter(Boolean) : [];
  const current = sessionInfo?.executionUuid || null;
  if (current && current !== nextExecutionUuid && !chain.includes(current)) chain.push(current);
  return chain;
}

/**
 * Start the recovery working session decided by {@link planKillRecovery}.
 *
 * Two ways in, in order of preference:
 *
 *   1. **Same container** (issue #2189) — `$ --resume` re-enters the killed
 *      session's own filesystem, so the clone, the caches and the half-finished
 *      branch survive. See `./session-kill-resume.in-place.lib.mjs` for the
 *      cases that are deliberately excluded.
 *   2. **A fresh isolated run** — the original behaviour, used whenever (1) is
 *      not available or refuses. Correct, just more expensive.
 *
 * Either way the new session is tracked like any other, so it reports its own
 * completion (and, if it is killed too, its own diagnosis) through the normal
 * path.
 *
 * @param {Object} options
 * @param {string} options.sessionName - The killed session's name
 * @param {Object} options.sessionInfo - Persisted session info
 * @param {Object} options.plan - Result of planKillRecovery()
 * @param {Object} options.runner - Isolation runner (executeWithIsolation/generateSessionId)
 * @param {Function} options.trackSession - Tracker for the new session
 * @param {Function} [options.persistSnapshot] - Persist the attempt counter
 * @param {Object} [options.env] - Source of `HIVE_MIND_SESSION_KILL_RESUME_DELAY`
 * @param {Function} [options.sleep] - Waits the random pre-launch delay (issue #2498)
 * @param {Function} [options.random] - Test seam for the delay
 * @param {Object} [options.snapshotGuard] - Test seams for the snapshot disk guard (issue #2889)
 * @param {Function} [options.resolveFreshCommand] - Picks the fresh-run command (issue #2888)
 * @param {string|null} [options.skipInPlace] - Why the in-place path is skipped: the last in-place start never ran its command (issue #2887)
 * @param {Object|null} [options.resourceGate] - Queue resource gate the launch waits for (issue #3530)
 * @param {Function|null} [options.findActiveSibling] - `(url, sessionName) => name|null`: another tracked session already working on the same URL (issue #3532)
 * @param {boolean} [options.verbose]
 * @returns {Promise<{resumed: boolean, reason: string, sessionId: string|null, display: string|null, inPlace: boolean, delayMs: number, freshResume: string|null, detail?: string|null}>}
 */
export async function startKillRecoverySession({ sessionName, sessionInfo, plan, runner, trackSession, persistSnapshot = null, env = process.env, sleep = sleepBeforeRecovery, random, onLifecycle = async () => {}, snapshotGuard = {}, resolveFreshCommand = resolveFreshRecoveryCommand, skipInPlace = null, resourceGate = null, findActiveSibling = null, now = Date.now, verbose = false } = {}) {
  let delayMs = 0;
  const notify = async event => {
    try {
      // Issue #3530: Telegram shows the attempt count, "attempt n/m".
      await onLifecycle({ maxAttempts: plan?.maxAttempts ?? null, ...event });
    } catch (error) {
      console.warn(`[session-recovery] Lifecycle publication failed: ${error?.message || error}`);
    }
  };
  const fail = (reason, detail = null) => ({ resumed: false, reason, detail, sessionId: null, display: plan?.command?.display || null, inPlace: false, delayMs });
  if (!plan?.shouldResume || !plan.command) return fail(plan?.reason || 'no-plan');
  if (!runner || typeof runner.executeWithIsolation !== 'function' || typeof runner.generateSessionId !== 'function') return fail('no-isolation-runner');
  if (typeof trackSession !== 'function') return fail('no-tracker');
  const backend = sessionInfo?.isolationBackend || null;
  if (!backend) return fail('no-isolation-backend');

  // Issue #3532: while this session waits, it is no live sibling of another
  // recovery for the same URL — only the session that recovery starts is.
  if (sessionInfo) sessionInfo.killRecoveryPendingSince = new Date(now()).toISOString();
  try {
    // Issue #2498: one OOM event may have killed several sessions at once.
    // Restarting them all in the same second rushes the same memory, CPUs and
    // API again, so each recovery waits its own random delay first. The monitor
    // keeps the session in flight meanwhile, so no other tick launches it too.
    delayMs = pickSessionKillResumeDelayMs({ argv: argvFromSessionArgs(sessionInfo?.args), env, random });
    await notify({ phase: 'waiting', attempt: plan.attempt, delayMs });
    if (delayMs > 0) {
      if (verbose) console.log(`[VERBOSE] Session ${sessionName}: waiting ${Math.round(delayMs / 1000)}s before starting the recovery session, so recoveries from one event do not start together (issue #2498)`);
      await sleep(delayMs);
    }
    // A /stop can arrive while this session is waiting. Recheck the mutable
    // tracked record before either resume path so cancellation wins (#2498).
    if (sessionInfo?.stopRequestedByUser === true) return fail('stopped-by-user');
    // Issue #3530: after an OOM the host needs time to free its memory. Wait
    // until the queue's resource checks pass several times in a row, exactly
    // like a queued task, instead of rushing the same memory again.
    const resources = await waitForRecoveryResources({ sessionName, sessionInfo, attempt: plan.attempt, maxAttempts: plan.maxAttempts, gate: resourceGate, notify, sleep, env, now, verbose });
    if (!resources.ready) {
      if (resources.reason !== 'stopped-by-user') await notify({ phase: 'failed', attempt: plan.attempt, reason: resources.detail || resources.reason });
      return fail(resources.reason, resources.detail || null);
    }
    // Issue #3532: never start attempt N+1 while anything of this task still
    // runs, whatever the tracked state claims.
    const duplicate = await findRunningDuplicate({ sessionName, sessionInfo, runner, findActiveSibling, verbose });
    if (duplicate) {
      console.warn(`[session-kill-resume] ${sessionName}: not starting recovery attempt ${plan.attempt}/${plan.maxAttempts}: ${duplicate} (issue #3532)`);
      await notify({ phase: 'failed', attempt: plan.attempt, reason: `Recovery not started: ${duplicate}.` });
      return fail('already-running', duplicate);
    }
    await notify({ phase: 'launching', attempt: plan.attempt });
    // Preferred path: re-enter the container the work already happened in.
    const recoveryStartedAt = new Date().toISOString();
    const previousLogBytes = sessionInfo?.logPath
      ? await fs
          .stat(sessionInfo.logPath)
          .then(stat => stat.size)
          .catch(() => null)
      : null;
    const inPlace = skipInPlace ? { resumed: false, reason: 'previous-in-place-start-failed', error: skipInPlace, sessionId: null, executionUuid: null, mode: null } : await resumeKilledSessionInPlace({ sessionName, sessionInfo, plan, runner, notify, snapshotGuard, verbose });
    let newSessionId = inPlace.sessionId;
    let executionUuid = inPlace.executionUuid;
    let logPath = inPlace.resumed ? sessionInfo?.logPath || null : null;
    let containerFilesystemStartBytes = null;
    let containerResourceLimits = sessionInfo?.containerResourceLimits || null;
    let launchCommand = plan.command;
    let freshResume = null;

    if (!inPlace.resumed) {
      if (inPlace.error) await notify({ phase: 'launching', attempt: plan.attempt, reason: `${inPlace.error} Starting a fresh isolated session.` });
      // Issue #2888: a new container resumes only a tool session it can reach.
      const fresh = await resolveFreshCommand({ sessionName, sessionInfo, command: plan.command, runner, verbose });
      launchCommand = fresh?.command || plan.command;
      freshResume = fresh?.outcome || null;
      if (fresh?.outcome === FRESH_RESUME_OUTCOMES.DROPPED) await notify({ phase: 'launching', attempt: plan.attempt, reason: fresh.detail });
      else if (fresh?.detail) console.log(`[session-kill-resume] ${sessionName}: ${fresh.detail}`);
      newSessionId = runner.generateSessionId();
      const tool = sessionInfo?.tool || 'claude';
      const result = await runner.executeWithIsolation(launchCommand.binary || sessionInfo?.command || 'solve', launchCommand.args, { backend, sessionId: newSessionId, tool, verbose, containerResourceLimits: sessionInfo?.containerResourceLimits?.requested || null });
      if (!result?.success) {
        await notify({ phase: 'failed', attempt: plan.attempt, reason: result?.error || 'Automatic recovery could not start a fresh isolated session.' });
        return fail('start-failed');
      }
      executionUuid = result.executionUuid || null;
      logPath = result.logPath || null;
      containerFilesystemStartBytes = Number.isFinite(result.containerFilesystemStartBytes) ? result.containerFilesystemStartBytes : null;
      containerResourceLimits = result.containerResourceLimits || null;
    }

    trackSession(
      newSessionId,
      {
        ...sessionInfo,
        startTime: new Date(recoveryStartedAt),
        killRecoveryStartedAt: recoveryStartedAt,
        killRecoveryLogStartBytes: inPlace.resumed ? previousLogBytes : 0,
        logPath,
        // Completion and tool-id caches describe the previous attempt.
        completionNotifiedAt: undefined,
        completionExitCode: undefined,
        completionStatus: undefined,
        lastToolSessionId: undefined,
        recoveryLifecycle: sessionInfo.recoveryLifecycle ? { ...sessionInfo.recoveryLifecycle, kind: 'container', attempt: plan.attempt, startedAt: recoveryStartedAt, lastBytes: inPlace.resumed ? previousLogBytes : 0, lastOutputAt: null } : undefined,
        sessionId: newSessionId,
        // Issue #3532: the container this attempt runs in, recorded as such.
        // A docker-start resume reports the execution UUID as `sessionId`,
        // which `docker inspect` does not know.
        containerName: inPlace.resumed ? inPlace.containerName || resolveContainerAfterResume(sessionName, sessionInfo) : newSessionId,
        rootContainerName: resolveSessionContainerRoot(sessionName, sessionInfo),
        containerNameHistory: nextContainerNameHistory(sessionName, sessionInfo),
        args: [...launchCommand.args],
        // Carry the counter forward so attempt N+1 is bounded by the same cap,
        // and remember what this session is recovering from for its own report.
        [KILL_RESUME_ATTEMPTS_FIELD]: plan.attempt,
        killRecoveryResumed: true,
        killRecoveryOfSession: sessionName,
        // Issue #2301: the Telegram message keeps naming the session the work
        // was started with, however many recovery sessions follow.
        rootSessionName: sessionInfo?.rootSessionName || sessionName,
        rootStartTime: sessionInfo?.rootStartTime || sessionInfo?.startTime || null,
        // A resumed execution keeps its UUID; a fresh launch gets a new one, and
        // inheriting the dead session's would make `$ --status` answer about the
        // wrong execution until the monitor happened to correct it.
        executionUuid,
        // Issue #2408: a fresh launch writes a new start-command log, so keep the
        // earlier executions' UUIDs to let the report point at the whole log chain.
        previousExecutionUuids: collectPreviousExecutionUuids(sessionInfo, executionUuid),
        killRecoveryInPlace: inPlace.resumed,
        killRecoveryResumeMode: inPlace.mode || null,
        // Issue #2889: the snapshot images behind this execution, removed once
        // the task's last container is removed.
        killRecoverySnapshotImages: inPlace.resumed && inPlace.snapshotImage ? [...(sessionInfo?.killRecoverySnapshotImages || []), inPlace.snapshotImage] : sessionInfo?.killRecoverySnapshotImages,
        oomEventObservedAt: undefined,
        dockerBackendGoneFirstSeenAt: undefined,
        // The recovery session has not been recovered itself (yet) (#2408).
        killRecoverySessionId: undefined,
        killRecoveryPendingSince: undefined,
        containerFilesystemStartBytes,
        containerResourceLimits,
        // Issue #2408: a snapshot resume starts a new, empty writable layer;
        // what the execution already wrote counts against the same disk limit.
        // The new container's own usage is measured afresh by the monitor.
        containerFilesystemInheritedBytes: inPlace.resumed && Number.isFinite(inPlace.containerFilesystemInheritedBytes) ? inPlace.containerFilesystemInheritedBytes : undefined,
        containerFilesystemLastBytes: undefined,
        containerFilesystemLastObservedAt: undefined,
      },
      verbose
    );

    if (sessionInfo) {
      sessionInfo[KILL_RESUME_ATTEMPTS_FIELD] = plan.attempt;
      // Persisted with the counter, so a repeated completion finds it (#2408).
      sessionInfo.killRecoverySessionId = newSessionId;
      // Issue #2889: a docker-start resume runs in this very container, which
      // the killed session's completion must therefore not remove.
      sessionInfo.killRecoveryContainerName = inPlace.resumed ? inPlace.containerName || null : null;
    }
    if (typeof persistSnapshot === 'function') {
      try {
        persistSnapshot();
      } catch {
        // Persisting the counter is best effort; the recovery session is started.
      }
    }

    if (verbose) {
      const how = inPlace.resumed ? `resumed in place (${inPlace.mode || 'unknown mode'})` : `started fresh (in-place resume skipped: ${inPlace.reason})`;
      console.log(`[VERBOSE] Session ${sessionName} was killed; recovery session ${newSessionId} ${how} (attempt ${plan.attempt}/${plan.maxAttempts}): ${launchCommand.display}`);
    }
    await notify({ phase: 'launching', stage: 'accepted', attempt: plan.attempt, nextSession: newSessionId, executionUuid });
    return { resumed: true, reason: inPlace.resumed ? inPlace.reason : 'started', sessionId: newSessionId, display: launchCommand.display, inPlace: inPlace.resumed, delayMs, freshResume };
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] Could not start recovery session for ${sessionName}: ${error?.message || error}`);
    }
    return fail('start-error');
  } finally {
    if (sessionInfo) delete sessionInfo.killRecoveryPendingSince;
  }
}

/** The container an in-place resume re-entered when the runner did not name it. */
function resolveContainerAfterResume(sessionName, sessionInfo) {
  return sessionInfo?.containerName || sessionInfo?.sessionId || sessionName || null;
}

/**
 * Why a recovery must not start because the task is still running somewhere
 * (issue #3532), or `null`. Two independent signals:
 *
 *   - a running container of the task's family (the root, its `-resume-<n>`
 *     successors, and the containers of earlier attempts);
 *   - another tracked, unfinished session for the same URL.
 *
 * @returns {Promise<string|null>}
 */
export async function findRunningDuplicate({ sessionName, sessionInfo, runner = null, findActiveSibling = null, verbose = false } = {}) {
  if (sessionInfo?.isolationBackend === 'docker') {
    const running = await findRunningSessionContainers(sessionName, sessionInfo, { runner, includeHistory: true, verbose });
    if (running.length > 0) return `container ${running.join(', ')} of the same task is still running`;
  }
  if (typeof findActiveSibling === 'function' && sessionInfo?.url) {
    try {
      const sibling = await findActiveSibling(sessionInfo.url, sessionName);
      if (sibling) return `session ${sibling} is already working on ${sessionInfo.url}`;
    } catch (error) {
      if (verbose) console.log(`[VERBOSE] Could not check for another session on ${sessionInfo.url}: ${error?.message || error}`);
    }
  }
  if (verbose) console.log(`[VERBOSE] Session ${sessionName}: nothing else of this task is running; the recovery may start (issue #3532)`);
  return null;
}

/**
 * Plan and, when the policy asks for it, perform the recovery in one call.
 * Never throws — a failed recovery must still leave a correct kill report.
 *
 * @param {Object} options - See planKillRecovery() and startKillRecoverySession()
 * @returns {Promise<{resumed: boolean, reason: string, policy: string, sessionId: string|null, display: string|null, attempt: number, maxAttempts: number, inPlace: boolean}>}
 */
export async function recoverKilledSession({ sessionName, sessionInfo, logPath = null, killed = false, env = process.env, runner = null, trackSession = null, persistSnapshot = null, sleep = sleepBeforeRecovery, random, onLifecycle, snapshotGuard = {}, resolveFreshCommand, skipInPlace = null, resourceGate = null, findActiveSibling = null, now, verbose = false, readLastSessionId = readLastSessionIdFromLog } = {}) {
  // Issue #2408: one kill gets one recovery. A completion that runs again for
  // the same session (an overlapping monitor tick, a bot restart between the
  // launch and the completion latch) must report the session already started,
  // not spend another attempt — or, with the budget spent, report "failed".
  const existing = sessionInfo?.killRecoverySessionId || null;
  if (existing) {
    const argv = argvFromSessionArgs(sessionInfo?.args);
    const attempt = Number.isFinite(sessionInfo?.[KILL_RESUME_ATTEMPTS_FIELD]) ? sessionInfo[KILL_RESUME_ATTEMPTS_FIELD] : 1;
    if (verbose) console.log(`[VERBOSE] Session ${sessionName} already started recovery session ${existing}; not starting another (issue #2408)`);
    return { resumed: true, reason: 'already-recovered', policy: resolveOnSessionKillPolicy({ argv, env, sessionInfo }), sessionId: existing, display: null, attempt, maxAttempts: resolveSessionKillResumeAttempts({ argv, env }), inPlace: false };
  }
  let plan;
  try {
    plan = await planKillRecovery({ sessionInfo, logPath, killed, env, verbose, readLastSessionId });
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] Could not plan kill recovery for ${sessionName}: ${error?.message || error}`);
    return { resumed: false, reason: 'plan-error', policy: ON_SESSION_KILL_RESUME, sessionId: null, display: null, attempt: 0, maxAttempts: 0, inPlace: false };
  }

  if (!plan.shouldResume) {
    if (verbose) console.log(`[VERBOSE] Session ${sessionName}: no recovery session started (policy=${plan.policy}, reason=${plan.reason}, attempt ${plan.attempt}/${plan.maxAttempts})`);
    return { resumed: false, reason: plan.reason, policy: plan.policy, sessionId: null, display: plan.command?.display || null, attempt: plan.attempt, maxAttempts: plan.maxAttempts, inPlace: false };
  }

  const started = await startKillRecoverySession({ sessionName, sessionInfo, plan, runner, trackSession, persistSnapshot, env, sleep, random, onLifecycle, snapshotGuard, resolveFreshCommand, skipInPlace, resourceGate, findActiveSibling, now, verbose });
  return { resumed: started.resumed, reason: started.reason, detail: started.detail || null, policy: plan.policy, sessionId: started.sessionId, display: started.display, attempt: plan.attempt, maxAttempts: plan.maxAttempts, inPlace: started.inPlace === true };
}

/**
 * Completion-time entry point: recover the killed session and render the
 * Telegram section describing what was started, in one call — the monitor is at
 * its `max-lines` budget and this keeps the two facts (what happened, what is
 * said about it) together.
 *
 * @param {Object} options - See recoverKilledSession(); plus `locale`, the
 *   session's `exitCode` and `diskRetry` test seams (issue #2888)
 * @returns {Promise<{recovery: Object, section: string}>}
 */
export async function runKillRecoveryForCompletion({ locale = null, exitCode = null, diskRetry = {}, ...options } = {}) {
  // Issue #2888: a recovery session solve refused for disk space did no work;
  // relaunch it under the same attempt once the space is back.
  // Issue #2887: an in-place recovery that exited 126/127 never ran its command;
  // the kill it was recovering from gets a fresh recovery under the same attempt.
  const startFailure = detectFailedInPlaceStart({ sessionInfo: options.sessionInfo, exitCode });
  let recovery;
  if (isDiskRefusedRecovery({ sessionInfo: options.sessionInfo, exitCode })) recovery = await relaunchDiskRefusedRecovery({ ...options, ...diskRetry, recover: recoverKilledSession });
  else if (startFailure) recovery = await relaunchFailedInPlaceStart({ ...options, failure: startFailure, recover: recoverKilledSession });
  else recovery = await recoverKilledSession(options);
  const section = formatKillResumeSection({
    sessionId: recovery.resumed ? recovery.sessionId : null,
    attempt: recovery.attempt,
    maxAttempts: recovery.maxAttempts,
    locale,
  });
  return { recovery, section };
}
