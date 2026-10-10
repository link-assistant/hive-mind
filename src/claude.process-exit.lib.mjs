/**
 * Claude CLI process-exit interpretation (Issue #3015).
 *
 * After Claude's `result` event the solver waits `HIVE_MIND_RESULT_STREAM_CLOSE_MS`
 * (30s) for the CLI to exit, then sends SIGTERM itself (Issue #1280). The process
 * then ends with 143 (128 + SIGTERM). That code is the solver's own signal, not the
 * CLI's verdict: the verdict is the `result` event that has already arrived.
 *
 * command-stream up to v0.9.4 did not yield `exit` chunks from stream(), so only the
 * `execCommand.result.code` check ran, and it already skipped forced closes. Newer
 * command-stream releases do yield `{ type: 'exit', code: 143 }`. The exit-chunk branch
 * counted any non-zero code as a failure, so a session that reported
 * `subtype: success, is_error: false` was published as "Solution Draft Failed".
 *
 * Both exit paths share this helper so they cannot drift apart again.
 */

const SIGNAL_NAMES = { 129: 'SIGHUP', 130: 'SIGINT', 137: 'SIGKILL', 143: 'SIGTERM' };

/**
 * Describe an exit code, naming the signal when the code is 128 + signal number.
 *
 * @param {number} code
 * @returns {string} e.g. "143 (SIGTERM)"
 */
export const describeExitCode = code => (SIGNAL_NAMES[code] ? `${code} (${SIGNAL_NAMES[code]})` : `${code}`);

/**
 * Decide what a Claude CLI exit code means for the session.
 *
 * @param {Object} options
 * @param {number|null|undefined} options.code - Exit code reported for the process
 * @param {boolean} options.forceExitTriggered - The solver killed the process itself
 * @param {boolean} options.resultCloseTimeoutFired - The kill came from the post-result close timeout
 * @param {boolean} options.resultSuccessReceived - The last result event was `success` with `is_error !== true`
 * @returns {{ exitCode: number, failed: boolean, ignored: boolean, reason: string|null }}
 *   `exitCode` is the code to record, `failed` whether it fails the session on its own,
 *   `ignored` whether the code was discarded as a solver-initiated post-result kill.
 */
export const interpretClaudeExitCode = ({ code, forceExitTriggered = false, resultCloseTimeoutFired = false, resultSuccessReceived = false } = {}) => {
  if (typeof code !== 'number' || code === 0) return { exitCode: 0, failed: false, ignored: false, reason: null };
  if (resultCloseTimeoutFired && resultSuccessReceived) {
    return { exitCode: 0, failed: false, ignored: true, reason: `Claude CLI did not exit after its successful result; the solver stopped it (exit ${describeExitCode(code)}), which is not a session failure` };
  }
  // Any other solver-initiated kill (startup/activity timeout, loop breaker, base-branch stop) is
  // judged by the flag that triggered it, not by the signal's exit code.
  return { exitCode: code, failed: !forceExitTriggered, ignored: false, reason: null };
};

const normalizeText = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/**
 * True when `text` is the session's own success summary rather than an error.
 *
 * @param {string} text
 * @param {string|null|undefined} resultSummary
 * @returns {boolean}
 */
export const isSuccessSummaryText = (text, resultSummary) => {
  const summary = normalizeText(resultSummary);
  return Boolean(summary) && normalizeText(text) === summary;
};

/**
 * Pick the message that describes a failed Claude session.
 *
 * `lastMessage` holds the last assistant text seen on the stream. After a successful
 * result that text is the work summary, and publishing it as the error produced
 * "CLAUDE execution failed with I fixed the four `/queue` problems…" in Issue #3015.
 * In that case the failure is described by the exit code instead.
 *
 * @param {Object} options
 * @param {string} options.lastMessage
 * @param {number} options.exitCode
 * @param {boolean} options.resultSuccessReceived
 * @param {string|null} [options.resultSummary]
 * @returns {string} The message to pass on as the failure reason
 */
export const selectClaudeFailureMessage = ({ lastMessage, exitCode, resultSuccessReceived, resultSummary }) => {
  if (resultSuccessReceived && isSuccessSummaryText(lastMessage, resultSummary)) {
    return exitCode ? `Claude CLI exited with code ${describeExitCode(exitCode)} after reporting a successful result` : 'Claude session failed after reporting a successful result';
  }
  return lastMessage;
};

/**
 * True while any process in the group led by `pid` is alive.
 *
 * The post-SIGTERM SIGKILL follow-up used to check `execCommand.result.code`, which is set
 * as soon as the wrapping shell exits. The Claude CLI in the same group can outlive it (the
 * Issue #3015 log lists the CLI as still running after the stream closed), so it was never
 * force-killed. Signal 0 checks for existence without sending anything.
 *
 * @param {number} pid - process group leader
 * @param {Function} [kill=process.kill] - injectable for tests
 * @returns {boolean}
 */
export const isProcessGroupAlive = (pid, kill = process.kill.bind(process)) => {
  try {
    kill(-pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
};
