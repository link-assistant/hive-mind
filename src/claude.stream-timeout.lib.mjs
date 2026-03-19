/**
 * Stream timeout management for Claude CLI execution.
 * Handles two types of timeouts:
 * - Issue #1280: Force-kill after result event if stream doesn't close
 * - Issue #1444: Force-kill on stream inactivity (no output for too long)
 */

/**
 * Creates a stream timeout manager for Claude CLI execution.
 * @param {Object} params
 * @param {number} params.streamCloseTimeoutMs - Timeout after result event (Issue #1280)
 * @param {number} params.streamInactivityMs - Timeout for stream inactivity (Issue #1444)
 * @param {Object} params.execCommand - The command-stream execution handle
 * @param {Function} params.log - Logging function
 * @returns {Object} Timeout manager with methods to control timeouts
 */
export const createStreamTimeoutManager = ({ streamCloseTimeoutMs, streamInactivityMs, execCommand, log }) => {
  let resultEventReceived = false;
  let resultTimeoutId = null;
  let forceExitTriggered = false;
  let inactivityTimeoutId = null;

  const killProcess = () => {
    try {
      if (!execCommand.kill) return;
      execCommand.kill('SIGTERM');
      // Issue #1346: unref timer to avoid event loop leak
      const sigkillTimerId = setTimeout(() => {
        try {
          if (!execCommand.result?.code) execCommand.kill('SIGKILL');
        } catch {
          /* process may have exited */
        }
      }, 2000);
      sigkillTimerId.unref();
    } catch {
      /* process may have exited */
    }
  };

  const forceExit = async reason => {
    if (forceExitTriggered) return;
    forceExitTriggered = true;
    if (inactivityTimeoutId) {
      clearTimeout(inactivityTimeoutId);
      inactivityTimeoutId = null;
    }
    if (reason === 'inactivity') {
      await log(`⚠️ No output for ${streamInactivityMs / 1000}s, forcing exit (Issue #1444)`, { verbose: true });
    } else {
      await log(`⚠️ Stream didn't close ${streamCloseTimeoutMs / 1000}s after result, forcing exit (Issue #1280)`, { verbose: true });
    }
    killProcess();
  };

  const resetInactivityTimeout = () => {
    if (inactivityTimeoutId) clearTimeout(inactivityTimeoutId);
    if (forceExitTriggered || resultEventReceived) return;
    inactivityTimeoutId = setTimeout(() => forceExit('inactivity'), streamInactivityMs);
    inactivityTimeoutId.unref();
  };

  const onResultEvent = async () => {
    if (resultEventReceived) return;
    resultEventReceived = true;
    if (inactivityTimeoutId) {
      clearTimeout(inactivityTimeoutId);
      inactivityTimeoutId = null;
    }
    await log(`📌 Result event received, starting ${streamCloseTimeoutMs / 1000}s stream close timeout (Issue #1280)`, { verbose: true });
    resultTimeoutId = setTimeout(() => forceExit('result_stream_close'), streamCloseTimeoutMs);
  };

  const cleanup = async () => {
    if (inactivityTimeoutId) {
      clearTimeout(inactivityTimeoutId);
      inactivityTimeoutId = null;
    }
    if (resultTimeoutId) {
      clearTimeout(resultTimeoutId);
      await log(forceExitTriggered ? '⚠️ Stream exited via force-kill timeout (Issue #1280)' : '✅ Stream closed normally after result event', { verbose: true });
    } else if (forceExitTriggered && !resultEventReceived) {
      await log('⚠️ Stream exited via inactivity timeout (Issue #1444)', { verbose: true });
    }
  };

  return {
    get forceExitTriggered() {
      return forceExitTriggered;
    },
    get resultEventReceived() {
      return resultEventReceived;
    },
    resetInactivityTimeout,
    onResultEvent,
    cleanup,
  };
};
