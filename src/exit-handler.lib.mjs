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

/**
 * Initialize the exit handler with required dependencies
 * @param {Function} getLogPath - Function that returns the current log path
 * @param {Function} log - Logging function
 * @param {Function} cleanup - Optional cleanup function to call on exit
 */
export const initializeExitHandler = (getLogPath, log, cleanup = null) => {
  getLogPathFunction = getLogPath;
  logFunction = log;
  cleanupFunction = cleanup;
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
 * Safe exit function that ensures log path is shown
 */
export const safeExit = async (code = 0, reason = 'Process completed') => {
  await showExitMessage(reason, code);

  // Close Sentry to flush any pending events and allow the process to exit cleanly
  try {
    const sentry = await getSentry();
    if (sentry && sentry.close) {
      await sentry.close(2000); // Wait up to 2 seconds for pending events to be sent
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
  process.on('exit', (code) => {
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
        await sentry.close(2000);
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
        await sentry.close(2000);
      }
    } catch {
      // Ignore Sentry.close() errors
    }
    process.exit(143);
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
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
        await sentry.close(2000);
      }
    } catch {
      // Ignore Sentry.close() errors
    }
    process.exit(1);
  });

  // Handle unhandled rejections
  process.on('unhandledRejection', async (reason) => {
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
        await sentry.close(2000);
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
};