/**
 * Interruptible sleep utility for long-running wait loops.
 *
 * Replaces raw `await new Promise(r => setTimeout(r, ms))` with a sleep
 * that resolves immediately on SIGINT, so the process exit handler chain
 * is not blocked by a lingering timer.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1574
 */

/**
 * Sleep for `ms` milliseconds, but resolve early if SIGINT or SIGTERM is received.
 *
 * When the signal fires during the sleep, the timer is cleared and the promise
 * resolves with `{ interrupted: true }`. The existing signal handlers (from
 * exit-handler.lib.mjs) continue to run normally — this function does NOT
 * consume or re-emit the signal, it only ensures its own timer doesn't
 * block the event loop.
 *
 * Issue #1823: SIGTERM is also honoured because hive forwards the operator's CTRL+C to each
 * /solve worker as SIGTERM. When solve is only idle-waiting here (e.g. for CI/CD), it must stop
 * immediately rather than sleep out the remaining delay.
 *
 * @param {number} ms - Duration in milliseconds
 * @returns {Promise<{interrupted: boolean}>}
 */
export function interruptibleSleep(ms) {
  return new Promise(resolve => {
    let timer;

    const cleanupListeners = () => {
      process.removeListener('SIGINT', onInterrupt);
      process.removeListener('SIGTERM', onInterrupt);
    };

    const onInterrupt = () => {
      clearTimeout(timer);
      cleanupListeners();
      resolve({ interrupted: true });
    };

    timer = setTimeout(() => {
      cleanupListeners();
      resolve({ interrupted: false });
    }, ms);

    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onInterrupt);
  });
}

/**
 * Sleep for `ms` milliseconds, resolving early if SIGINT/SIGTERM arrives or if
 * `isCancelled()` starts returning true.
 *
 * Issue #2072: polling loops used to `await new Promise(r => setTimeout(r, pollInterval))`
 * and only re-check cancellation on the next iteration. With a 30s poll interval that
 * made `/merge` keep running for up to a full interval after the Cancel button was
 * pressed. Sleeping in short steps lets cancellation take effect within `stepMs`.
 *
 * @param {number} ms - Duration in milliseconds
 * @param {Function|null} isCancelled - Predicate polled during the sleep
 * @param {Object} [options]
 * @param {number} [options.stepMs=100] - Granularity at which `isCancelled` is polled
 * @returns {Promise<{interrupted: boolean, cancelled: boolean}>}
 */
export async function cancellableSleep(ms, isCancelled = null, options = {}) {
  const { stepMs = 100 } = options;

  if (!isCancelled) {
    const { interrupted } = await interruptibleSleep(ms);
    return { interrupted, cancelled: false };
  }

  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (isCancelled()) return { interrupted: false, cancelled: true };
    const { interrupted } = await interruptibleSleep(Math.min(stepMs, deadline - Date.now()));
    if (interrupted) return { interrupted: true, cancelled: isCancelled() };
  }

  return { interrupted: false, cancelled: isCancelled() };
}

export default { interruptibleSleep, cancellableSleep };
