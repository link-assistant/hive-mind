/**
 * Disk guard for in-place kill recoveries that snapshot a container (#2889).
 *
 * `$ --resume <id> -- <command>` in `docker-snapshot` mode runs `docker commit`
 * on the stopped container's whole writable layer. With the containerd image
 * store the commit writes a compressed blob and an unpacked snapshot, so for a
 * while the disk holds the layer about three times (the original is already
 * on disk). After one host-wide kill, four such commits (11-37 GiB each, mostly
 * Cargo `target/`) ran at once on a host with 52 GB free and filled it.
 *
 * Two rules apply to every snapshot resume:
 *
 *   1. One at a time: snapshots queue in-process; the others wait and say so.
 *   2. Headroom first: free space on the Docker data root must cover twice the
 *      writable layer plus a reserve for the tasks that keep running. Until it
 *      does, the recovery reports "waiting for disk" and re-checks; when the
 *      space never appears it falls back to a fresh launch instead of filling
 *      the disk.
 *
 * An unmeasured layer still has to leave the reserve free; only unmeasured
 * free space does not block (the previous behaviour), and it is reported.
 * Before measuring, an optional `prune` step deletes regenerable build caches
 * from the stopped container (see kill-recovery-snapshot-cleanup.lib.mjs), and
 * each stage is reported: queued, waiting for disk, caches removed, and
 * "snapshotting <size>" (Docker reports no progress while it commits).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2889
 */

const GIB = 1024 ** 3;

/** Free bytes needed per writable-layer byte: commit blob + unpacked snapshot. */
export const SNAPSHOT_DISK_HEADROOM_FACTOR = 2;
/** Free space that must remain for the tasks that keep running. */
export const SNAPSHOT_DISK_RESERVE_BYTES = 10 * GIB;
/** How long a snapshot waits for disk before the fresh-launch fallback. */
export const SNAPSHOT_DISK_WAIT_MS = 10 * 60 * 1000;
/** Re-check interval while waiting for disk. */
export const SNAPSHOT_DISK_POLL_MS = 30 * 1000;

/** `12.3 GiB`, the unit used in recovery notices and logs. */
export function formatGiB(bytes) {
  return Number.isFinite(bytes) ? `${(bytes / GIB).toFixed(1)} GiB` : 'unknown';
}

/**
 * Whether the Docker data root can take a snapshot of a writable layer.
 * @returns {{known: boolean, ok: boolean, writableBytes: number|null, availableBytes: number|null, requiredBytes: number|null}}
 */
export function evaluateSnapshotDiskHeadroom({ writableBytes = null, availableBytes = null, factor = SNAPSHOT_DISK_HEADROOM_FACTOR, reserveBytes = SNAPSHOT_DISK_RESERVE_BYTES } = {}) {
  const writable = Number.isFinite(writableBytes) && writableBytes >= 0 ? writableBytes : null;
  const available = Number.isFinite(availableBytes) && availableBytes >= 0 ? availableBytes : null;
  if (available === null) return { known: false, ok: true, writableBytes: writable, availableBytes: null, requiredBytes: null };
  // Issue #2889: with the layer unmeasured, the tasks that keep running still get their reserve.
  if (writable === null) return { known: false, ok: available >= reserveBytes, writableBytes: null, availableBytes: available, requiredBytes: reserveBytes };
  const requiredBytes = Math.ceil(writable * factor + reserveBytes);
  return { known: true, ok: available >= requiredBytes, writableBytes: writable, availableBytes: available, requiredBytes };
}

/** Recovery notice while a snapshot waits for disk. */
export function formatSnapshotDiskWait(evaluation) {
  return `Waiting for disk: ${formatGiB(evaluation.availableBytes)} free on the Docker data root, ${formatGiB(evaluation.requiredBytes)} needed to snapshot this ${Number.isFinite(evaluation.writableBytes) ? formatGiB(evaluation.writableBytes) : 'unmeasured'} container safely.`;
}

/** Recovery notice as the commit starts: the size is all Docker lets us know. */
export function formatSnapshotStart(evaluation, containerName) {
  const size = Number.isFinite(evaluation?.writableBytes) ? `${formatGiB(evaluation.writableBytes)} of ${containerName}` : `${containerName} (size not measured)`;
  const disk = evaluation?.known ? ` (${formatGiB(evaluation.availableBytes)} free, ${formatGiB(evaluation.requiredBytes)} needed)` : Number.isFinite(evaluation?.writableBytes) ? ' (free space not measured)' : '';
  return `Snapshotting ${size}${disk}. Docker reports no progress while it commits; large layers take minutes.`;
}

/** Recovery notice after regenerable caches were removed from the container. */
export function formatSnapshotPrune(pruned, containerName) {
  const count = pruned.paths?.length || 0;
  return `Removed ${formatGiB(pruned.freedBytes)} of regenerable build caches (${count} director${count === 1 ? 'y' : 'ies'}) from ${containerName} before snapshotting it.`;
}

/**
 * The writable layer to snapshot and the free space for it. The monitor's
 * last measurement is used first: `docker inspect --size` walks the whole
 * layer, which takes minutes for tens of gigabytes.
 */
export async function measureSnapshotDisk({ sessionInfo, containerName, runner, prunedBytes = 0, verbose = false }) {
  // The monitor measured before the kill, so subtract what a prune removed since.
  let writableBytes = Number.isFinite(sessionInfo?.containerFilesystemLastBytes) ? Math.max(0, sessionInfo.containerFilesystemLastBytes - (Number.isFinite(prunedBytes) ? prunedBytes : 0)) : null;
  if (writableBytes === null && typeof runner?.getDockerContainerWritableLayerSize === 'function') {
    writableBytes = await Promise.resolve(runner.getDockerContainerWritableLayerSize(containerName, verbose)).catch(() => null);
  }
  const disk = typeof runner?.checkDockerDiskSpace === 'function' ? await Promise.resolve(runner.checkDockerDiskSpace(verbose)).catch(() => null) : null;
  return { writableBytes: Number.isFinite(writableBytes) ? writableBytes : null, availableBytes: Number.isFinite(disk?.availableGiB) ? disk.availableGiB * GIB : null };
}

/**
 * Re-measure until the snapshot fits or the wait runs out.
 * @returns {Promise<{ok: boolean, waitedMs: number, evaluation: Object}>}
 */
export async function waitForSnapshotDiskHeadroom({ measure, onWaiting = async () => {}, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, waitMs = SNAPSHOT_DISK_WAIT_MS, pollMs = SNAPSHOT_DISK_POLL_MS } = {}) {
  const startedAt = now();
  for (;;) {
    const evaluation = evaluateSnapshotDiskHeadroom((await measure()) || {});
    const waitedMs = now() - startedAt;
    if (evaluation.ok) return { ok: true, waitedMs, evaluation };
    if (waitedMs >= waitMs) return { ok: false, waitedMs, evaluation };
    await onWaiting(evaluation);
    await sleep(Math.max(1, Math.min(pollMs, waitMs - waitedMs)));
  }
}

/** In-process FIFO that runs one snapshot at a time. */
export function createSnapshotQueue() {
  let tail = Promise.resolve();
  let depth = 0;
  return {
    async run(task, { onQueued = null } = {}) {
      const ahead = depth++;
      const previous = tail;
      let release;
      tail = new Promise(resolve => {
        release = resolve;
      });
      try {
        if (ahead > 0 && typeof onQueued === 'function') await Promise.resolve(onQueued(ahead)).catch(() => {});
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
export const snapshotQueue = createSnapshotQueue();

/**
 * Run `resume` (the `$ --resume` call) under both rules.
 * @returns {Promise<{skipped: true, evaluation: Object, detail: string}|{skipped: false, result: any}>}
 */
export async function runGuardedSnapshotResume({ sessionName, sessionInfo, containerName, runner, notify = async () => {}, attempt = null, queue = snapshotQueue, prune = null, sleep, now, waitMs, pollMs, verbose = false }, resume) {
  const say = reason => Promise.resolve(notify({ phase: 'launching', attempt, reason })).catch(() => {});
  return queue.run(
    async () => {
      let told = false;
      // Inside the queue: only one container is ever started for pruning.
      const pruned = typeof prune === 'function' ? await Promise.resolve(prune()).catch(error => ({ pruned: false, freedBytes: 0, reason: error?.message || String(error) })) : null;
      const prunedBytes = pruned?.pruned && Number.isFinite(pruned.freedBytes) ? pruned.freedBytes : 0;
      if (prunedBytes > 0) await say(formatSnapshotPrune(pruned, containerName));
      else if (pruned?.reason && verbose) console.log(`[VERBOSE] In-place resume of ${sessionName}: caches not pruned: ${pruned.reason}`);
      const headroom = await waitForSnapshotDiskHeadroom({
        measure: () => measureSnapshotDisk({ sessionInfo, containerName, runner, prunedBytes, verbose }),
        onWaiting: async evaluation => {
          const detail = formatSnapshotDiskWait(evaluation);
          if (verbose) console.log(`[VERBOSE] In-place resume of ${sessionName}: ${detail}`);
          if (!told) await say(detail);
          told = true;
        },
        ...(sleep ? { sleep } : {}),
        ...(now ? { now } : {}),
        ...(Number.isFinite(waitMs) ? { waitMs } : {}),
        ...(Number.isFinite(pollMs) ? { pollMs } : {}),
      });
      const { evaluation } = headroom;
      if (!headroom.ok) {
        const detail = `Not snapshotting ${containerName}: ${formatSnapshotDiskWait(evaluation)} Starting a fresh isolated session instead.`;
        console.warn(`[session-kill-resume] ${detail}`);
        return { skipped: true, evaluation, detail };
      }
      const started = formatSnapshotStart(evaluation, containerName);
      if (verbose) console.log(`[VERBOSE] In-place resume of ${sessionName}: ${started}`);
      await say(started);
      const startedAt = Date.now();
      const result = await resume();
      console.log(`[session-kill-resume] Snapshot resume of ${containerName} returned after ${Math.round((Date.now() - startedAt) / 1000)}s`);
      return { skipped: false, result, prunedBytes };
    },
    {
      onQueued: ahead => {
        if (verbose) console.log(`[VERBOSE] In-place resume of ${sessionName}: waiting for ${ahead} other container snapshot(s) to finish first`);
        return say(`Waiting for ${ahead} other container snapshot${ahead === 1 ? '' : 's'} to finish first, so they do not fill the disk together.`);
      },
    }
  );
}
