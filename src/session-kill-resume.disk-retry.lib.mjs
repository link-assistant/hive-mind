/**
 * A recovery session that the disk preflight refused is not a recovery attempt
 * (issue #2888).
 *
 * `solve` exits with 75 (EX_TEMPFAIL, `EXIT_CODE_INSUFFICIENT_DISK_SPACE`) when
 * the host has less free disk than `--min-disk-space` — "the issue itself was
 * not attempted". After the 2026-10-09 OOM incident the fresh recovery of
 * router#725 hit exactly that (10215MB available, 10240MB required) and still
 * used up attempt 1/3, and nothing ever started it again.
 *
 * Such a session is started again with the *same* attempt number once space
 * frees up: the wait before the relaunch polls free disk space and ends early
 * when there is enough. The number of disk-refused relaunches per attempt is
 * bounded separately, so a host that never frees space cannot loop forever.
 * A refused fresh run left nothing behind, so it is relaunched fresh; a refused
 * in-place resume goes back into the original container as before.
 *
 * Configuration:
 *   - `HIVE_MIND_SESSION_KILL_DISK_RETRIES` — relaunches per attempt (default 6, 0 = off)
 *   - `HIVE_MIND_SESSION_KILL_DISK_RETRY_DELAY` — longest wait in seconds (default 300)
 *   - `HIVE_MIND_SESSION_KILL_DISK_RETRY_PATH` — filesystem polled for free space (default /tmp)
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2888
 */

import { DEFAULT_TMP_ROOT, EXIT_CODE_INSUFFICIENT_DISK_SPACE, getFreeDiskSpaceMB } from './disk-guard.lib.mjs';
import { t } from './i18n.lib.mjs';
import { ON_SESSION_KILL_RESUME, resolveOnSessionKillPolicy, resolveSessionKillResumeAttempts } from './session-kill-policy.lib.mjs';
import { argvFromSessionArgs } from './session-monitor.kill-sections.lib.mjs';
import { quoteArg } from './session-resume.lib.mjs';

/** Field counting the disk-refused relaunches of the current recovery attempt. */
export const KILL_RECOVERY_DISK_DEFERRALS_FIELD = 'killRecoveryDiskDeferrals';
export const SESSION_KILL_DISK_RETRIES_ENV_VAR = 'HIVE_MIND_SESSION_KILL_DISK_RETRIES';
export const SESSION_KILL_DISK_RETRY_DELAY_ENV_VAR = 'HIVE_MIND_SESSION_KILL_DISK_RETRY_DELAY';
export const SESSION_KILL_DISK_RETRY_PATH_ENV_VAR = 'HIVE_MIND_SESSION_KILL_DISK_RETRY_PATH';
export const DEFAULT_SESSION_KILL_DISK_RETRIES = 6;
export const DEFAULT_SESSION_KILL_DISK_RETRY_DELAY_SECONDS = 300;
/** How often the wait re-reads free disk space. */
export const DISK_RETRY_POLL_MS = 30_000;
/** solve's own `--min-disk-space` default. */
const DEFAULT_MIN_DISK_SPACE_MB = 10240;

const nonNegativeInteger = (raw, fallback) => {
  const text = String(raw ?? '').trim();
  if (!/^\d+$/u.test(text)) return fallback;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : fallback;
};

/** Settings for disk-refused relaunches, from the environment. */
export function resolveDiskRetrySettings({ env = process.env } = {}) {
  const delaySeconds = Math.min(nonNegativeInteger(env?.[SESSION_KILL_DISK_RETRY_DELAY_ENV_VAR], DEFAULT_SESSION_KILL_DISK_RETRY_DELAY_SECONDS), 2_147_483);
  return {
    maxDeferrals: nonNegativeInteger(env?.[SESSION_KILL_DISK_RETRIES_ENV_VAR], DEFAULT_SESSION_KILL_DISK_RETRIES),
    delayMs: delaySeconds * 1000,
    diskPath: String(env?.[SESSION_KILL_DISK_RETRY_PATH_ENV_VAR] || '').trim() || DEFAULT_TMP_ROOT,
  };
}

/** True when this completion is a recovery session that solve's disk preflight refused. */
export function isDiskRefusedRecovery({ sessionInfo = null, exitCode = null } = {}) {
  return exitCode === EXIT_CODE_INSUFFICIENT_DISK_SPACE && sessionInfo?.killRecoveryResumed === true;
}

/**
 * Decide whether a disk-refused recovery session is started again. Pure.
 *
 * @returns {{shouldResume: boolean, reason: string, policy: string, command: Object|null, attempt: number, maxAttempts: number, diskDeferral: number, maxDiskDeferrals: number, delayMs: number, requiredMB: number, diskPath: string, skipInPlace: boolean}}
 */
export function planDiskRefusedRelaunch({ sessionInfo = {}, exitCode = null, env = process.env, verbose = false } = {}) {
  const argv = argvFromSessionArgs(sessionInfo?.args);
  const policy = resolveOnSessionKillPolicy({ argv, env, sessionInfo, verbose });
  const { maxDeferrals, delayMs, diskPath } = resolveDiskRetrySettings({ env });
  const deferrals = Number.isFinite(sessionInfo?.[KILL_RECOVERY_DISK_DEFERRALS_FIELD]) ? sessionInfo[KILL_RECOVERY_DISK_DEFERRALS_FIELD] : 0;
  const attempt = Number.isFinite(sessionInfo?.killRecoveryAttempts) ? sessionInfo.killRecoveryAttempts : 1;
  const requiredMB = Number(argv?.minDiskSpace ?? argv?.['min-disk-space']) > 0 ? Number(argv.minDiskSpace ?? argv['min-disk-space']) : DEFAULT_MIN_DISK_SPACE_MB;
  const args = Array.isArray(sessionInfo?.args) ? sessionInfo.args.map(String) : [];
  const binary = sessionInfo?.command || 'solve';
  const plan = { shouldResume: false, policy, command: null, attempt, maxAttempts: resolveSessionKillResumeAttempts({ argv, env }), diskDeferral: deferrals, maxDiskDeferrals: maxDeferrals, delayMs, requiredMB, diskPath, skipInPlace: sessionInfo?.killRecoveryInPlace !== true };
  if (!isDiskRefusedRecovery({ sessionInfo, exitCode })) return { ...plan, reason: 'not-disk-refused' };
  if (policy !== ON_SESSION_KILL_RESUME) return { ...plan, reason: 'policy-report' };
  if (sessionInfo?.stopRequestedByUser === true) return { ...plan, reason: 'stopped-by-user' };
  if (args.length === 0) return { ...plan, reason: 'no-command' };
  if (deferrals >= maxDeferrals) return { ...plan, reason: 'disk-retries-exhausted' };
  return { ...plan, shouldResume: true, reason: 'disk-refused', diskDeferral: deferrals + 1, command: { binary, args, display: `${binary} ${args.map(quoteArg).join(' ')}` } };
}

/**
 * Wait up to `ms`, ending early once `diskPath` has `requiredMB` free. An
 * unreadable `df` waits the full time; solve's own preflight decides after it.
 */
export function createDiskSpaceWait({ requiredMB, diskPath = DEFAULT_TMP_ROOT, pollMs = DISK_RETRY_POLL_MS, getFreeMB = getFreeDiskSpaceMB, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, log = () => {} } = {}) {
  return async ms => {
    const deadline = now() + ms;
    for (;;) {
      const freeMB = await getFreeMB(diskPath);
      if (Number.isFinite(freeMB) && freeMB >= requiredMB) {
        log(`${freeMB}MB free on ${diskPath} (${requiredMB}MB required) — relaunching now`);
        return { freeMB, enough: true };
      }
      const left = deadline - now();
      if (left <= 0) {
        log(`${Number.isFinite(freeMB) ? `${freeMB}MB` : 'unknown'} free on ${diskPath} (${requiredMB}MB required) after waiting — relaunching and letting solve's preflight decide`);
        return { freeMB: Number.isFinite(freeMB) ? freeMB : null, enough: false };
      }
      await sleep(Math.min(pollMs, left));
    }
  };
}

const localized = (locale, key, fallback, params) => (locale ? t(key, params, { locale }) : fallback);

/** The Telegram section describing a disk-refused relaunch (or why there is none). */
export function formatDiskRefusedRecoverySection({ recovery, locale = null } = {}) {
  if (!recovery || recovery.reason === 'not-disk-refused') return '';
  const attempt = `${recovery.attempt}/${recovery.maxAttempts}`;
  const retry = `${recovery.diskDeferral}/${recovery.maxDiskDeferrals}`;
  if (recovery.resumed && recovery.sessionId) {
    return localized(locale, 'telegram.session_kill_disk_relaunched', `💾 The recovery session could not start: too little free disk space (exit 75), so nothing was attempted. That does not count as a recovery attempt; it was started again once space allowed (attempt ${attempt}, disk retry ${retry}): ${recovery.sessionId}`, { attempt, retry, sessionId: recovery.sessionId });
  }
  if (recovery.reason === 'disk-retries-exhausted') {
    return localized(locale, 'telegram.session_kill_disk_retries_exhausted', `💾 The recovery session could not start: too little free disk space (exit 75). It was not started again: all ${recovery.maxDiskDeferrals} disk retries were used. Free disk space and restart the task.`, { max: String(recovery.maxDiskDeferrals) });
  }
  return '';
}
