/** Bounded, observable in-process SIGKILL recovery (#2408, #2498). */
import { resolveSessionKillResumeAttempts, pickSessionKillResumeDelayMs } from './session-kill-policy.lib.mjs';
import { postTrackedComment, RECOVERY_LIFECYCLE_MARKER } from './tool-comments.lib.mjs';
import { RECOVERY_HEARTBEAT_MS, recoveryLogLine } from './session-recovery-lifecycle.lib.mjs';
import { RECOVERY_PENDING_START_MARKER, RECOVERY_PENDING_END_MARKER, settleRecoveryPendingBlock } from './session-kill-recovery.lib.mjs';

/** 128 + SIGKILL(9); this exit code alone does not establish an OOM cause. */
export const SIGKILL_EXIT_CODE = 137;
export const TOOL_KILL_RESUME_FEEDBACK = 'Continue. Your previous run was killed with SIGKILL (exit code 137). Its cause is not established by that exit code; an out-of-memory kill is one possibility. Continue from where you stopped, and prefer lower-memory commands: run builds and tests one at a time, and use `cargo build -j 1` / `CARGO_BUILD_JOBS=1` or one test target at a time.';

export function isToolProcessKilled(toolResult) {
  if (!toolResult || toolResult.success || toolResult.limitReached) return false;
  const exitCode = toolResult.exitCode ?? toolResult.errorInfo?.exitCode ?? null;
  return Number(exitCode) === SIGKILL_EXIT_CODE || toolResult.signal === 'SIGKILL' || toolResult.errorInfo?.signal === 'SIGKILL';
}

export function buildToolKillWarningComment({ tool = 'claude', sessionId = null, attempt = 1, maxAttempts = 1, resuming = true, delayMs = 0 } = {}) {
  const toolName = String(tool || 'claude').toUpperCase();
  const lines = ['## ⚠️ Working process killed (SIGKILL, exit code 137)', '', `The ${toolName} process was killed. SIGKILL alone does not establish the cause; out-of-memory termination is one possibility.`, ''];
  if (resuming) {
    // Issue #3530: this note is removed once the attempt launches.
    lines.push(RECOVERY_PENDING_START_MARKER, `⏳ **Auto recovery (resume or restart as per configuration) is pending:** attempt ${attempt}/${maxAttempts}, ${sessionId ? `automatically resuming the same ${toolName} session \`${sessionId}\`` : `restarting ${toolName}`} in the same working directory after ${Math.round(delayMs / 1000)} seconds. This note is removed when the attempt starts.`, RECOVERY_PENDING_END_MARKER);
  } else {
    lines.push(`The automatic recovery budget (${maxAttempts}) is spent, so the work stops here. No further retry is scheduled. Raise \`--session-kill-resume-attempts\` or reduce the memory the build needs, then re-run the command.`);
  }
  lines.push('', RECOVERY_LIFECYCLE_MARKER);
  return lines.join('\n');
}

/**
 * Every attempt has a scheduled, launching and terminal record in the solve
 * log (also captured by start-command). The monitor consumes these records to
 * update Telegram. A heartbeat confirms only that the retry is still awaiting
 * its result, never that it made task progress. Timers are cleared and pending
 * publications drained before returning.
 *
 * Issue #3530: GitHub gets one comment per kill. It is posted with a "recovery
 * pending" note and edited once: the note is removed when the attempt launches,
 * or replaced with the reason when it is cancelled. Heartbeats and phase
 * changes are no longer published to GitHub.
 *
 * Issue #2498: `isWorkDone` (e.g. "is the pull request merged?") is checked
 * before an attempt is scheduled and again after the delay. Once the work is
 * done nothing is retried, and a scheduled attempt is recorded as cancelled;
 * `workDone: true` tells the caller to finish instead of reporting a failure.
 */
export async function resumeAfterToolKill({ toolResult, attemptsUsed = 0, argv = {}, runIteration, env = process.env, $ = null, owner = null, repo = null, prNumber = null, log = async () => {}, postComment = postTrackedComment, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), random, now = Date.now, setIntervalFn = setInterval, clearIntervalFn = clearInterval, isWorkDone = null } = {}) {
  let result = toolResult;
  let used = attemptsUsed;
  let resumed = false;
  let commentId = null;
  const workDone = async () => {
    if (typeof isWorkDone !== 'function') return false;
    try {
      return (await isWorkDone()) === true;
    } catch (error) {
      await log(`   ⚠️  Could not check whether the work is already done: ${error?.message || error}`);
      return false;
    }
  };
  const WORK_DONE_REASON = 'the pull request is already merged, so the work is complete';
  const maxAttempts = resolveSessionKillResumeAttempts({ argv, env });
  const announce = async body => {
    if (!$ || !owner || !repo || !prNumber) return;
    try {
      const posted = await postComment({ $, owner, repo, targetNumber: prNumber, body, commentId });
      if (posted?.ok === false) throw new Error(posted.stderr?.toString() || 'GitHub comment publication failed');
      if (posted?.commentId) commentId = posted.commentId;
    } catch (error) {
      await log(`   ⚠️  Could not publish recovery status: ${error?.message || error}`);
    }
  };

  while (isToolProcessKilled(result)) {
    const sessionId = result.sessionId || null;
    // Issue #3530: one comment per kill — a later kill never rewrites an earlier one.
    commentId = null;
    if (await workDone()) {
      // Nothing was scheduled or announced, so no lifecycle record is written:
      // the monitor must not open a recovery comment after the merge.
      await log(`ℹ️ Working process killed, but ${WORK_DONE_REASON}. No recovery is needed.`);
      return { toolResult: result, attemptsUsed: used, resumed, workDone: true };
    }
    if (used >= maxAttempts || typeof runIteration !== 'function') {
      const reason = used >= maxAttempts ? `automatic recovery budget ${used}/${maxAttempts} is spent` : 'no retry execution callback is available';
      await log(`⚠️ Working process killed; ${reason}. No further retry is scheduled.`);
      await log(recoveryLogLine({ kind: 'tool', phase: 'failed', attempt: Math.max(1, used), exitCode: SIGKILL_EXIT_CODE, reason, at: new Date(now()).toISOString() }));
      if (maxAttempts > 0) await announce(typeof runIteration === 'function' ? buildToolKillWarningComment({ tool: argv.tool, sessionId, attempt: used, maxAttempts, resuming: false }) : `## ❌ Recovery attempt could not start\n\n${reason}. No further retry is scheduled.`);
      break;
    }
    used++;
    const delayMs = pickSessionKillResumeDelayMs({ argv, env, random });
    const startedAt = new Date(now()).toISOString();
    const record = async (phase, fields = {}) => {
      const event = { kind: 'tool', phase, attempt: used, maxAttempts, startedAt, sessionName: sessionId, at: new Date(now()).toISOString(), ...fields };
      if (commentId) event.commentUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}#issuecomment-${commentId}`;
      await log(recoveryLogLine(event));
    };
    const warning = buildToolKillWarningComment({ tool: argv.tool, sessionId, attempt: used, maxAttempts, delayMs });
    // Edit the one kill comment once; nothing to edit when it was never posted.
    const settle = async outcome => {
      const settled = commentId ? settleRecoveryPendingBlock(warning, outcome) : null;
      if (settled) await announce(settled);
    };
    await announce(warning);
    await log(recoveryLogLine({ kind: 'tool', phase: 'waiting', attempt: used, startedAt, delayMs, at: startedAt, ...(commentId ? { commentUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}#issuecomment-${commentId}` } : {}) }));
    if (delayMs > 0) {
      await log(`   ⏳ Waiting ${Math.round(delayMs / 1000)}s before resuming to spread recovery launches.`);
      await sleep(delayMs);
    }
    if (await workDone()) {
      await settle({ resumed: false, reason: WORK_DONE_REASON });
      await record('cancelled', { reason: WORK_DONE_REASON });
      await log(`Recovery attempt ${used}/${maxAttempts} cancelled: ${WORK_DONE_REASON}.`);
      return { toolResult: result, attemptsUsed: used, resumed, workDone: true };
    }
    let timer = null;
    let heartbeat = Promise.resolve();
    try {
      await settle({ resumed: true });
      await record('launching');
      timer = setIntervalFn(() => {
        // Serialize slow publications; do not leave rejected timer promises.
        heartbeat = heartbeat.then(() => record('running')).catch(error => log(`Recovery heartbeat failed: ${error?.message || error}`));
      }, RECOVERY_HEARTBEAT_MS);
      timer?.unref?.();
      result = await runIteration({ argv: sessionId ? { ...argv, resume: sessionId } : argv, feedbackLines: [TOOL_KILL_RESUME_FEEDBACK] });
      resumed = true;
    } catch (error) {
      result = { success: false, sessionId, exitCode: 1, errorInfo: { message: error?.message || String(error), exitCode: 1 } };
    } finally {
      if (timer !== null) clearIntervalFn(timer);
      await heartbeat;
    }
    const exitCode = result?.exitCode ?? result?.errorInfo?.exitCode ?? (result?.success ? 0 : null);
    const reason = result?.errorInfo?.message || result?.message || result?.error || (result?.limitReached ? 'usage limit reached' : null);
    await record(result?.success ? 'completed' : 'failed', { exitCode, reason });
    await log(`Recovery attempt ${used}/${maxAttempts} ${result?.success ? 'finished successfully' : 'failed'} (exit ${exitCode ?? 'unknown'})${reason ? `: ${String(reason).slice(0, 500)}` : ''}.`);
  }
  return { toolResult: result, attemptsUsed: used, resumed, workDone: false };
}

export default { SIGKILL_EXIT_CODE, TOOL_KILL_RESUME_FEEDBACK, isToolProcessKilled, buildToolKillWarningComment, resumeAfterToolKill };
