/**
 * Determines whether a stderr message line should be treated as an error.
 *
 * Excludes:
 * - Emoji-prefixed warnings (Issue #477): lines starting with ⚠️ or ⚠
 * - JSON-structured log messages with non-error level (Issue #1337):
 *   e.g. {"level":"warn","message":"...failed..."} — the word "failed" is in
 *   the message text but the level is "warn", so it is NOT an error.
 *   Only JSON lines with level "error" or "fatal" are treated as real errors.
 *
 * @param {string} message - A single trimmed stderr line
 * @returns {boolean} true if the line should count as an error
 */
export const isStderrError = message => {
  const trimmed = message.trim();
  if (!trimmed) return false;
  // Detection 1: Emoji-prefixed warnings (Issue #477)
  let isWarning = trimmed.startsWith('⚠️') || trimmed.startsWith('⚠');
  // Detection 2: JSON-structured log messages (Issue #1337)
  if (!isWarning && trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed.level === 'string') {
        const level = parsed.level.toLowerCase();
        // Only "error" and "fatal" levels are real errors.
        if (level !== 'error' && level !== 'fatal') {
          isWarning = true;
        }
      }
    } catch {
      // Not valid JSON — fall through to keyword matching
    }
  }
  if (!isWarning && (trimmed.includes('Error:') || trimmed.includes('error') || trimmed.includes('failed') || trimmed.includes('not found'))) {
    return true;
  }
  return false;
};
