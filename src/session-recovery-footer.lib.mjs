/** Scope terminal evidence to the current recovery attempt (#2498). */
export function scopeRecoveryFooter(readFooter, sessionInfo) {
  if (typeof readFooter !== 'function') return readFooter;
  return (logPath, options = {}) => {
    const sameLog = sessionInfo?.killRecoveryInPlace === true;
    const minByteOffset = sameLog && Number.isSafeInteger(sessionInfo?.killRecoveryLogStartBytes) ? sessionInfo.killRecoveryLogStartBytes : 0;
    const footer = readFooter(logPath, { ...options, minByteOffset });
    // Issue #2917: a session that followed (or was adopted from) an operator `$ --resume` is scoped by that container's start — later than any byte boundary an earlier recovery recorded.
    const attemptStartedAt = sessionInfo?.attemptStartedAt || (sessionInfo?.killRecoveryResumed ? sessionInfo.killRecoveryStartedAt || sessionInfo.startTime : null);
    if (!footer?.finished || !attemptStartedAt || (sameLog && minByteOffset > 0 && !sessionInfo?.attemptStartedAt)) return footer;
    // Timestamp fallback also protects restored sessions created before the
    // byte boundary was persisted. The upstream footer uses local wall time.
    const started = new Date(attemptStartedAt).getTime();
    const finished = footer.endTime ? new Date(footer.endTime).getTime() : NaN;
    if (Number.isFinite(started) && Number.isFinite(finished) && finished < started) return { finished: false, exitCode: null, endTime: null };
    return footer;
  };
}
