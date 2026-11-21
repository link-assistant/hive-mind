/**
 * Run slow command work outside the Telegram update path.
 *
 * Telegraf fetches the next batch of updates only after every handler of the
 * current batch has settled. A handler that awaits a slow launch (a `docker
 * pull`, `gh` calls, a merge-queue scan) therefore stops the bot from reading
 * any chat. `detachHandler` turns such a handler into one that returns at once
 * and finishes its work in the background; failures still reach the user
 * through the same error handler `bot.catch` uses.
 *
 * @module telegram-background-task.lib
 * @see https://github.com/link-assistant/hive-mind/issues/3206
 */

const stats = { started: 0, running: 0, failed: 0 };

/** Counters for the bot heartbeat. */
export function getBackgroundTaskStats() {
  return { ...stats };
}

/**
 * Start `task` now and never reject: an error goes to `onError` (or the log).
 *
 * @param {Function} task - `() => any`; may be async.
 * @param {object} [options]
 * @param {string} [options.label] - Name used in log lines.
 * @param {Function} [options.onError] - `error => void`.
 * @param {Console} [options.logger]
 * @returns {Promise<void>} Settles when the task is done.
 */
export function runInBackground(task, { label = 'background task', onError = null, logger = console } = {}) {
  stats.started += 1;
  stats.running += 1;
  const report = error => {
    stats.failed += 1;
    try {
      if (typeof onError === 'function') onError(error);
      else logger.error(`[telegram-bot] ${label} failed:`, error);
    } catch (reportError) {
      logger.error(`[telegram-bot] ${label} failed and reporting the failure failed too:`, reportError, error);
    }
  };
  return new Promise(resolve => resolve(task()))
    .then(() => undefined, report)
    .finally(() => {
      stats.running -= 1;
    });
}

/**
 * A queue that runs the tasks given to it one after another. Commands whose
 * own duplicate checks assume one invocation at a time (for example /merge,
 * which records the running operation only after its first GitHub calls) keep
 * that order while no longer holding the update loop.
 *
 * @returns {(task: Function) => Promise<any>}
 */
export function createSerialLane() {
  let tail = Promise.resolve();
  return task => {
    const run = tail.then(() => task());
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}

const skipNext = () => Promise.resolve();

/**
 * Wrap a Telegraf command handler so the update completes immediately and the
 * handler runs in the background.
 *
 * The wrapped handler never calls the next middleware: the update is already
 * finished by the time it could.
 *
 * @param {Function} handler - `(ctx, next) => Promise<void>`.
 * @param {object} [options]
 * @param {string} [options.label] - Name used in log lines; defaults to the handler name.
 * @param {Function} [options.onError] - `(error, ctx) => void`, normally the `bot.catch` handler.
 * @param {Function} [options.lane] - A serial lane from {@link createSerialLane}.
 * @param {Console} [options.logger]
 * @returns {(ctx: object) => void}
 */
export function detachHandler(handler, { label = handler.name || 'command handler', onError = null, lane = null, logger = console } = {}) {
  return function detachedHandler(ctx) {
    const task = () => handler(ctx, skipNext);
    void runInBackground(lane ? () => lane(task) : task, {
      label,
      logger,
      onError: typeof onError === 'function' ? error => onError(error, ctx) : null,
    });
  };
}

/**
 * Keys (such as issue URLs) that a background launch is working on. A second
 * command for the same key is refused until the first one has registered its
 * session or queue entry and released the claim.
 */
export function createKeyClaims() {
  const held = new Map();
  return {
    /**
     * @param {string} key
     * @returns {(() => void)|null} A release function, or null when the key is already claimed.
     */
    claim(key) {
      if (held.has(key)) return null;
      const token = Symbol(key);
      held.set(key, token);
      return () => {
        if (held.get(key) === token) held.delete(key);
      };
    },
    has(key) {
      return held.has(key);
    },
    get size() {
      return held.size;
    },
  };
}
