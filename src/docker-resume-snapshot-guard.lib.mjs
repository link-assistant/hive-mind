/**
 * Guard for the in-place resumes that still need a container snapshot (issue #2889).
 *
 * New task containers are resumed with `docker start` and a command handoff
 * (see `./docker-resume-handoff.lib.mjs`), which copies nothing. A container
 * created before that handoff existed can only take a new command through
 * start-command's `docker-snapshot` mode: `docker commit` of the whole
 * writable layer, then a new container from that image. On the containerd
 * image store the commit writes a compressed blob *and* an unpacked snapshot,
 * so for a while the disk holds the writable layer about three times over.
 * In the incident several such commits of 25-45 GB layers ran at once, with
 * nothing checking free space first, and the disk filled.
 *
 * Two rules apply to every snapshot resume, in this order:
 *
 *   1. **One at a time.** Snapshots are queued in-process; the others wait,
 *      and say so in the recovery status.
 *   2. **Headroom first.** The free space on the Docker data root must cover
 *      twice the writable layer (blob + unpacked snapshot; the original is
 *      already on disk) plus a reserve for the tasks that keep running. While
 *      it does not, the recovery reports "waiting for disk" and re-checks; if
 *      the space never appears it falls back to a fresh launch rather than
 *      fill the disk.
 *
 * Dropping regenerable caches (`target/`, `node_modules/.cache`) before the
 * commit is not possible here: the container is stopped, and starting it to
 * delete files would re-run its command. The handoff path avoids the copy
 * altogether, which is the real fix; this guard only bounds the legacy path.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2889
 */

const GIB = 1024 ** 3;

/** Free space needed per writable-layer byte: commit blob + unpacked snapshot. */
export const SNAPSHOT_DISK_HEADROOM_FACTOR = 2;
/** Free space that must remain for the tasks that keep running. */
export const SNAPSHOT_DISK_RESERVE_BYTES = 10 * GIB;
/** How long a snapshot waits for disk before the fresh-launch fallback. */
export const SNAPSHOT_DISK_WAIT_MS = 10 * 60 * 1000;
/** Re-check interval while waiting for disk. */
export const SNAPSHOT_DISK_POLL_MS = 30 * 1000;

/** `12.3 GiB` — the unit the recovery status and logs use. */
export function formatGiB(bytes) {
  return Number.isFinite(bytes) ? `${(bytes / GIB).toFixed(1)} GiB` : 'unknown';
}

/**
 * Whether the Docker data root can take a snapshot of a writable layer.
 * Unknown measurements do not block (the previous behaviour), but are reported.
 *
 * @param {Object} options
 * @param {number|null} options.writableBytes - `docker inspect --size` `.SizeRw`
 * @param {number|null} options.availableBytes - Free bytes on the Docker data root
 * @param {number} [options.factor]
 * @param {number} [options.reserveBytes]
 * @returns {{known: boolean, ok: boolean, writableBytes: number|null, availableBytes: number|null, requiredBytes: number|null}}
 */
export function evaluateSnapshotDiskHeadroom({ writableBytes = null, availableBytes = null, factor = SNAPSHOT_DISK_HEADROOM_FACTOR, reserveBytes = SNAPSHOT_DISK_RESERVE_BYTES } = {}) {
  const writable = Number.isFinite(writableBytes) && writableBytes >= 0 ? writableBytes : null;
  const available = Number.isFinite(availableBytes) && availableBytes >= 0 ? availableBytes : null;
  if (writable === null || available === null) return { known: false, ok: true, writableBytes: writable, availableBytes: available, requiredBytes: null };
  const requiredBytes = Math.ceil(writable * factor + reserveBytes);
  return { known: true, ok: available >= requiredBytes, writableBytes: writable, availableBytes: available, requiredBytes };
}

/** Recovery status line while a snapshot waits for disk. */
export function formatSnapshotDiskWait(evaluation) {
  return `Waiting for disk: ${formatGiB(evaluation.availableBytes)} free on the Docker data root, ${formatGiB(evaluation.requiredBytes)} needed to snapshot this ${formatGiB(evaluation.writableBytes)} container safely.`;
}

/**
 * Re-measure until the snapshot fits or the wait runs out.
 *
 * @param {Object} options
 * @param {Function} options.measure - async () => ({writableBytes, availableBytes})
 * @param {Function} [options.onWaiting] - async (evaluation) => void, once per failed check
 * @param {Function} [options.sleep]
 * @param {Function} [options.now]
 * @param {number} [options.waitMs]
 * @param {number} [options.pollMs]
 * @returns {Promise<{ok: boolean, waitedMs: number, evaluation: Object}>}
 */
export async function waitForSnapshotDiskHeadroom({ measure, onWaiting = async () => {}, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, waitMs = SNAPSHOT_DISK_WAIT_MS, pollMs = SNAPSHOT_DISK_POLL_MS } = {}) {
  const startedAt = now();
  for (;;) {
    const measured = (await measure()) || {};
    const evaluation = evaluateSnapshotDiskHeadroom(measured);
    const waitedMs = now() - startedAt;
    if (evaluation.ok) return { ok: true, waitedMs, evaluation };
    if (waitedMs >= waitMs) return { ok: false, waitedMs, evaluation };
    await onWaiting(evaluation);
    await sleep(Math.min(pollMs, Math.max(0, waitMs - waitedMs)));
  }
}

/**
 * In-process FIFO that runs one snapshot at a time.
 *
 * @returns {{run: Function, pending: Function}}
 */
export function createDockerSnapshotQueue() {
  let tail = Promise.resolve();
  let depth = 0;
  return {
    /**
     * @param {Function} task - async () => result
     * @param {Object} [options]
     * @param {Function} [options.onQueued] - async (ahead) => void, when others are ahead
     */
    async run(task, { onQueued = null } = {}) {
      const ahead = depth;
      depth++;
      const previous = tail;
      let release;
      tail = new Promise(resolve => {
        release = resolve;
      });
      try {
        if (ahead > 0 && typeof onQueued === 'function') await onQueued(ahead);
        await previous;
        return await task();
      } finally {
        depth--;
        release();
      }
    },
    pending: () => depth,
  };
}

/** The bot's single snapshot queue. */
export const dockerSnapshotQueue = createDockerSnapshotQueue();
