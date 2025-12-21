// Sentry integration library for hive-mind
import { isSentryEnabled, captureException, captureMessage, startTransaction } from './instrument.mjs';

// Lazy import of Sentry to handle cases where it's not installed
let Sentry = null;
const getSentry = async () => {
  if (!Sentry) {
    try {
      Sentry = await import('@sentry/node');
    } catch {
      // Sentry not installed, return null
      return null;
    }
  }
  return Sentry;
};

// Flag to track if Sentry should be disabled
let sentryDisabled = false;

/**
 * Initialize Sentry integration
 * This should be called early in the application lifecycle
 * @param {Object} options - Configuration options
 * @param {boolean} options.noSentry - Disable Sentry if true
 * @param {boolean} options.debug - Enable debug mode
 * @param {string} options.environment - Environment name (production, development, etc)
 */
export const initializeSentry = async (options = {}) => {
  // Check if --no-sentry flag is present
  if (options.noSentry || process.argv.includes('--no-sentry')) {
    sentryDisabled = true;
    if (options.debug) {
      console.log('ℹ️  Sentry is disabled via --no-sentry flag');
    }
    return;
  }

  // Sentry is already initialized in instrument.mjs
  // This function is for additional runtime configuration
  if (isSentryEnabled()) {
    const sentry = await getSentry();
    if (sentry) {
      // Set user context if available
      if (process.env.USER || process.env.USERNAME) {
        sentry.setUser({
          username: process.env.USER || process.env.USERNAME,
        });
      }

      // Set additional tags
      sentry.setTags({
        node_version: process.version,
        platform: process.platform,
        arch: process.arch,
        hive_mind_version: options.version || process.env.npm_package_version || 'unknown',
      });

      if (options.debug) {
        console.log('✅ Sentry integration configured');
      }
    }
  }
};

/**
 * Wrap a function with Sentry error tracking
 * @param {Function} fn - Function to wrap
 * @param {string} name - Name of the operation
 * @param {string} op - Operation type (default: 'task')
 * @returns {Function} Wrapped function
 */
export const withSentry = (fn, name, op = 'task') => {
  return async (...args) => {
    if (!isSentryEnabled() || sentryDisabled) {
      return fn(...args);
    }

    const transaction = startTransaction(name, op);

    try {
      const result = await fn(...args);
      transaction.setStatus('ok');
      return result;
    } catch (error) {
      transaction.setStatus('internal_error');
      captureException(error, {
        operation: name,
        args: args.length > 0 ? `${args.length} arguments` : 'no arguments',
      });
      throw error;
    } finally {
      // In Sentry v10, use end() instead of finish()
      if (transaction.end) {
        transaction.end();
      } else if (transaction.finish) {
        // Fallback for compatibility
        transaction.finish();
      }
    }
  };
};

/**
 * Create a Sentry span for tracking a specific operation
 * @param {string} name - Name of the span
 * @param {Function} callback - Callback to execute within the span
 * @returns {Promise} Result of the callback
 */
export const withSpan = async (name, callback) => {
  if (!isSentryEnabled() || sentryDisabled) {
    return callback();
  }

  const sentry = await getSentry();
  if (!sentry) {
    return callback();
  }

  return sentry.startSpan({
    name,
    op: 'function',
  }, async () => {
    return callback();
  });
};

/**
 * Log a message to Sentry
 * @param {string} message - Message to log
 * @param {string} level - Log level (debug, info, warning, error, fatal)
 * @param {Object} context - Additional context
 */
export const logToSentry = (message, level = 'info', context = {}) => {
  if (!isSentryEnabled() || sentryDisabled) {
    return;
  }

  captureMessage(message, level, context);
};

/**
 * Report an error to Sentry
 * Use this for actual errors that indicate something went wrong
 * @param {Error} error - Error to capture
 * @param {Object} context - Additional context
 */
export const reportError = (error, context = {}) => {
  if (!isSentryEnabled() || sentryDisabled) {
    return;
  }

  captureException(error, { ...context, level: 'error' });
};

/**
 * Report a warning to Sentry
 * Use this for non-critical issues that should be tracked but don't indicate failure
 * @param {string|Error} warning - Warning message or error object
 * @param {Object} context - Additional context
 */
export const reportWarning = (warning, context = {}) => {
  if (!isSentryEnabled() || sentryDisabled) {
    return;
  }

  // Convert string warnings to Error objects for better stack traces
  const warningError = typeof warning === 'string' ? new Error(warning) : warning;
  captureException(warningError, { ...context, level: 'warning' });
};

/**
 * Add breadcrumb for better error context
 * @param {Object} breadcrumb - Breadcrumb data
 */
export const addBreadcrumb = async (breadcrumb) => {
  if (!isSentryEnabled() || sentryDisabled) {
    return;
  }

  const sentry = await getSentry();
  if (sentry) {
    sentry.addBreadcrumb(breadcrumb);
  }
};

/**
 * Set user context for Sentry
 * @param {Object} user - User data
 */
export const setUserContext = async (user) => {
  if (!isSentryEnabled() || sentryDisabled) {
    return;
  }

  const sentry = await getSentry();
  if (sentry) {
    sentry.setUser(user);
  }
};

/**
 * Set extra context for Sentry
 * @param {string} key - Context key
 * @param {any} value - Context value
 */
export const setExtraContext = async (key, value) => {
  if (!isSentryEnabled() || sentryDisabled) {
    return;
  }

  const sentry = await getSentry();
  if (sentry) {
    sentry.setExtra(key, value);
  }
};

/**
 * Set tags for Sentry
 * @param {Object} tags - Tags to set
 */
export const setTags = async (tags) => {
  if (!isSentryEnabled() || sentryDisabled) {
    return;
  }

  const sentry = await getSentry();
  if (sentry) {
    sentry.setTags(tags);
  }
};

/**
 * Flush Sentry events before exit
 * @param {number} timeout - Timeout in milliseconds (default: 2000)
 * @returns {Promise} Promise that resolves when flush is complete
 */
export const flushSentry = async (timeout = 2000) => {
  if (!isSentryEnabled() || sentryDisabled) {
    return;
  }

  const sentry = await getSentry();
  if (!sentry) {
    return;
  }

  try {
    await sentry.flush(timeout);
  } catch (error) {
    // Silently fail if flush fails
    if (process.env.DEBUG === 'true') {
      console.error('Failed to flush Sentry events:', error.message);
    }
  }
};

/**
 * Close Sentry client
 * @param {number} timeout - Timeout in milliseconds (default: 2000)
 * @returns {Promise} Promise that resolves when close is complete
 */
export const closeSentry = async (timeout = 2000) => {
  if (!isSentryEnabled() || sentryDisabled) {
    return;
  }

  const sentry = await getSentry();
  if (!sentry) {
    return;
  }

  try {
    await sentry.close(timeout);
  } catch (error) {
    // Silently fail if close fails
    if (process.env.DEBUG === 'true') {
      console.error('Failed to close Sentry:', error.message);
    }
  }
};

// Export the Sentry check function
export { isSentryEnabled };