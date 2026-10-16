/**
 * Relaunch an in-place kill recovery whose command never started (issue #2887).
 *
 * In the router#728 incident the `$ --resume … -- /codex …` container exited
 * 127 (`sh: 1: /codex: not found`). The resume command now runs `solve`, and a
 * 126/127 exit within the startup window already falls back to a fresh launch
 * (`checkResumedDockerStartup`). A 126/127 noticed only at completion (after
 * that window, or after a bot restart between the launch and the check) was
 * still an ordinary `failed` exit, not a kill, so nothing recovered the killed
 * work: the session was dropped.
 *
 * Such a session did no work. It is relaunched through the fresh-launch path,
 * which runs the real argv in a new container, under the *same* attempt
 * number. Only an in-place recovery qualifies, so a fresh relaunch that exits
 * 127 too is reported and not retried: this cannot loop.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2887
 */

import { describeCommandStartFailure } from './session-status.lib.mjs';
import { readResumeId } from './session-kill-resume.fresh-session.lib.mjs';
import { readLastSessionIdFromLog } from './session-resume.lib.mjs';

/**
 * The start failure of a finished in-place recovery session, or null.
 *
 * @param {Object} options
 * @param {Object|null} options.sessionInfo - The finished session's info
 * @param {number|string|null} options.exitCode - Its own exit code
 * @returns {{exitCode: number, reason: string, description: string}|null}
 */
export function detectFailedInPlaceStart({ sessionInfo = null, exitCode = null } = {}) {
  if (sessionInfo?.killRecoveryResumed !== true || sessionInfo?.killRecoveryInPlace !== true) return null;
  if (sessionInfo?.stopRequestedByUser === true || sessionInfo?.killRecoverySessionId) return null;
  return describeCommandStartFailure(exitCode);
}

/**
 * Start a fresh recovery for the in-place session `sessionName` that exited
 * with `failure`. `recover` is `recoverKilledSession` (injected to avoid an
 * import cycle).
 *
 * @returns {Promise<Object>} recoverKilledSession()'s result
 */
export async function relaunchFailedInPlaceStart({ sessionName, sessionInfo, failure, recover, readLastSessionId = readLastSessionIdFromLog, verbose = false, ...options }) {
  const attempt = Number.isFinite(sessionInfo?.killRecoveryAttempts) ? sessionInfo.killRecoveryAttempts : 1;
  // Same attempt: the failed start did no work. The counter is put back on the
  // new session by startKillRecoverySession(), or restored here on failure.
  sessionInfo.killRecoveryAttempts = attempt - 1;
  // The in-place session shares the killed one's log; when no `Session ID:`
  // can be read from it, the id that attempt was started with is the same one.
  const ownResumeId = readResumeId(sessionInfo?.args);
  // readLastSessionIdFromLog is async (#3278): await it, or `||` sees a Promise and never falls back.
  const readId = async (logPath, readOptions) => (await readLastSessionId(logPath, readOptions)) || ownResumeId;
  const reason = `The recovery session ${sessionName} exited with code ${failure.exitCode} (${failure.description}) without running its command; starting a fresh isolated session (issue #2887).`;
  console.warn(`[session-kill-resume] ${reason}`);
  if (verbose) console.log(`[VERBOSE] ${reason} Attempt ${attempt} is reused; resume id from args: ${ownResumeId || 'none'}`);
  const result = await recover({ ...options, sessionName, sessionInfo, killed: true, readLastSessionId: readId, skipInPlace: reason, verbose });
  if (!result?.resumed) sessionInfo.killRecoveryAttempts = attempt;
  return result;
}
