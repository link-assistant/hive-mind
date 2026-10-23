/**
 * Whether the recovery attempt writes on into the killed attempt's log: an
 * in-place resume, or a fresh container appended to the same execution
 * (start#229, issue #3530).
 */
export const sharesRecoveryLog = sessionInfo => sessionInfo?.killRecoveryInPlace === true || sessionInfo?.killRecoveryAppendedAttempt === true;

/** Byte offset where the current recovery attempt starts in its log (0 for its own log). */
export const recoveryLogStartOffset = sessionInfo => (sharesRecoveryLog(sessionInfo) && Number.isSafeInteger(sessionInfo?.killRecoveryLogStartBytes) ? sessionInfo.killRecoveryLogStartBytes : 0);

/** Scope terminal evidence to the current recovery attempt (#2498). */
export function scopeRecoveryFooter(readFooter, sessionInfo) {
  if (typeof readFooter !== 'function') return readFooter;
  return async (logPath, options = {}) => {
    const sameLog = sharesRecoveryLog(sessionInfo);
    const minByteOffset = recoveryLogStartOffset(sessionInfo);
    const footer = await readFooter(logPath, { ...options, minByteOffset });
    if (!footer?.finished || !sessionInfo?.killRecoveryResumed || (sameLog && minByteOffset > 0)) return footer;
    // Timestamp fallback also protects restored sessions created before the
    // byte boundary was persisted. The upstream footer uses local wall time.
    const started = new Date(sessionInfo.killRecoveryStartedAt || sessionInfo.startTime).getTime();
    const finished = footer.endTime ? new Date(footer.endTime).getTime() : NaN;
    if (Number.isFinite(started) && Number.isFinite(finished) && finished < started) return { finished: false, exitCode: null, endTime: null };
    return footer;
  };
}
