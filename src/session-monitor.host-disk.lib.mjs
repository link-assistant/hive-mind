/**
 * Issue #2303: remember how full the host disk got while a session ran.
 *
 * The kill diagnosis used to see the disk only through the `📈 [RESOURCES]`
 * markers `solve` writes into its own log. Those are written at phase
 * boundaries, so the last one before a disk-full kill can be an hour old (78.9%
 * used in the incident) — and once start-command's watcher removed the
 * container, the 122.7 GB writable layer was freed, so a reading taken at
 * completion time shows a healthy disk too. The only moment the disk is
 * visibly full is *while* the session is running.
 *
 * The monitor therefore samples the filesystem that holds the session log on
 * every tick (one `statfs` syscall) and keeps the lowest free-space reading it
 * saw. That is the filesystem the watcher failed to write when it hit ENOSPC.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2303
 */

import fsPromises from 'fs/promises';
import path from 'path';

export const HOST_DISK_MIN_AVAILABLE_FIELD = 'hostDiskMinAvailableBytes';
export const HOST_DISK_TOTAL_FIELD = 'hostDiskTotalBytes';
export const HOST_DISK_MIN_AVAILABLE_AT_FIELD = 'hostDiskMinAvailableAt';
export const HOST_DISK_PATH_FIELD = 'hostDiskPath';

/** A new minimum is worth persisting once it dropped this share of the disk. */
const SIGNIFICANT_DROP_RATIO = 0.01;

/**
 * Directory whose filesystem is sampled: the one that holds the session log,
 * falling back to the root filesystem.
 *
 * @param {Object|null} sessionInfo
 * @param {Object|null} [statusResult]
 * @returns {string}
 */
export function resolveHostDiskPath(sessionInfo, statusResult = null) {
  const logPath = statusResult?.logPath || sessionInfo?.logPath || null;
  return logPath ? path.dirname(logPath) : '/';
}

/**
 * Sample the host disk and keep the lowest free-space reading on sessionInfo.
 * Never throws.
 *
 * @param {Object} sessionInfo - Mutated with the host disk fields
 * @param {Object} [options]
 * @param {Object|null} [options.statusResult]
 * @param {Function} [options.statfs] - `fs.promises.statfs`-compatible (injectable for tests)
 * @param {Date} [options.now]
 * @param {boolean} [options.verbose]
 * @returns {Promise<{availableBytes: number, totalBytes: number, changed: boolean, significant: boolean}|null>}
 */
export async function observeHostDiskForSession(sessionInfo, { statusResult = null, statfs = fsPromises.statfs, now = new Date(), verbose = false } = {}) {
  if (!sessionInfo || typeof statfs !== 'function') return null;
  const target = resolveHostDiskPath(sessionInfo, statusResult);
  try {
    const stats = await statfs(target);
    const blockSize = Number(stats?.bsize);
    const availableBytes = Math.round(Number(stats?.bavail) * blockSize);
    const totalBytes = Math.round(Number(stats?.blocks) * blockSize);
    if (!Number.isFinite(availableBytes) || !Number.isFinite(totalBytes) || totalBytes <= 0) return null;
    const previous = sessionInfo[HOST_DISK_MIN_AVAILABLE_FIELD];
    const changed = !Number.isFinite(previous) || availableBytes < previous;
    // Persist the first reading and real drops, not every few-kilobyte wobble.
    const significant = changed && (!Number.isFinite(previous) || previous - availableBytes >= totalBytes * SIGNIFICANT_DROP_RATIO);
    if (changed) {
      sessionInfo[HOST_DISK_MIN_AVAILABLE_FIELD] = availableBytes;
      sessionInfo[HOST_DISK_TOTAL_FIELD] = totalBytes;
      sessionInfo[HOST_DISK_MIN_AVAILABLE_AT_FIELD] = now.toISOString();
      sessionInfo[HOST_DISK_PATH_FIELD] = target;
    }
    if (verbose) {
      console.log(`[VERBOSE] host disk ${target}: ${availableBytes} of ${totalBytes} bytes free (session minimum ${sessionInfo[HOST_DISK_MIN_AVAILABLE_FIELD]} at ${sessionInfo[HOST_DISK_MIN_AVAILABLE_AT_FIELD]})`);
    }
    return { availableBytes, totalBytes, changed, significant };
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] host disk ${target}: statfs failed: ${error?.message || error}`);
    return null;
  }
}

/**
 * The lowest host disk reading of a session, in the shape the kill diagnosis
 * uses for disk markers.
 *
 * @param {Object|null} sessionInfo
 * @returns {{availableBytes: number, totalBytes: number, usedPercent: number, observedAt: string|null, path: string}|null}
 */
export function describeObservedHostDisk(sessionInfo) {
  const availableBytes = sessionInfo?.[HOST_DISK_MIN_AVAILABLE_FIELD];
  const totalBytes = sessionInfo?.[HOST_DISK_TOTAL_FIELD];
  if (!Number.isFinite(availableBytes) || !Number.isFinite(totalBytes) || totalBytes <= 0) return null;
  const usedPercent = Math.min(100, Math.max(0, ((totalBytes - availableBytes) / totalBytes) * 100));
  return { availableBytes, totalBytes, usedPercent, observedAt: sessionInfo?.[HOST_DISK_MIN_AVAILABLE_AT_FIELD] || null, path: sessionInfo?.[HOST_DISK_PATH_FIELD] || '/' };
}
