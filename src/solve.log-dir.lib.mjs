/**
 * Apply `solve --log-dir` to the session log (issue #2625).
 *
 * solve opens its log in the working directory before it parses argv, so the
 * version and raw command are captured even when parsing fails. `--log-dir`
 * was parsed and documented but never applied afterwards, so the log always
 * stayed in the working directory. The Formal AI Draft workflow bind-mounts
 * `--log-dir` out of its container and uploads it; it found an empty directory
 * on every run, including the runs that failed before opening a pull request.
 *
 * The log is copied rather than renamed because `--log-dir` is typically a
 * Docker bind mount, where rename(2) fails with EXDEV.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2625
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';

/**
 * @param {string|undefined} logDir value of `--log-dir`
 * @param {{ getLogFile: () => string|null, setLogFile: (file: string) => void, log: (message: string, options?: object) => Promise<void> }} deps
 * @returns {Promise<string|null>} the log file in use afterwards
 */
export const moveLogFileToLogDir = async (logDir, { getLogFile, setLogFile, log }) => {
  const current = getLogFile();
  if (!logDir || !current) return current;
  const target = path.join(path.resolve(logDir), path.basename(current));
  if (target === path.resolve(current)) return current;
  try {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(current, target);
    setLogFile(target);
  } catch (error) {
    await log(`⚠️  Could not move the session log into --log-dir ${logDir} (${error.message}); it stays at ${path.resolve(current)}`, { level: 'warning' });
    return current;
  }
  await fsp.unlink(current).catch(() => {});
  await log(`📁 Log file moved to --log-dir: ${target}`);
  return target;
};
