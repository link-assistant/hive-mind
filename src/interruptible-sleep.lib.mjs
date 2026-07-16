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

export default { interruptibleSleep };
