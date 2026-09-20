#!/usr/bin/env node

/**
 * Session log renaming (Issue #2160)
 *
 * When an AI tool reports its session id, the run log is renamed to `<sessionId>.log` so that
 * the log file can be correlated with the tool session. The logic used to live inline in
 * src/claude.lib.mjs and depended on `getLogFile`/`setLogFile` being forwarded through every
 * caller. Restart/watch iterations (src/solve.restart-shared.lib.mjs) either omitted those
 * parameters or passed no-op stubs, which produced this on every restart iteration:
 *
 *   ⚠️ Could not rename log file: getLogFile is not a function
 *
 * Extracting the logic makes the failure mode explicit (a named reason instead of a TypeError)
 * and testable.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2160
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Rename the current log file to `<sessionId>.log`.
 *
 * Never throws: every failure is returned as `{ ok: false, reason }` so callers can log it.
 *
 * @param {Object} params
 * @param {string} params.sessionId - Session id reported by the AI tool
 * @param {Function} params.getLogFile - Accessor returning the current log file path
 * @param {Function} params.setLogFile - Accessor updating the current log file path
 * @param {Function} [params.log] - Async logger
 * @param {Object} [params.fileSystem] - Injectable fs.promises replacement (tests)
 * @returns {Promise<{ok: boolean, reason?: string, error?: Error, sessionLogFile?: string}>}
 */
export const renameLogToSessionId = async ({ sessionId, getLogFile, setLogFile, log, fileSystem = fs }) => {
  if (!sessionId) return { ok: false, reason: 'missing_session_id' };
  if (typeof getLogFile !== 'function' || typeof setLogFile !== 'function') {
    // Issue #2160: a caller that forgot to forward the accessors. Report it as a real defect
    // instead of surfacing "getLogFile is not a function" as a mysterious warning.
    if (log) await log('⚠️ Could not rename log file: log file accessors were not provided by the caller', { verbose: true });
    return { ok: false, reason: 'missing_log_file_accessors' };
  }

  const currentLogFile = getLogFile();
  if (!currentLogFile) {
    if (log) await log('⚠️ Could not rename log file: no current log file is configured', { verbose: true });
    return { ok: false, reason: 'no_current_log_file' };
  }

  const sessionLogFile = path.join(path.dirname(currentLogFile), `${sessionId}.log`);
  if (sessionLogFile === currentLogFile) return { ok: true, reason: 'already_named', sessionLogFile };

  try {
    await fileSystem.rename(currentLogFile, sessionLogFile);
    setLogFile(sessionLogFile);
    if (log) await log(`📁 Log renamed to: ${sessionLogFile}`);
    return { ok: true, sessionLogFile };
  } catch (error) {
    if (log) await log(`⚠️ Could not rename log file: ${error.message}`, { verbose: true });
    return { ok: false, reason: 'rename_failed', error, sessionLogFile };
  }
};

export default { renameLogToSessionId };
