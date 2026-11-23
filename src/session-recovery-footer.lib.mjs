/** Scope terminal evidence to the current attempt, including retained resumes. */
export function scopeRecoveryFooter(readFooter, sessionInfo) {
  if (typeof readFooter !== 'function') return readFooter;
  return async (logPath, options = {}) => {
    const sameLog = sessionInfo?.killRecoveryInPlace === true;
    const explicitResume = sessionInfo?.explicitResumeLogStartBytes !== undefined;
    const offset = explicitResume ? sessionInfo.explicitResumeLogStartBytes : sameLog && sessionInfo?.killRecoveryLogStartBytes;
    const minByteOffset = Number.isSafeInteger(offset) && offset > 0 ? offset : 0;
    const footer = await readFooter(logPath, { ...options, minByteOffset });
    if (!footer?.finished || minByteOffset > 0 || (!sessionInfo?.killRecoveryResumed && !explicitResume)) return footer;
    // Timestamp fallback also protects restored sessions created before the
    // byte boundary was persisted. The upstream footer uses local wall time.
    const started = new Date((!explicitResume && sessionInfo.killRecoveryStartedAt) || sessionInfo.startTime).getTime();
    const finished = footer.endTime ? new Date(footer.endTime).getTime() : NaN;
    if (Number.isFinite(started) && Number.isFinite(finished) && finished < started) return { finished: false, exitCode: null, endTime: null };
    return footer;
  };
}
