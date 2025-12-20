// Lazy-load config only when needed to avoid loading use-m at module initialization
// This prevents network fetches that can hang during --help or --version

// Check if Sentry should be disabled
const shouldDisableSentry = () => {
  // Check for --no-sentry flag
  if (process.argv.includes('--no-sentry')) {
    return true;
  }

  // Check for environment variable
  if (process.env.HIVE_MIND_NO_SENTRY === 'true' || process.env.DISABLE_SENTRY === 'true') {
    return true;
  }

  // Check for CI environment (disable in CI by default)
  if (process.env.CI === 'true') {
    return true;
  }

  // Disable Sentry for quick commands that don't need error tracking
  // This prevents Sentry's profiling integration from blocking process exit
  if (process.argv.includes('--help') || process.argv.includes('-h') || process.argv.includes('--version')) {
    return true;
  }

  // Disable Sentry for dry-run mode to avoid unnecessary network calls that might fail
  // This prevents config.lib.mjs from loading use-m from CDN in testing scenarios
  if (process.argv.includes('--dry-run')) {
    return true;
  }

  return false;
};

// Lazily import Sentry only if needed
// This prevents the Sentry packages from keeping the event loop alive when not needed
let Sentry = null;
let nodeProfilingIntegration = null;

// Initialize Sentry if not disabled
if (!shouldDisableSentry()) {
  try {
    // Dynamically import config only when Sentry is actually being initialized
    // This avoids loading use-m before command-line arguments are processed
    const { sentry, version } = await import('./config.lib.mjs');

    // Dynamically import Sentry packages only when needed
    // eslint-disable-next-line quotes
    const sentryModule = await import("@sentry/node");
    Sentry = sentryModule;
    // eslint-disable-next-line quotes
    const profilingModule = await import("@sentry/profiling-node");
    nodeProfilingIntegration = profilingModule.nodeProfilingIntegration;

    // Initialize Sentry with configuration
    Sentry.init({
      dsn: sentry.dsn,
      integrations: [
        nodeProfilingIntegration(),
      ],

      // Application name
      environment: process.env.NODE_ENV || 'production',
      release: `hive-mind@${process.env.npm_package_version || version.default}`,

      // Send structured logs to Sentry
      enableLogs: true,

      // Tracing
      tracesSampleRate: process.env.NODE_ENV === 'development' ? sentry.tracesSampleRateDev : sentry.tracesSampleRateProd,

      // Set sampling rate for profiling
      profileSessionSampleRate: process.env.NODE_ENV === 'development' ? sentry.profileSessionSampleRateDev : sentry.profileSessionSampleRateProd,

      // Trace lifecycle automatically enables profiling during active traces
      profileLifecycle: 'trace',

      // Setting this option to true will send default PII data to Sentry
      sendDefaultPii: false, // Disabled for privacy

      // Set debug mode based on environment
      debug: process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development',

      // Before send hook to filter out sensitive data
      beforeSend(event) {
        // Filter out sensitive environment variables
        if (event.contexts && event.contexts.runtime && event.contexts.runtime.env) {
          const sensitiveKeys = ['API_KEY', 'TOKEN', 'SECRET', 'PASSWORD', 'ANTHROPIC'];
          Object.keys(event.contexts.runtime.env).forEach(key => {
            if (sensitiveKeys.some(sensitive => key.includes(sensitive))) {
              delete event.contexts.runtime.env[key];
            }
          });
        }

        // Filter out sensitive data from extra context
        if (event.extra) {
          const sensitiveKeys = ['api_key', 'token', 'secret', 'password'];
          Object.keys(event.extra).forEach(key => {
            if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
              delete event.extra[key];
            }
          });
        }

        return event;
      },

      // Integration specific options
      ignoreErrors: [
        // Ignore specific errors that are expected or not relevant
        'ECONNRESET',
        'ETIMEDOUT',
        'ENOTFOUND',
        /^NetworkError/,
        /^TimeoutError/,
      ],

      // Transaction name
      beforeTransaction(context) {
        // Customize transaction names to be more meaningful
        if (context.name && context.name.startsWith('hive-mind')) {
          return context;
        }
        context.name = `hive-mind.${context.name || 'unknown'}`;
        return context;
      }
    });

    // Log that Sentry has been initialized
    if (process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development') {
      console.log('✅ Sentry initialized successfully');
    }
  } catch (error) {
    // Sentry packages not installed or initialization failed - silently continue without Sentry
    // This is expected in some environments (e.g., CI, development without npm install)
    if (process.env.DEBUG === 'true') {
      console.warn('Warning: Sentry initialization failed:', error.message);
    }
    Sentry = null;
  }
} else {
  // Log that Sentry is disabled
  if (process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development') {
    console.log('ℹ️  Sentry is disabled (--no-sentry flag or environment variable detected)');
  }
}

// Export Sentry for use in other modules (may be null if disabled)
export default Sentry;

// Export utility function to check if Sentry is enabled
export const isSentryEnabled = () => Sentry !== null && Sentry.getClient() !== undefined;

// Export function to safely capture exceptions
export const captureException = (error, context = {}) => {
  if (isSentryEnabled()) {
    Sentry.captureException(error, {
      extra: context
    });
  }
};

// Export function to safely capture messages
export const captureMessage = (message, level = 'info', context = {}) => {
  if (isSentryEnabled()) {
    Sentry.captureMessage(message, level, {
      extra: context
    });
  }
};

// Export function to create a transaction
// Note: In Sentry v10, startTransaction is deprecated in favor of startSpan
export const startTransaction = (name, op = 'task') => {
  if (isSentryEnabled()) {
    // Use startInactiveSpan for manual transaction control (similar to old startTransaction)
    return Sentry.startInactiveSpan({
      op,
      name,
    });
  }
  // Return a dummy transaction object if Sentry is disabled
  return {
    finish: () => {},
    end: () => {},
    setStatus: () => {},
    setData: () => {},
  };
};