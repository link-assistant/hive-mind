/**
 * Relaunch a kill-recovery session that solve refused to start for lack of
 * disk space (issue #2888).
 *
 * solve exits with 75 (EX_TEMPFAIL, issue #2160) when the host has less than
 * `--min-disk-space` free, before it touches the issue. A recovery session
 * that exits that way did no work, but it had already spent one of the
 * `--session-kill-resume-attempts`, and since it was not a kill nobody started
 * it again: the work stopped for good on a temporarily full disk.
 *
 * Such a session is now relaunched under the *same* attempt number once enough
 * space is free again. The number of relaunches is bounded by
 * {@link MAX_DISK_DEFERRALS} across the recovery chain, so a host whose disk
 * never frees up cannot loop.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2888
 * @see https://github.com/link-assistant/hive-mind/issues/2160
 */

import { EXIT_CODE_INSUFFICIENT_DISK_SPACE, DEFAULT_TMP_ROOT, getFreeDiskSpaceMB } from './disk-guard.lib.mjs';
import { formatGiB, waitForSnapshotDiskHeadroom } from './kill-recovery-snapshot-guard.lib.mjs';
import { argvFromSessionArgs } from './session-monitor.kill-sections.lib.mjs';
import { readResumeId } from './session-kill-resume.fresh-session.lib.mjs';
import { readLastSessionIdFromLog } from './session-resume.lib.mjs';

/** Field counting the disk-refused relaunches of one recovery chain. */
export const KILL_RECOVERY_DISK_DEFERRALS_FIELD = 'killRecoveryDiskDeferrals';

/** Relaunches allowed per recovery chain. */
export const MAX_DISK_DEFERRALS = 6;

/** How long one relaunch waits for the space to come back. */
export const DISK_RETRY_WAIT_MS = 30 * 60 * 1000;

/** How often the free space is measured meanwhile. */
export const DISK_RETRY_POLL_MS = 60 * 1000;

/** solve's own `--min-disk-space` default (MB). */
const DEFAULT_MIN_DISK_SPACE_MB = 10240;

const MB = 1024 * 1024;

/** True when a kill-recovery session ended because solve refused to start for disk space. */
export function isDiskRefusedRecovery({ sessionInfo, exitCode }) {
  return Number(exitCode) === EXIT_CODE_INSUFFICIENT_DISK_SPACE && sessionInfo?.killRecoveryResumed === true && !sessionInfo?.stopRequestedByUser && !sessionInfo?.killRecoverySessionId;
}

/** The free space (bytes) solve asks for: its `--min-disk-space`, in MB. */
export function requiredDiskBytes(sessionInfo) {
  const argv = argvFromSessionArgs(sessionInfo?.args);
  const value = Number(argv['min-disk-space'] ?? argv.minDiskSpace);
  return (Number.isFinite(value) && value > 0 ? value : DEFAULT_MIN_DISK_SPACE_MB) * MB;
}

/**
 * Free bytes where the next task will run: the Docker data root for Docker
 * tasks, `/tmp` otherwise. Null when unknown.
 */
export async function measureRecoveryFreeBytes({ sessionInfo, runner, verbose = false, getFreeMB = getFreeDiskSpaceMB }) {
  if (sessionInfo?.isolationBackend === 'docker' && typeof runner?.checkDockerDiskSpace === 'function') {
    const disk = await Promise.resolve(runner.checkDockerDiskSpace(verbose)).catch(() => null);
    if (Number.isFinite(disk?.availableGiB)) return disk.availableGiB * 1024 * MB;
  }
  const freeMB = await Promise.resolve(getFreeMB(DEFAULT_TMP_ROOT)).catch(() => null);
  return Number.isFinite(freeMB) ? freeMB * MB : null;
}

/**
 * Relaunch the disk-refused recovery session `sessionName` once space is free.
 * `recover` is `recoverKilledSession` (injected to avoid an import cycle);
 * `measureFree`, `diskSleep` and `diskNow` replace the disk wait in tests.
 *
 * @returns {Promise<Object>} recoverKilledSession()'s result, plus `diskDeferrals`
 */
export async function relaunchDiskRefusedRecovery({ sessionName, sessionInfo, runner, onLifecycle = async () => {}, recover, readLastSessionId = readLastSessionIdFromLog, measureFree = null, diskSleep = null, diskNow = null, waitMs = DISK_RETRY_WAIT_MS, pollMs = DISK_RETRY_POLL_MS, verbose = false, ...options }) {
  const attempt = Number.isFinite(sessionInfo?.killRecoveryAttempts) ? sessionInfo.killRecoveryAttempts : 1;
  const deferrals = Number.isFinite(sessionInfo?.[KILL_RECOVERY_DISK_DEFERRALS_FIELD]) ? sessionInfo[KILL_RECOVERY_DISK_DEFERRALS_FIELD] : 0;
  const notify = event => Promise.resolve(onLifecycle(event)).catch(() => {});
  const giveUp = (reason, detail) => {
    console.warn(`[session-kill-resume] ${sessionName}: ${detail}`);
    return notify({ phase: 'failed', attempt, reason: detail }).then(() => ({ resumed: false, reason, policy: null, sessionId: null, display: null, attempt, maxAttempts: 0, inPlace: false, diskDeferrals: deferrals }));
  };
  if (deferrals >= MAX_DISK_DEFERRALS) return giveUp('disk-deferrals-exhausted', `The recovery session was refused for lack of disk space ${deferrals} times; not relaunching it again (issue #2888).`);

  const required = requiredDiskBytes(sessionInfo);
  const measure = async () => ({ writableBytes: 0, reserveBytes: required, availableBytes: measureFree ? await measureFree() : await measureRecoveryFreeBytes({ sessionInfo, runner, verbose }) });
  let told = false;
  const headroom = await waitForSnapshotDiskHeadroom({
    measure,
    onWaiting: async evaluation => {
      if (told) return;
      told = true;
      await notify({ phase: 'waiting', attempt, reason: `The recovery session stopped before starting work: not enough disk space (${formatGiB(evaluation.availableBytes)} free, ${formatGiB(required)} needed). It will be relaunched as attempt ${attempt} once the space is free (issue #2888).` });
    },
    waitMs,
    pollMs,
    ...(diskSleep ? { sleep: diskSleep } : {}),
    ...(diskNow ? { now: diskNow } : {}),
  });
  if (!headroom.ok) return giveUp('disk-still-full', `Disk space did not free up within ${Math.round(waitMs / 60000)} minutes (${formatGiB(headroom.evaluation.availableBytes)} free, ${formatGiB(required)} needed); the recovery session was not relaunched (issue #2888).`);

  // Same attempt: the refused run did no work. The counter is put back on the
  // new session by startKillRecoverySession(), or restored here on failure.
  sessionInfo.killRecoveryAttempts = attempt - 1;
  sessionInfo[KILL_RECOVERY_DISK_DEFERRALS_FIELD] = deferrals + 1;
  // A fresh run that was refused wrote no tool session id; it is in its own args.
  const ownResumeId = readResumeId(sessionInfo?.args);
  const readId = logPath => readLastSessionId(logPath) || ownResumeId;
  if (verbose) console.log(`[VERBOSE] Session ${sessionName} exited ${EXIT_CODE_INSUFFICIENT_DISK_SPACE} (not enough disk); relaunching recovery attempt ${attempt} (disk deferral ${deferrals + 1}/${MAX_DISK_DEFERRALS})`);
  const result = await recover({ ...options, sessionName, sessionInfo, runner, onLifecycle, killed: true, readLastSessionId: readId, verbose });
  if (!result?.resumed) {
    sessionInfo.killRecoveryAttempts = attempt;
    sessionInfo[KILL_RECOVERY_DISK_DEFERRALS_FIELD] = deferrals;
  }
  return { ...result, diskDeferrals: deferrals + 1 };
}
