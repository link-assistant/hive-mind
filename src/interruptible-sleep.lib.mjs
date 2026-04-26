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
 * Sleep for `ms` milliseconds, but resolve early if SIGINT is received.
 *
 * When SIGINT fires during the sleep, the timer is cleared and the promise
 * resolves with `{ interrupted: true }`. The existing SIGINT handler (from
 * exit-handler.lib.mjs) continues to run normally — this function does NOT
 * consume or re-emit the signal, it only ensures its own timer doesn't
 * block the event loop.
 *
 * @param {number} ms - Duration in milliseconds
 * @returns {Promise<{interrupted: boolean}>}
 */
export function interruptibleSleep(ms) {
  return new Promise(resolve => {
    let timer;

    const onInterrupt = () => {
      clearTimeout(timer);
      process.removeListener('SIGINT', onInterrupt);
      resolve({ interrupted: true });
    };

    timer = setTimeout(() => {
      process.removeListener('SIGINT', onInterrupt);
      resolve({ interrupted: false });
    }, ms);

    process.on('SIGINT', onInterrupt);
  });
}

export default { interruptibleSleep };
