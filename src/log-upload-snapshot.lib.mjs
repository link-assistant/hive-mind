/**
 * Issue #4091: `/stop` must not lose the interrupted session's log.
 *
 * `/stop` sends CTRL+C through `$ --stop`; the isolation backend (start-command,
 * `docker stop`) sends SIGKILL about 10 s later. That grace period belongs to
 * start-command and cannot be set from here. In the incident the interrupt
 * handler started sanitizing the whole 114 MB log again (the first upload of the
 * same file took 34 min) and was killed after 10 s, so nothing was attached.
 *
 * The upload is now bounded and size-aware:
 *
 *  - every successful upload of a log file records how many bytes it covered
 *    (`noteUploadedLogSize`);
 *  - on interrupt, only the bytes written since that upload are attached
 *    (`prepareInterruptedLogUpload`), capped at `maxBytes` (the newest bytes
 *    win). The tail is written next to the log and uploaded as a separate file
 *    whose first line says which byte range it covers.
 *
 * The file system is injectable so tests run without touching disk.
 */

import { promises as realFs } from 'fs';

/** Default cap of an interrupted-session tail: small enough to sanitize and upload within the stop grace period. */
export const DEFAULT_INTERRUPT_TAIL_MAX_BYTES = 2 * 1024 * 1024;

const uploadedSizes = new Map();

/** Remember that `bytes` bytes of `logFile` are on GitHub. Only grows. */
export const noteUploadedLogSize = (logFile, bytes) => {
  if (!logFile || !Number.isFinite(bytes) || bytes < 0) return;
  uploadedSizes.set(logFile, Math.max(bytes, uploadedSizes.get(logFile) || 0));
};

/** Bytes of `logFile` covered by an earlier upload (0: none). */
export const getUploadedLogSize = logFile => uploadedSizes.get(logFile) || 0;

/** Tests only. */
export const resetUploadedLogSizesForTests = () => uploadedSizes.clear();

/** Size of a file, or null when it cannot be read. */
export const statLogSize = async (logFile, fs = realFs) => {
  try {
    return (await fs.stat(logFile)).size;
  } catch {
    return null;
  }
};

const mb = bytes => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Decide which part of `logFile` the interrupt handler uploads, and write it.
 *
 * @param {Object} options
 * @param {string} options.logFile
 * @param {number} [options.maxBytes]
 * @param {Object} [options.fs] - { stat, open, writeFile }
 * @returns {Promise<{ logFile: string, tail: boolean, fromByte: number, toByte: number, uploadedBefore: number, skippedBytes: number, description: string }>}
 *   `logFile` is the file to upload: the original when it is small and was never uploaded, otherwise a tail file.
 */
export const prepareInterruptedLogUpload = async ({ logFile, maxBytes = DEFAULT_INTERRUPT_TAIL_MAX_BYTES, fs = realFs } = {}) => {
  const size = await statLogSize(logFile, fs);
  const uploadedBefore = Math.min(getUploadedLogSize(logFile), size ?? 0);
  const whole = { logFile, tail: false, fromByte: 0, toByte: size ?? 0, uploadedBefore, skippedBytes: 0 };
  if (size == null || (uploadedBefore === 0 && size <= maxBytes)) return { ...whole, description: size == null ? 'the session log' : `the whole session log (${mb(size)})` };
  const fromByte = Math.max(uploadedBefore, size - maxBytes);
  const skippedBytes = fromByte - uploadedBefore;
  const length = size - fromByte;
  const buffer = Buffer.alloc(length);
  const handle = await fs.open(logFile, 'r');
  try {
    await handle.read(buffer, 0, length, fromByte);
  } finally {
    await handle.close();
  }
  const covered = uploadedBefore > 0 ? `since the last upload (bytes ${fromByte}–${size} of ${size}; the first ${mb(uploadedBefore)} were uploaded earlier)` : `the last ${mb(length)} (bytes ${fromByte}–${size} of ${size})`;
  const description = `the session log tail ${covered}${skippedBytes > 0 && uploadedBefore > 0 ? `, the oldest ${mb(skippedBytes)} of it skipped to fit the ${mb(maxBytes)} limit` : ''}`;
  const tailFile = `${logFile}.interrupted-tail.log`;
  await fs.writeFile(tailFile, Buffer.concat([Buffer.from(`[hive-mind] Interrupted session: ${description}\n`), buffer]));
  return { logFile: tailFile, tail: true, fromByte, toByte: size, uploadedBefore, skippedBytes, description };
};

export default { DEFAULT_INTERRUPT_TAIL_MAX_BYTES, noteUploadedLogSize, getUploadedLogSize, resetUploadedLogSizesForTests, statLogSize, prepareInterruptedLogUpload };
