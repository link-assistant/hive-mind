#!/usr/bin/env node

/**
 * Say why a child process ended (issue #2135).
 *
 * The session captured for that issue ended with the solve child aborting on a
 * V8 heap limit:
 *
 *   FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
 *
 * `node` answers that by calling `abort()`, so the child is terminated by a
 * signal and `child.on('close')` reports `code === null`. Every spawner in this
 * repository interpolated that `code` straight into its message and produced
 *
 *   ❌ Error: solve exited with code null
 *
 * which says nothing about memory, and the wrapper's own exit code 1 was all
 * that reached the Telegram notification ("Work session failed (exit code:
 * 1)"). The signal was known at that moment and simply thrown away.
 *
 * @module child-exit
 */

/**
 * What a signal says about how the child died.
 *
 * SIGABRT is the one that matters here: `node` aborts on a fatal V8 error, and
 * "reached heap limit" is by far the most common of those in this codebase.
 * SIGKILL is the other memory ending - the kernel's OOM killer, or a container
 * runtime enforcing a memory limit, neither of which lets the process print
 * anything at all.
 */
const SIGNAL_EXPLANATIONS = new Map([
  ['SIGABRT', 'the process aborted - for Node.js this is usually a fatal V8 error such as "Reached heap limit Allocation failed - JavaScript heap out of memory"; look for "FATAL ERROR" above'],
  ['SIGKILL', 'the process was killed outright - usually the kernel out-of-memory killer or a container memory limit; nothing it could print survives this'],
  ['SIGTERM', 'the process was asked to terminate - usually a timeout, a container stop, or another process shutting it down'],
  ['SIGINT', 'the process was interrupted (Ctrl+C)'],
  ['SIGSEGV', 'the process crashed with a segmentation fault'],
]);

/**
 * Describe how a spawned child ended, in a sentence a log reader can act on.
 *
 * @param {object} params
 * @param {string} params.command - what was spawned, as the reader knows it (e.g. `solve`).
 * @param {number|null} [params.code] - the exit code from `close`/`exit`, null when signalled.
 * @param {string|null} [params.signal] - the signal name from `close`/`exit`, when there is one.
 * @returns {string} A description ending without punctuation, ready to be used
 *   as an `Error` message or logged as-is.
 */
export const describeChildExit = ({ command, code = null, signal = null }) => {
  if (signal) {
    const explanation = SIGNAL_EXPLANATIONS.get(signal);
    return explanation ? `${command} was terminated by signal ${signal}: ${explanation}` : `${command} was terminated by signal ${signal}`;
  }
  if (code === null || code === undefined) {
    // No code and no signal: rare, but "code null" on its own is exactly the
    // uninformative message this module exists to replace.
    return `${command} exited without a status code, so it did not finish normally (no signal was reported either)`;
  }
  return `${command} exited with code ${code}`;
};

/**
 * True when the ending looks like the child ran out of memory.
 *
 * Callers use this to add the one hint that would have saved the captured
 * session: the child died of memory pressure, not of a failed check.
 *
 * @param {object} params
 * @param {number|null} [params.code]
 * @param {string|null} [params.signal]
 * @returns {boolean}
 */
export const isLikelyOutOfMemoryExit = ({ code = null, signal = null }) => signal === 'SIGABRT' || signal === 'SIGKILL' || (signal === null && code === 134);

/**
 * Wire `close`/`error` handlers that never lose a signal.
 *
 * The exit code handed to `onExit` is 1 for a signalled child: `code || 0`
 * turned the `null` of a signalled exit into a success, so a worker killed by
 * the OOM killer looked like a worker that finished its issue.
 *
 * @param {object} params
 * @param {import('node:child_process').ChildProcess} params.child
 * @param {string} params.command - what was spawned, as the log reader knows it.
 * @param {string} params.label - prefix for the exit line (e.g. `   [solve worker-1]`).
 * @param {string} [params.errorLabel] - prefix for the spawn-failure line; defaults to `label`.
 * @param {Function} params.log - async logger, `(message, options) => Promise`.
 * @param {Function} [params.onLogError] - called as `(error, operation)` when logging itself fails.
 * @param {Function} params.onExit - called once with `{ exitCode, code, signal, error }`.
 */
export const attachChildExitHandlers = ({ child, command, label, errorLabel = label, log, onLogError = () => {}, onExit }) => {
  child.on('close', (code, signal) => {
    if (signal) {
      log(`${label} ${describeChildExit({ command, code, signal })}`, { level: 'error' }).catch(logError => onLogError(logError, 'log_child_signal_exit'));
    }
    onExit({ exitCode: signal ? 1 : code || 0, code, signal, error: null });
  });

  child.on('error', error => {
    log(`${errorLabel} Process error: ${error.message}`, { level: 'error' }).catch(logError => onLogError(logError, 'log_child_process_error'));
    onExit({ exitCode: 1, code: null, signal: null, error });
  });
};

export default { describeChildExit, isLikelyOutOfMemoryExit, attachChildExitHandlers };
