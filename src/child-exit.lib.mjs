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
 * Fatal lines a runtime prints when it exhausts its *own* heap.
 *
 * Issue #2189: a session died of `FATAL ERROR: Reached heap limit Allocation
 * failed - JavaScript heap out of memory` and was reported to the user as a
 * "forced kill … memory (10.3 GB of 11.7 GB RAM available)". Both statements
 * were individually true: V8 stopped at its own ~2 GB old-space cap long before
 * the machine or the container cgroup felt any pressure, so `docker inspect`
 * said `OOMKilled=false` and `/sys/fs/cgroup/memory.events` said `oom_kill=0`.
 * Nothing outside the process can observe a runtime self-abort — the only
 * evidence is the text the runtime printed on its way out, which was sitting in
 * the log the diagnostics were already reading.
 *
 * The patterns are deliberately specific (a bare "out of memory" also appears in
 * Hive Mind's own diagnostic wording, which ends up in the same logs). Hive Mind
 * spawns more than Node, so the other runtimes it drives are covered too.
 */
export const FATAL_MEMORY_PATTERNS = [
  { id: 'v8-heap-limit', runtime: 'Node.js/V8', pattern: /FATAL ERROR:[^\n]*Reached heap limit/ },
  { id: 'v8-ineffective-mark-compacts', runtime: 'Node.js/V8', pattern: /FATAL ERROR:[^\n]*Ineffective mark-compacts near heap limit/ },
  { id: 'v8-heap-out-of-memory', runtime: 'Node.js/V8', pattern: /JavaScript heap out of memory/ },
  { id: 'v8-last-few-gcs', runtime: 'Node.js/V8', pattern: /<--- Last few GCs --->/ },
  { id: 'v8-array-buffer-allocation', runtime: 'Node.js/V8', pattern: /Array buffer allocation failed/ },
  { id: 'rust-allocation-failed', runtime: 'Rust', pattern: /memory allocation of \d+ bytes failed/ },
  { id: 'go-runtime-out-of-memory', runtime: 'Go', pattern: /fatal error: runtime: out of memory/ },
  { id: 'cpp-bad-alloc', runtime: 'C/C++', pattern: /std::bad_alloc/ },
];

/**
 * Find the first runtime self-abort marker in a piece of log text.
 *
 * Callers must only treat a hit as a cause when the process actually ended
 * abnormally — the marker upgrades an existing kill to "out of memory", it never
 * invents one, so an unrelated log that merely quotes the string cannot turn a
 * healthy run into a reported crash.
 *
 * @param {string|null} text - Log text (a tail is enough; the marker is printed last)
 * @returns {{id: string, runtime: string, line: string}|null}
 */
export const findFatalMemoryMarker = text => {
  if (!text || typeof text !== 'string') return null;
  for (const { id, runtime, pattern } of FATAL_MEMORY_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const lineStart = text.lastIndexOf('\n', match.index) + 1;
    const lineEndIndex = text.indexOf('\n', match.index);
    const line = text.slice(lineStart, lineEndIndex < 0 ? undefined : lineEndIndex).trim();
    return { id, runtime, line: line.length > 300 ? `${line.slice(0, 300)}…` : line };
  }
  return null;
};

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

export default { describeChildExit, isLikelyOutOfMemoryExit, findFatalMemoryMarker, attachChildExitHandlers };
