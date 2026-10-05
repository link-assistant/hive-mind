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

import { readLastSessionIdFromLog, planKilledSessionResume } from './session-resume.lib.mjs';
import { resolveOnSessionKillPolicy, resolveSessionKillResumeAttempts, pickSessionKillResumeDelayMs, shouldResumeKilledSession, ON_SESSION_KILL_RESUME } from './session-kill-policy.lib.mjs';
import { argvFromSessionArgs } from './session-monitor.kill-sections.lib.mjs';
import { formatKillResumeSection } from './session-kill-diagnostics.lib.mjs';
import { resumeKilledSessionInPlace } from './session-kill-resume.in-place.lib.mjs';

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
 * @returns {{shouldResume: boolean, reason: string, policy: string, command: Object|null, attempt: number, maxAttempts: number, lastSessionId: string|null}}
 */
export function planKillRecovery({ sessionInfo = {}, logPath = null, killed = false, env = process.env, verbose = false, readLastSessionId = readLastSessionIdFromLog } = {}) {
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

  const lastSessionId = readLastSessionId(logPath, { verbose });
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
 * @param {boolean} [options.verbose]
 * @returns {Promise<{resumed: boolean, reason: string, sessionId: string|null, display: string|null, inPlace: boolean, delayMs: number}>}
 */
export async function startKillRecoverySession({ sessionName, sessionInfo, plan, runner, trackSession, persistSnapshot = null, env = process.env, sleep = sleepBeforeRecovery, random = Math.random, verbose = false } = {}) {
  let delayMs = 0;
  const fail = reason => ({ resumed: false, reason, sessionId: null, display: plan?.command?.display || null, inPlace: false, delayMs });
  if (!plan?.shouldResume || !plan.command) return fail(plan?.reason || 'no-plan');
  if (!runner || typeof runner.executeWithIsolation !== 'function' || typeof runner.generateSessionId !== 'function') return fail('no-isolation-runner');
  if (typeof trackSession !== 'function') return fail('no-tracker');
  const backend = sessionInfo?.isolationBackend || null;
  if (!backend) return fail('no-isolation-backend');

  try {
    // Issue #2498: one OOM event may have killed several sessions at once.
    // Restarting them all in the same second rushes the same memory, CPUs and
    // API again, so each recovery waits its own random delay first. The monitor
    // keeps the session in flight meanwhile, so no other tick launches it too.
    delayMs = pickSessionKillResumeDelayMs({ argv: argvFromSessionArgs(sessionInfo?.args), env, random });
    if (delayMs > 0) {
      if (verbose) console.log(`[VERBOSE] Session ${sessionName}: waiting ${Math.round(delayMs / 1000)}s before starting the recovery session, so recoveries from one event do not start together (issue #2498)`);
      await sleep(delayMs);
    }
    // A /stop can arrive while this session is waiting. Recheck the mutable
    // tracked record before either resume path so cancellation wins (#2498).
    if (sessionInfo?.stopRequestedByUser === true) return fail('stopped-by-user');
    // Preferred path: re-enter the container the work already happened in.
    const inPlace = await resumeKilledSessionInPlace({ sessionName, sessionInfo, plan, runner, verbose });
    let newSessionId = inPlace.sessionId;
    let executionUuid = inPlace.executionUuid;
    let containerFilesystemStartBytes = null;
    let containerResourceLimits = sessionInfo?.containerResourceLimits || null;

    if (!inPlace.resumed) {
      newSessionId = runner.generateSessionId();
      const tool = sessionInfo?.tool || 'claude';
      const result = await runner.executeWithIsolation(sessionInfo?.command || 'solve', plan.command.args, { backend, sessionId: newSessionId, tool, verbose, containerResourceLimits: sessionInfo?.containerResourceLimits?.requested || null });
      if (!result?.success) return fail('start-failed');
      executionUuid = result.executionUuid || null;
      containerFilesystemStartBytes = Number.isFinite(result.containerFilesystemStartBytes) ? result.containerFilesystemStartBytes : null;
      containerResourceLimits = result.containerResourceLimits || null;
    }

    trackSession(
      newSessionId,
      {
        ...sessionInfo,
        startTime: new Date(),
        sessionId: newSessionId,
        args: [...plan.command.args],
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
        oomEventObservedAt: undefined,
        dockerBackendGoneFirstSeenAt: undefined,
        // The recovery session has not been recovered itself (yet) (#2408).
        killRecoverySessionId: undefined,
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
      console.log(`[VERBOSE] Session ${sessionName} was killed; recovery session ${newSessionId} ${how} (attempt ${plan.attempt}/${plan.maxAttempts}): ${plan.command.display}`);
    }
    return { resumed: true, reason: inPlace.resumed ? inPlace.reason : 'started', sessionId: newSessionId, display: plan.command.display, inPlace: inPlace.resumed, delayMs };
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] Could not start recovery session for ${sessionName}: ${error?.message || error}`);
    }
    return fail('start-error');
  }
}

/**
 * Plan and, when the policy asks for it, perform the recovery in one call.
 * Never throws — a failed recovery must still leave a correct kill report.
 *
 * @param {Object} options - See planKillRecovery() and startKillRecoverySession()
 * @returns {Promise<{resumed: boolean, reason: string, policy: string, sessionId: string|null, display: string|null, attempt: number, maxAttempts: number, inPlace: boolean}>}
 */
export async function recoverKilledSession({ sessionName, sessionInfo, logPath = null, killed = false, env = process.env, runner = null, trackSession = null, persistSnapshot = null, sleep = sleepBeforeRecovery, random = Math.random, verbose = false, readLastSessionId = readLastSessionIdFromLog } = {}) {
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
    plan = planKillRecovery({ sessionInfo, logPath, killed, env, verbose, readLastSessionId });
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] Could not plan kill recovery for ${sessionName}: ${error?.message || error}`);
    return { resumed: false, reason: 'plan-error', policy: ON_SESSION_KILL_RESUME, sessionId: null, display: null, attempt: 0, maxAttempts: 0, inPlace: false };
  }

  if (!plan.shouldResume) {
    if (verbose) console.log(`[VERBOSE] Session ${sessionName}: no recovery session started (policy=${plan.policy}, reason=${plan.reason}, attempt ${plan.attempt}/${plan.maxAttempts})`);
    return { resumed: false, reason: plan.reason, policy: plan.policy, sessionId: null, display: plan.command?.display || null, attempt: plan.attempt, maxAttempts: plan.maxAttempts, inPlace: false };
  }

  const started = await startKillRecoverySession({ sessionName, sessionInfo, plan, runner, trackSession, persistSnapshot, env, sleep, random, verbose });
  return { resumed: started.resumed, reason: started.reason, policy: plan.policy, sessionId: started.sessionId, display: started.display, attempt: plan.attempt, maxAttempts: plan.maxAttempts, inPlace: started.inPlace === true };
}

/**
 * Completion-time entry point: recover the killed session and render the
 * Telegram section describing what was started, in one call — the monitor is at
 * its `max-lines` budget and this keeps the two facts (what happened, what is
 * said about it) together.
 *
 * @param {Object} options - See recoverKilledSession(); plus `locale`
 * @returns {Promise<{recovery: Object, section: string}>}
 */
export async function runKillRecoveryForCompletion({ locale = null, ...options } = {}) {
  const recovery = await recoverKilledSession(options);
  const section = formatKillResumeSection({
    sessionId: recovery.resumed ? recovery.sessionId : null,
    attempt: recovery.attempt,
    maxAttempts: recovery.maxAttempts,
    locale,
  });
  return { recovery, section };
}
