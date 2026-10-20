/**
 * A poller that never overlaps itself.
 *
 * Issue #3614: `setInterval(asyncTick, ms)` starts a new tick every `ms`
 * whether or not the previous one finished, so a slow tick (a hung Docker
 * daemon, a long completion) piles up copies that each start their own
 * processes. This poller schedules the next tick with `setTimeout` only after
 * the current one has settled, so at most one tick runs at a time and the gap
 * between two ticks is always at least `intervalMs`.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3614
 */

/**
 * @param {() => Promise<unknown>|unknown} tick - Work for one pass; a rejection is logged, not thrown
 * @param {object} options
 * @param {number} options.intervalMs - Delay between the end of one tick and the start of the next
 * @param {boolean} [options.runImmediately=true] - Run the first tick now instead of after one interval
 * @param {boolean} [options.unref=false] - Do not keep the process alive for this timer
 * @param {string} [options.name='poller'] - Log prefix for failed ticks
 * @param {(error: unknown) => void} [options.onError]
 * @param {typeof setTimeout} [options.setTimeoutImpl]
 * @param {typeof clearTimeout} [options.clearTimeoutImpl]
 * @returns {{stop: () => void, isStopped: () => boolean, isTickRunning: () => boolean, whenIdle: () => Promise<void>}}
 */
export function startSerialPoller(tick, { intervalMs, runImmediately = true, unref = false, name = 'poller', onError, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
  let stopped = false;
  let timer = null;
  let running = null;
  const reportError = onError || (error => console.error(`[${name}] tick failed: ${error?.message || error}`));

  const schedule = () => {
    if (stopped) return;
    timer = setTimeoutImpl(run, intervalMs);
    if (unref) timer?.unref?.();
  };

  function run() {
    timer = null;
    if (stopped) return;
    running = (async () => {
      try {
        await tick();
      } catch (error) {
        reportError(error);
      }
    })().finally(() => {
      running = null;
      schedule();
    });
  }

  if (runImmediately) run();
  else schedule();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeoutImpl(timer);
      timer = null;
    },
    isStopped: () => stopped,
    isTickRunning: () => running !== null,
    whenIdle: () => running || Promise.resolve(),
  };
}

/** Whether `promise` settles within `ms`; a rejection that arrives in time is rethrown. */
export async function settlesWithin(promise, ms) {
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(resolve, ms);
  });
  try {
    // The settled branch never rejects, so a rejection after the timeout stays
    // with the caller's own handler instead of becoming unhandled here.
    const outcome = await Promise.race([
      promise.then(
        () => ({ done: true }),
        error => ({ done: true, error })
      ),
      timeout.then(() => ({ done: false })),
    ]);
    if (outcome.error) throw outcome.error;
    return outcome.done;
  } finally {
    clearTimeout(timer);
  }
}
