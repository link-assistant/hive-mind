/**
 * The Telegram bot's wiring for a durable solve queue (issue #2890) and for
 * counting docker task containers (issue #2917).
 *
 * Kept out of telegram-bot.mjs, which is close to its line budget: the bot
 * calls setupSolveQueueDurability() once at startup, `restoreOnLaunch()` after
 * resumeSessionsOnLaunch(), `stop()` on shutdown and `flushSync()` in the exit
 * handler.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2890
 * @see https://github.com/link-assistant/hive-mind/issues/2917
 */

import { createSolveQueueStore } from './solve-queue-store.lib.mjs';
import { attachQueuePersistence, restoreSolveQueueOnLaunch } from './solve-queue-restore.lib.mjs';
import { configureTaskContainerSource, getTaskContainerSnapshot } from './task-container-inventory.lib.mjs';
import { startTaskContainerAdoption } from './task-container-adoption.lib.mjs';

/**
 * @param {Object} options
 * @param {Function} options.getSolveQueue - `getSolveQueue({ verbose })`.
 * @param {Function} options.createExecuteCallback - Builds the queue's `executeCallback` (the same one the first enqueue would build).
 * @param {string} [options.isolationBackend] - The bot's isolation backend (`docker`, `screen`, ...).
 * @param {Object} [options.isolationRunner] - For `$ --list` (`listIsolationSessions`).
 * @param {Function} [options.trackSession] - `(sessionName, sessionInfo) => void`, for adopted containers.
 * @param {Function} [options.hasActiveSessionForUrl] - `async url => boolean`.
 * @param {Object} [options.logger] - The bot logger (its `dir` is the log fallback).
 * @param {Object} [options.store] - Injected store (tests).
 * @param {boolean} [options.verbose]
 * @returns {{store: Object, queue: Object, ensureExecuteCallback: Function, restoreOnLaunch: Function, startAdoption: Function, stop: Function, flushSync: Function}}
 */
export function setupSolveQueueDurability({ getSolveQueue, createExecuteCallback, isolationBackend = null, isolationRunner = null, trackSession = null, hasActiveSessionForUrl = null, logger = null, store = null, verbose = false } = {}) {
  const backend = isolationBackend || null;
  // Issue #2917: `docker ps` is the ground truth for docker-isolated tasks.
  configureTaskContainerSource({
    enabled: backend === 'docker',
    backend,
    listSessions: typeof isolationRunner?.listIsolationSessions === 'function' ? v => isolationRunner.listIsolationSessions(v) : null,
  });
  const queueStore = store || createSolveQueueStore({ logDir: logger?.dir || null, logger, verbose });
  const queue = getSolveQueue({ verbose });
  attachQueuePersistence(queue, { store: queueStore, logger });

  const ensureExecuteCallback = target => {
    const q = target || queue;
    if (!q.executeCallback && typeof createExecuteCallback === 'function') q.executeCallback = createExecuteCallback();
    return q.executeCallback;
  };

  let adoption = null;
  return {
    store: queueStore,
    queue,
    ensureExecuteCallback,
    /**
     * Put back the items a previous process left queued (issue #2890).
     * Never throws: a failed restore is logged and the bot keeps starting.
     * @param {Object|null} telegram - `bot.telegram`, for the restore notices.
     */
    async restoreOnLaunch(telegram) {
      try {
        return await restoreSolveQueueOnLaunch({
          queue,
          store: queueStore,
          telegram,
          ensureExecuteCallback,
          listSessions: typeof isolationRunner?.listIsolationSessions === 'function' ? () => isolationRunner.listIsolationSessions(verbose) : null,
          getContainerSnapshot: () => getTaskContainerSnapshot(verbose, { fresh: true }),
          hasActiveSessionForUrl,
          logger,
          verbose,
        });
      } catch (error) {
        logger?.error?.(`Solve queue restore failed: ${error?.message || error}`);
        return null;
      }
    },
    /** Issue #2917: track running task containers nobody tracks (only under docker isolation). */
    startAdoption() {
      if (backend !== 'docker' || adoption || typeof trackSession !== 'function') return adoption;
      adoption = startTaskContainerAdoption({ trackSession, logger, verbose });
      return adoption;
    },
    stop() {
      adoption?.stop();
      adoption = null;
    },
    flushSync() {
      queueStore.flushSync(); // hive-sync-ok: exit handler, the event loop is gone
    },
  };
}
