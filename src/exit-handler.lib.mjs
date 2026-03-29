#!/usr/bin/env node

/**
 * Centralized exit handler to ensure log path is always displayed
 * This module ensures that the absolute log path is shown whenever
 * the process exits, whether due to normal completion, errors, or signals.
 */

// Lazy-load Sentry to avoid keeping the event loop alive when not needed
let Sentry = null;
const getSentry = async () => {
  if (Sentry === null) {
    try {
      Sentry = await import('@sentry/node');
    } catch {
      // If Sentry is not available, just return null
      Sentry = { close: async () => {} };
    }
  }
  return Sentry;
};

// Keep track of whether we've already shown the exit message
let exitMessageShown = false;
let getLogPathFunction = null;
let logFunction = null;
let cleanupFunction = null;
let interruptFunction = null;
let interruptHandlerRan = false;

/**
 * Initialize the exit handler with required dependencies
 * @param {Function} getLogPath - Function that returns the current log path
 * @param {Function} log - Logging function
 * @param {Function} cleanup - Optional cleanup function to call on exit
 * @param {Function} interrupt - Optional interrupt function to call on SIGINT/SIGTERM before cleanup
 *                               (e.g., auto-commit uncommitted changes, upload logs)
 */
export const initializeExitHandler = (getLogPath, log, cleanup = null, interrupt = null) => {
  getLogPathFunction = getLogPath;
  logFunction = log;
  cleanupFunction = cleanup;
  interruptFunction = interrupt;
};

/**
 * Display the exit message with log path
 */
const showExitMessage = async (reason = 'Process exiting', code = 0) => {
  if (exitMessageShown || !getLogPathFunction || !logFunction) {
    return;
  }

  exitMessageShown = true;

  // Get the current log path dynamically
  const currentLogPath = await getLogPathFunction();

  // Always show the log path on exit
  await logFunction('');
  if (code === 0) {
    await logFunction(`✅ ${reason}`);
  } else {
    await logFunction(`❌ ${reason}`, { level: 'error' });
  }
  await logFunction(`📁 Full log file: ${currentLogPath}`);
};

/**
 * Drain and unref active Node.js handles so the event loop can exit naturally.
 *
 * Issue #1431: After all work completes, several handle types keep the event loop
 * alive and prevent the process from exiting on its own:
 *
 *   - ReadStream  — process.stdin is never unreferenced. Node keeps it open so the
 *                   process can receive user input, but a CLI tool is done with input
 *                   at this point.  Calling .unref() signals that this handle should
 *                   not prevent exit.
 *
 *   - Socket (×2) — Node 18+ built-in fetch() uses undici internally. Each HTTP
 *                   request leaves a keep-alive socket in undici's global connection
 *                   pool. Calling getGlobalDispatcher().close() drains and destroys
 *                   all pooled connections.
 *
 *   - ChildProcess — command-stream spawns child processes. The handle stays alive
 *                    until the OS reclaims the process entry. Calling .unref() on
 *                    each surviving child lets Node exit without waiting for them.
 *
 *   - WriteStream (×2) — process.stdout and process.stderr are always-open writable
 *                        streams. On non-TTY file descriptors (e.g. pipes, redirects)
 *                        they can keep the event loop alive. Calling .unref() is safe
 *                        because we have already finished all output at this point.
 *
 * All of these are "unref" fixes — the handles are not forcibly destroyed, just
 * marked as non-blocking so the event loop considers the process idle once all real
 * async work is done. This is the idiomatic Node.js pattern for CLI tools.
 */
const drainHandles = async () => {
  // 1. Unref process.stdin so a dangling ReadStream cannot block exit.
  try {
    if (process.stdin && !process.stdin.destroyed) {
      process.stdin.unref();
    }
  } catch {
    // Ignore — stdin may already be closed
  }

  // 2. Close undici's global dispatcher to drain keep-alive HTTP sockets (Socket handles).
  //    Node 18+ built-in fetch uses undici; each fetch() call may leave a socket in the
  //    pool. getGlobalDispatcher().close() is the documented way to drain them.
  try {
    const { getGlobalDispatcher } = await import('undici');
    const dispatcher = getGlobalDispatcher();
    if (dispatcher && typeof dispatcher.close === 'function') {
      await Promise.race([
        dispatcher.close(),
        new Promise(resolve => setTimeout(resolve, 1000)), // hard 1s deadline
      ]);
    }
  } catch {
    // undici may not be available in all Node versions — safe to ignore
  }

  // 3. Unref surviving child processes from command-stream.
  //    These are typically already-exited but their OS handle entry lingers.
  try {
    for (const handle of process._getActiveHandles()) {
      if (handle?.constructor?.name === 'ChildProcess' && typeof handle.unref === 'function') {
        handle.unref();
      }
    }
  } catch {
    // _getActiveHandles is a private V8 API — safe to ignore
  }

  // 4. Unref stdout/stderr on non-TTY descriptors.
  //    On a TTY these are already non-blocking; on pipes/redirects they keep the loop alive.
  try {
    if (process.stdout && !process.stdout.isTTY && typeof process.stdout.unref === 'function') {
      process.stdout.unref();
    }
    if (process.stderr && !process.stderr.isTTY && typeof process.stderr.unref === 'function') {
      process.stderr.unref();
    }
  } catch {
    // Ignore
  }
};

/**
 * Log active handles and requests for diagnostics.
 * Always logs if there are unexpected handles (not just in verbose mode),
 * treating lingering handles as a warning-level signal.
 *
 * @param {Function|null} log - Optional logging function; falls back to console.warn
 */
export const logActiveHandles = async (log = null) => {
  try {
    const handles = process._getActiveHandles();
    const requests = process._getActiveRequests();
    if (handles.length === 0 && requests.length === 0) return;

    const emit = log || (msg => console.warn(msg));
    await emit(`\n🔍 Active Node.js handles at exit (${handles.length} handles, ${requests.length} requests):`);
    for (const h of handles) {
      const name = h.constructor?.name || typeof h;
      // Extra detail for streams: show fd and path/remoteAddress if available
      const detail = [h.fd != null ? `fd=${h.fd}` : null, h.path ? `path=${h.path}` : null, h.remoteAddress ? `remote=${h.remoteAddress}:${h.remotePort}` : null, h.pid != null ? `pid=${h.pid}` : null, h.spawnfile ? `file=${h.spawnfile}` : null].filter(Boolean).join(', ');
      await emit(`   Handle: ${name}${detail ? ` (${detail})` : ''}`);
    }
    for (const r of requests) {
      await emit(`   Request: ${r.constructor?.name || typeof r}`);
    }
  } catch {
    // _getActiveHandles is a private V8 API — safe to ignore if unavailable
  }
};

/**
 * Safe exit function that ensures log path is shown
 */
export const safeExit = async (code = 0, reason = 'Process completed') => {
  await showExitMessage(reason, code);

  // Issue #1431: Drain/unref active handles so the event loop exits naturally.
  // This resolves the root causes of dangling ReadStream (stdin), Socket (undici),
  // ChildProcess (command-stream), and WriteStream (stdout/stderr) handles.
  await drainHandles();

  // Close Sentry to flush any pending events and allow the process to exit cleanly.
  // Use Promise.race with a hard timeout to guarantee sentry.close() never hangs
  // indefinitely — the 2000ms hint passed to sentry.close() is forwarded to internal
  // flush logic, but the outer Promise itself has no built-in deadline, so we enforce one.
  try {
    const sentry = await getSentry();
    if (sentry && sentry.close) {
      await Promise.race([
        sentry.close(2000),
        new Promise(resolve => setTimeout(resolve, 3000)), // hard 3s deadline
      ]);
    }
  } catch {
    // Ignore Sentry.close() errors - exit anyway
  }

  process.exit(code);
};

/**
 * Install global exit handlers to ensure log path is always shown
 */
export const installGlobalExitHandlers = () => {
  // Handle normal exit
  process.on('exit', code => {
    // Synchronous fallback - can't use async here
    if (!exitMessageShown && getLogPathFunction) {
      try {
        // Try to get the current log path synchronously if possible
        const currentLogPath = getLogPathFunction();
        if (currentLogPath && typeof currentLogPath === 'string') {
          console.log('');
          if (code === 0) {
            console.log('✅ Process completed');
          } else {
            console.log(`❌ Process exited with code ${code}`);
          }
          console.log(`📁 Full log file: ${currentLogPath}`);
        }
      } catch {
        // If we can't get the log path synchronously, skip showing it
      }
    }
  });

  // Handle SIGINT (CTRL+C)
  process.on('SIGINT', async () => {
    // Run interrupt handler first (auto-commit, log upload, etc.) — guard against double invocation
    if (interruptFunction && !interruptHandlerRan) {
      interruptHandlerRan = true;
      try {
        await interruptFunction();
      } catch {
        // Ignore interrupt handler errors
      }
    }
    if (cleanupFunction) {
      try {
        await cleanupFunction();
      } catch {
        // Ignore cleanup errors on signal
      }
    }
    await showExitMessage('Interrupted (CTRL+C)', 130);
    try {
      const sentry = await getSentry();
      if (sentry && sentry.close) {
        await Promise.race([sentry.close(2000), new Promise(resolve => setTimeout(resolve, 3000))]);
      }
    } catch {
      // Ignore Sentry.close() errors
    }
    process.exit(130);
  });

  // Handle SIGTERM
  process.on('SIGTERM', async () => {
    if (cleanupFunction) {
      try {
        await cleanupFunction();
      } catch {
        // Ignore cleanup errors on signal
      }
    }
    await showExitMessage('Terminated', 143);
    try {
      const sentry = await getSentry();
      if (sentry && sentry.close) {
        await Promise.race([sentry.close(2000), new Promise(resolve => setTimeout(resolve, 3000))]);
      }
    } catch {
      // Ignore Sentry.close() errors
    }
    process.exit(143);
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', async error => {
    if (cleanupFunction) {
      try {
        await cleanupFunction();
      } catch {
        // Ignore cleanup errors on exception
      }
    }
    if (logFunction) {
      await logFunction(`\n❌ Uncaught Exception: ${error.message}`, { level: 'error' });
    }
    await showExitMessage('Uncaught exception occurred', 1);
    try {
      const sentry = await getSentry();
      if (sentry && sentry.close) {
        await Promise.race([sentry.close(2000), new Promise(resolve => setTimeout(resolve, 3000))]);
      }
    } catch {
      // Ignore Sentry.close() errors
    }
    process.exit(1);
  });

  // Handle unhandled rejections
  process.on('unhandledRejection', async reason => {
    if (cleanupFunction) {
      try {
        await cleanupFunction();
      } catch {
        // Ignore cleanup errors on rejection
      }
    }
    if (logFunction) {
      await logFunction(`\n❌ Unhandled Rejection: ${reason}`, { level: 'error' });
    }
    await showExitMessage('Unhandled rejection occurred', 1);
    try {
      const sentry = await getSentry();
      if (sentry && sentry.close) {
        await Promise.race([sentry.close(2000), new Promise(resolve => setTimeout(resolve, 3000))]);
      }
    } catch {
      // Ignore Sentry.close() errors
    }
    process.exit(1);
  });
};

/**
 * Reset the exit message flag (useful for testing)
 */
export const resetExitHandler = () => {
  exitMessageShown = false;
  interruptHandlerRan = false;
};
