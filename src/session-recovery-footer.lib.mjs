/** Scope terminal evidence to the current recovery attempt (#2498). */
export function scopeRecoveryFooter(readFooter, sessionInfo) {
  if (typeof readFooter !== 'function') return readFooter;
  return (logPath, options = {}) => {
    const sameLog = sessionInfo?.killRecoveryInPlace === true;
    const minByteOffset = sameLog && Number.isSafeInteger(sessionInfo?.killRecoveryLogStartBytes) ? sessionInfo.killRecoveryLogStartBytes : 0;
    const footer = readFooter(logPath, { ...options, minByteOffset });
    if (!footer?.finished || !sessionInfo?.killRecoveryResumed || (sameLog && minByteOffset > 0)) return footer;
    // Timestamp fallback also protects restored sessions created before the
    // byte boundary was persisted. The upstream footer uses local wall time.
    const started = new Date(sessionInfo.killRecoveryStartedAt || sessionInfo.startTime).getTime();
    const finished = footer.endTime ? new Date(footer.endTime).getTime() : NaN;
    if (Number.isFinite(started) && Number.isFinite(finished) && finished < started) return { finished: false, exitCode: null, endTime: null };
    return footer;
  };
}
