#!/usr/bin/env node
import { ensureUseM } from './use-m-bootstrap.lib.mjs';
import { createCredentialStreamSanitizer, maskToken, sanitizeCredentialText } from './credential-sanitization-core.lib.mjs';
import { recordLogBytes, resetLogGrowth } from './log-growth.lib.mjs'; // issue #2135: notice a session log that is running away
import { isPlaceholderErrorText } from './error-text.lib.mjs'; // issue #2141: never publish "[object Object]" as a reason
import { describeTransientError, formatTransientDiagnostics, isTransientNetworkError as isTransientNetworkErrorShared } from './transient-errors.lib.mjs'; // issue #2168: one shared transient-fault vocabulary for git + gh

export { maskToken };

// Shared library functions for hive-mind project

// Try to import reportError and reportWarning from sentry.lib.mjs, but make it optional
// This allows the module to work even when @sentry/node is not installed
let reportError = null;
let reportWarning = null;
try {
  const sentryModule = await import('./sentry.lib.mjs');
  reportError = sentryModule.reportError;
  reportWarning = sentryModule.reportWarning;
} catch (_error) {
  // Sentry module not available, create no-op functions
  if (global.verboseMode) {
    console.debug('Sentry module not available:', _error?.message || 'Import failed');
  }
  reportError = err => {
    // Silent no-op when Sentry is not available
    if (global.verboseMode) {
      console.debug('Sentry not available for error reporting:', err?.message);
    }
  };
  reportWarning = () => {
    // Silent no-op when Sentry is not available
    if (global.verboseMode) {
      console.debug('Sentry not available for warning reporting');
    }
  };
}

// Check if use is already defined (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  await ensureUseM();
}

const fsModule = await use('fs');
const fs = fsModule.promises;

// Global reference for log file (can be set by importing module)
export let logFile = null;

/**
 * Set the log file path
 * @param {string} path - Path to the log file
 */
export const setLogFile = path => {
  logFile = path;
  resetLogGrowth(); // issue #2135: a new log starts its growth accounting over
};

/**
 * Issue #2135: count what is written to the session log and say so once the
 * total stops being reasonable. Called from every append path below.
 *
 * The warning is emitted with console.warn rather than log(): these call sites
 * are inside the append paths themselves, and console output is captured into
 * the same log by the stdio interceptor, so the evidence lands in the log that
 * is misbehaving.
 *
 * @param {string} appendedText - exactly what was appended, including newline.
 */
const noteLogBytesWritten = appendedText => {
  const warning = recordLogBytes(Buffer.byteLength(appendedText));
  if (warning) console.warn(warning);
};

/**
 * Get the current log file path
 * @returns {string|null} Current log file path or null
 */
export const getLogFile = () => {
  return logFile;
};

/**
 * Get the absolute log file path
 * @returns {Promise<string|null>} Absolute path to log file or null
 */
export const getAbsoluteLogPath = async () => {
  if (!logFile) return null;
  const path = await use('path');
  return path.resolve(logFile);
};

/**
 * Log messages to both console and file
 * @param {string} message - The message to log
 * @param {Object} options - Logging options
 * @param {string} [options.level='info'] - Log level (info, warn, error)
 * @param {boolean} [options.verbose=false] - Whether this is a verbose log
 * @param {string} [options.stream] - Provenance of the message when it is raw
 *   output mirrored from a child process: 'stdout' or 'stderr'. Tags the log
 *   file lines [STDOUT]/[STDERR] (matching the process.stdout/stderr
 *   interceptor below) and routes the console write to the same stream.
 * @returns {Promise<void>}
 */
export const log = async (message, options = {}) => {
  const { level = 'info', verbose = false, stream = null } = options;

  // Skip verbose logs unless --verbose is enabled
  if (verbose && !global.verboseMode) {
    return;
  }

  const sanitizedMessage = sanitizeCredentialText(message);

  // Issue #2140: mirrored child output must stay attributable to the stream it
  // came from. Both Codex streams used to be written as plain [INFO], so a run
  // log could not answer "did Codex emit this protocol line, or did its stderr
  // merely echo one?" — the exact question a false completion failure hinges on.
  // An explicit level still wins, so warnings/errors keep their own tag.
  const mirroredStream = stream === 'stdout' || stream === 'stderr' ? stream : null;
  const tag = mirroredStream && level === 'info' ? mirroredStream.toUpperCase() : level.toUpperCase();

  // Write to file if log file is set
  // Issue #1572: Handle multi-line messages by timestamping each line,
  // so continuation lines don't appear without timestamps in the log file
  if (logFile) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${tag}]`;
    const lines = sanitizedMessage.split('\n');
    const logMessage = lines.map(line => `${prefix} ${line}`).join('\n');
    try {
      await fs.appendFile(logFile, logMessage + '\n', { mode: 0o600 });
      await fs.chmod(logFile, 0o600);
      noteLogBytesWritten(logMessage + '\n');
    } catch (error) {
      // Silent fail for file append errors to avoid infinite loop
      // but report to Sentry in verbose mode
      if (global.verboseMode) {
        reportError(error, {
          context: 'log_file_append',
          level: 'debug',
          logFile,
        });
      }
    }
  }

  // Write to console based on level
  // Set guard flag to prevent stdio interceptor from double-logging (issue #1549)
  _writingFromLog = true;
  try {
    switch (level) {
      case 'error':
        console.error(sanitizedMessage);
        break;
      case 'warning':
      case 'warn':
        console.warn(sanitizedMessage);
        break;
      case 'info':
      default:
        // Mirrored child stderr goes to our stderr, so piping stdout to a
        // consumer keeps yielding only what the child wrote to stdout.
        if (mirroredStream === 'stderr') console.error(sanitizedMessage);
        else console.log(sanitizedMessage);
        break;
    }
  } finally {
    _writingFromLog = false;
  }
};

/**
 * Issue #1466: Intercept console.log to capture [VERBOSE] output in the log file.
 *
 * Functions in github-merge.lib.mjs and github-merge-ci.lib.mjs use console.log()
 * directly for verbose output (e.g., `console.log('[VERBOSE] /merge: ...')`).
 * This means verbose diagnostic data only appears in the terminal, not in log files,
 * making debugging harder.
 *
 * This interceptor wraps console.log so that any message containing '[VERBOSE]'
 * is also appended to the log file. It preserves the original console.log behavior.
 *
 * Call this once after setLogFile() to enable the interceptor.
 */
let verboseInterceptorInstalled = false;
export const setupVerboseLogInterceptor = () => {
  if (verboseInterceptorInstalled) return;
  verboseInterceptorInstalled = true;

  const originalConsoleLog = console.log.bind(console);
  console.log = (...args) => {
    // If a log file is set and the message looks like a [VERBOSE] log, append to file
    // and set guard flag to prevent stdio interceptor from double-logging (issue #1549)
    if (logFile && args.length > 0) {
      const firstArg = String(args[0]);
      if (firstArg.includes('[VERBOSE]')) {
        const message = sanitizeCredentialText(args.map(a => String(a)).join(' '));
        const logMessage = `[${new Date().toISOString()}] [VERBOSE] ${message}`;
        _writingFromLog = true;
        fs.appendFile(logFile, logMessage + '\n', { mode: 0o600 })
          .then(() => fs.chmod(logFile, 0o600))
          .catch(() => {
            // Silent fail to avoid infinite loops
          });
      }
    }

    // Always call original console.log (with guard flag set if [VERBOSE])
    try {
      originalConsoleLog(...args.map(value => (typeof value === 'string' || Buffer.isBuffer(value) ? sanitizeCredentialText(value) : value)));
    } finally {
      _writingFromLog = false;
    }
  };
};

/**
 * Issue #1549: Intercept process.stdout.write and process.stderr.write to capture
 * ALL terminal output in the log file, ensuring 100% parity between terminal and log.
 *
 * The command-stream library uses process.stdout.write/process.stderr.write directly
 * when mirror:true (the default). console.log/console.error also end up calling these.
 * By intercepting at the write() level, we capture everything regardless of source:
 * - command-stream mirror output (e.g., gh CLI JSON responses)
 * - console.log() / console.error() calls
 * - process.stdout.write() / process.stderr.write() direct calls
 *
 * To avoid double-logging (since the log() function already writes to the log file AND
 * calls console.log which calls process.stdout.write), we use a guard flag
 * `_writingFromLog` to skip interception when the write originates from log().
 *
 * This ensures the log file is a complete record of all terminal output.
 * Call this once after setLogFile() to enable the interceptor.
 */
let stdioInterceptorInstalled = false;
let _writingFromLog = false; // Guard flag to prevent double-logging from log()
let stdoutBroken = false;
let stderrBroken = false;
let brokenPipeDiagnosticsWritten = false;

const isBrokenPipeError = error => {
  return error?.code === 'EPIPE' || error?.code === 'ERR_STREAM_DESTROYED';
};

const invokeWriteCallback = (callback, error = null) => {
  if (typeof callback === 'function') {
    callback(error);
  }
};

const appendInternalDiagnostic = async message => {
  if (!logFile) return;
  const prefix = `[${new Date().toISOString()}] [INTERNAL]`;
  await fs
    .appendFile(logFile, `${prefix} ${sanitizeCredentialText(message)}\n`, { mode: 0o600 })
    .then(() => fs.chmod(logFile, 0o600))
    .catch(() => {
      // Silent fail to avoid recursive logging errors
    });
};

const formatStreamDiagnostic = stream => {
  return JSON.stringify({
    isTTY: Boolean(stream?.isTTY),
    destroyed: Boolean(stream?.destroyed),
    writable: stream?.writable,
    writableEnded: Boolean(stream?.writableEnded),
    writableFinished: Boolean(stream?.writableFinished),
    errored: stream?.errored?.code || stream?.errored?.message || null,
    fd: typeof stream?.fd === 'number' ? stream.fd : null,
  });
};

const normalizeWriteCallback = (encoding, callback) => {
  return typeof encoding === 'function' ? encoding : callback;
};

const safeTerminalWrite = ({ originalWrite, chunk, encoding, callback, streamName }) => {
  const isStdout = streamName === 'stdout';
  const normalizedCallback = normalizeWriteCallback(encoding, callback);
  if ((isStdout && stdoutBroken) || (!isStdout && stderrBroken)) {
    invokeWriteCallback(normalizedCallback);
    return false;
  }

  try {
    return originalWrite(chunk, encoding, callback);
  } catch (error) {
    if (!isBrokenPipeError(error)) {
      throw error;
    }

    if (isStdout) {
      stdoutBroken = true;
    } else {
      stderrBroken = true;
    }

    invokeWriteCallback(normalizedCallback, error);
    return false;
  }
};

const installBrokenPipeGuard = (stream, streamName) => {
  stream.on('error', error => {
    if (isBrokenPipeError(error)) {
      if (streamName === 'stdout') {
        stdoutBroken = true;
      } else {
        stderrBroken = true;
      }
      if (!brokenPipeDiagnosticsWritten) {
        brokenPipeDiagnosticsWritten = true;
        void appendInternalDiagnostic(`Detected broken ${streamName} stream (${error.code || 'unknown'}). Stream state=${formatStreamDiagnostic(stream)}. Further terminal writes will be skipped when possible.`);
      }
      return;
    }

    throw error;
  });
};

export const setupStdioLogInterceptor = () => {
  if (stdioInterceptorInstalled) return;
  stdioInterceptorInstalled = true;

  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const stdoutSanitizer = createCredentialStreamSanitizer();
  const stderrSanitizer = createCredentialStreamSanitizer();
  installBrokenPipeGuard(process.stdout, 'stdout');
  installBrokenPipeGuard(process.stderr, 'stderr');

  // Node does not guarantee that the final write contains a newline. Flush
  // retained records on both graceful and explicit exits so buffering never
  // drops the sanitized tail of terminal output or its persistent log.
  const flushPendingRecord = (sanitizer, originalWrite, streamName) => {
    const sanitizedChunk = sanitizer.flush();
    if (!sanitizedChunk) return;
    try {
      originalWrite(sanitizedChunk);
    } catch (error) {
      if (!isBrokenPipeError(error)) throw error;
    }
    if (logFile && sanitizedChunk.trim()) {
      try {
        const logMessage = `[${new Date().toISOString()}] [${streamName.toUpperCase()}] ${sanitizedChunk}`;
        fsModule.appendFileSync(logFile, logMessage + (sanitizedChunk.endsWith('\n') ? '' : '\n'), { mode: 0o600 });
        fsModule.chmodSync(logFile, 0o600);
      } catch {
        // Exit-time logging cannot safely report another error.
      }
    }
  };
  const flushPendingOutput = () => {
    flushPendingRecord(stdoutSanitizer, originalStdoutWrite, 'stdout');
    flushPendingRecord(stderrSanitizer, originalStderrWrite, 'stderr');
  };
  process.once('beforeExit', flushPendingOutput);
  process.once('exit', flushPendingOutput);

  process.stdout.write = (chunk, encoding, callback) => {
    const normalizedCallback = normalizeWriteCallback(encoding, callback);
    const sanitizedChunk = stdoutSanitizer.write(chunk);
    if (!sanitizedChunk) {
      invokeWriteCallback(normalizedCallback);
      return true;
    }

    // Write only the completed, sanitized record to the terminal.
    const result = safeTerminalWrite({
      originalWrite: originalStdoutWrite,
      chunk: sanitizedChunk,
      encoding,
      callback,
      streamName: 'stdout',
    });

    // Also append to log file if set, but skip if this write originated from log()
    if (logFile && !_writingFromLog) {
      const text = sanitizedChunk;
      if (text.trim()) {
        const logMessage = `[${new Date().toISOString()}] [STDOUT] ${text.replace(/\n$/, '')}`;
        fs.appendFile(logFile, logMessage + '\n', { mode: 0o600 })
          .then(() => fs.chmod(logFile, 0o600))
          .then(() => noteLogBytesWritten(logMessage + '\n')) // issue #2135
          .catch(() => {
            // Silent fail to avoid infinite loops
          });
      }
    }

    return result;
  };

  process.stderr.write = (chunk, encoding, callback) => {
    const normalizedCallback = normalizeWriteCallback(encoding, callback);
    const sanitizedChunk = stderrSanitizer.write(chunk);
    if (!sanitizedChunk) {
      invokeWriteCallback(normalizedCallback);
      return true;
    }

    // Write only the completed, sanitized record to the terminal.
    const result = safeTerminalWrite({
      originalWrite: originalStderrWrite,
      chunk: sanitizedChunk,
      encoding,
      callback,
      streamName: 'stderr',
    });

    // Also append to log file if set, but skip if this write originated from log()
    if (logFile && !_writingFromLog) {
      const text = sanitizedChunk;
      if (text.trim()) {
        const logMessage = `[${new Date().toISOString()}] [STDERR] ${text.replace(/\n$/, '')}`;
        fs.appendFile(logFile, logMessage + '\n', { mode: 0o600 })
          .then(() => fs.chmod(logFile, 0o600))
          .then(() => noteLogBytesWritten(logMessage + '\n')) // issue #2135
          .catch(() => {
            // Silent fail to avoid infinite loops
          });
      }
    }

    return result;
  };
};

/**
 * Format timestamps for use in filenames
 * @param {Date} [date=new Date()] - Date to format
 * @returns {string} Formatted timestamp
 */
export const formatTimestamp = (date = new Date()) => {
  return date.toISOString().replace(/[:.]/g, '-');
};

/**
 * Create safe file names from arbitrary strings
 * @param {string} name - Name to sanitize
 * @returns {string} Sanitized filename
 */
export const sanitizeFileName = name => {
  return name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
};

/**
 * Check if running in specific runtime
 * @returns {string} Runtime name (node, bun, or deno)
 */
export const getRuntime = () => {
  if (typeof Bun !== 'undefined') return 'bun';
  if (typeof Deno !== 'undefined') return 'deno';
  return 'node';
};

/**
 * Get platform information
 * @returns {Object} Platform information object
 */
export const getPlatformInfo = () => {
  return {
    platform: process.platform,
    arch: process.arch,
    runtime: getRuntime(),
    nodeVersion: process.versions?.node,
    bunVersion: process.versions?.bun,
  };
};

/**
 * Safely parse JSON with fallback
 * @param {string} text - JSON string to parse
 * @param {*} [defaultValue=null] - Default value if parsing fails
 * @returns {*} Parsed JSON or default value
 */
export const safeJsonParse = (text, defaultValue = null) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    // This is intentionally silent as it's a safe parse with fallback
    // Only report in verbose mode for debugging
    if (global.verboseMode) {
      reportError(error, {
        context: 'safe_json_parse',
        level: 'debug',
        textPreview: text?.substring(0, 100),
      });
    }
    return defaultValue;
  }
};

/**
 * Sleep/delay execution
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retry operations with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {Object} options - Retry options
 * @param {number} [options.maxAttempts=3] - Maximum number of attempts
 * @param {number} [options.delay=1000] - Initial delay between retries in ms
 * @param {number} [options.backoff=2] - Backoff multiplier
 * @returns {Promise<*>} Result of successful function execution
 * @throws {Error} Last error if all attempts fail
 */
export const retry = async (fn, options = {}) => {
  const { maxAttempts = 3, delay = 1000, backoff = 2 } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // Report error to Sentry with retry context
      reportError(error, {
        context: 'retry_operation',
        attempt,
        maxAttempts,
        willRetry: attempt < maxAttempts,
      });

      if (attempt === maxAttempts) throw error;

      const waitTime = delay * Math.pow(backoff, attempt - 1);
      await log(`Attempt ${attempt} failed, retrying in ${waitTime}ms...`, { level: 'warn' });
      await sleep(waitTime);
    }
  }
};

/**
 * Check if an error is a transient network error that can be retried.
 * Used by validateForkParent to detect network timeouts (Issue #1311).
 *
 * Issue #1536 added 'unexpected eof' (gh CLI dropping mid-response);
 * issue #1957 added the git fetch-pack/sideband disconnect patterns;
 * issue #2168 moved the whole vocabulary into
 * `src/transient-errors.lib.mjs` so `github-rate-limit.lib.mjs` and this
 * module can no longer drift apart. This re-export is kept so the many
 * existing `lib.isTransientNetworkError(...)` call sites keep working.
 *
 * @param {Error|string} error - The error to check
 * @returns {boolean} True if the error is transient and retryable
 */
export const isTransientNetworkError = error => isTransientNetworkErrorShared(error);

/**
 * Retry a GitHub CLI / API operation with exponential backoff on transient network errors.
 * Unlike the generic `retry()`, this function:
 * - Retries on transient network errors (TCP reset, TLS timeout, etc.)
 * - Retries on GitHub API rate-limit errors, sleeping until reset + buffer + jitter
 *   (issue #1726 — see src/github-rate-limit.lib.mjs)
 * - Immediately rethrows non-transient errors (404, 403 non-rate-limit, auth failures)
 * - Logs stderr to the log file when a command fails (fixing terminal/log parity)
 *
 * Issue #1536: Most gh commands had no retry logic, causing solve to abort on
 * intermittent network issues.
 * Issue #1726: Rate limit errors silently surfaced as command failure with no retry,
 *              causing the merge subsystem to swallow them as "no workflows found".
 *
 * @param {Function} fn - Async function to execute (should call gh CLI or GitHub API)
 * @param {Object} [options] - Options
 * @param {number} [options.maxAttempts=3] - Maximum number of attempts
 * @param {number} [options.delay=1000] - Initial delay between retries in ms
 * @param {number} [options.backoff=2] - Backoff multiplier
 * @param {string} [options.label='gh command'] - Label for log messages
 * @returns {Promise<*>} Result of successful function execution
 * @throws {Error} Last error if all attempts fail or error is non-transient
 */
export const ghRetry = async (fn, options = {}) => {
  const { maxAttempts = 3, delay = 1000, backoff = 2, label = 'gh command' } = options;
  const { isRateLimitError, parseRateLimitReset, fetchNextRateLimitReset, computeRateLimitWait } = await import('./github-rate-limit.lib.mjs');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (isRateLimitError(error) && attempt < maxAttempts) {
        const reset = parseRateLimitReset(error) || (await fetchNextRateLimitReset());
        const { waitMs, deadline, bufferMs, jitterMs } = computeRateLimitWait(reset);
        const resetSummary = reset ? `reset at ${reset.toISOString()}` : 'reset time unknown';
        await log(`⏳ ${label}: GitHub API rate limit hit (attempt ${attempt}/${maxAttempts}). Waiting ${Math.round(waitMs / 60000)} min (${resetSummary}; buffer ${Math.round(bufferMs / 60000)} min + jitter ${Math.round(jitterMs / 1000)}s) until ${deadline.toISOString()}.`, { level: 'warn' });
        await sleep(waitMs);
        continue;
      }
      // Issue #2168: always record the classification, so a failure that was
      // NOT retried leaves the reason (and GitHub's request id) in the log.
      const description = describeTransientError(error);
      if (description.transient && attempt < maxAttempts) {
        const waitTime = delay * Math.pow(backoff, attempt - 1);
        await log(`⚠️ ${label}: transient error (attempt ${attempt}/${maxAttempts}), retrying in ${waitTime / 1000}s... [${formatTransientDiagnostics(description)}]`, { level: 'warn' });
        await sleep(waitTime);
        continue;
      }
      await log(`   ${label}: not retrying [${formatTransientDiagnostics(description)}] attempt=${attempt}/${maxAttempts}`, { verbose: true });
      throw error;
    }
  }
};

/**
 * Execute a command-stream `$` call with retry on transient network errors.
 * This wraps the pattern: call $`gh ...`, check exit code, handle errors.
 * On failure, stderr is logged to the log file (fixing terminal/log parity from issue #1536).
 *
 * @param {Function} cmdFn - Function that returns a command-stream result (e.g., () => $`gh api ...`)
 * @param {Object} [options] - Options
 * @param {number} [options.maxAttempts=3] - Maximum number of attempts
 * @param {number} [options.delay=1000] - Initial delay between retries in ms
 * @param {number} [options.backoff=2] - Backoff multiplier
 * @param {string} [options.label='gh command'] - Label for log messages
 * @returns {Promise<{stdout: string, stderr: string, code: number}>} Command result
 */
export const ghCmdRetry = async (cmdFn, options = {}) => {
  const { maxAttempts = 3, delay = 1000, backoff = 2, label = 'gh command' } = options;
  const { isRateLimitError, parseRateLimitReset, fetchNextRateLimitReset, computeRateLimitWait } = await import('./github-rate-limit.lib.mjs');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await cmdFn();

    // Log stderr to log file for parity (issue #1536)
    const stderr = result.stderr?.toString().trim();
    if (stderr && result.code !== 0) {
      await log(`   [stderr] ${stderr}`, { level: 'warn' });
    }

    if (result.code === 0) {
      return result;
    }

    const combinedOutput = (result.stdout?.toString() || '') + ' ' + (result.stderr?.toString() || '');
    const errorLike = { message: combinedOutput, stdout: result.stdout, stderr: result.stderr };

    // Issue #1726: rate-limit errors deserve a long, deterministic wait.
    if (isRateLimitError(errorLike) && attempt < maxAttempts) {
      const reset = parseRateLimitReset(errorLike) || (await fetchNextRateLimitReset());
      const { waitMs, deadline, bufferMs, jitterMs } = computeRateLimitWait(reset);
      const resetSummary = reset ? `reset at ${reset.toISOString()}` : 'reset time unknown';
      await log(`⏳ ${label}: GitHub API rate limit hit (attempt ${attempt}/${maxAttempts}). Waiting ${Math.round(waitMs / 60000)} min (${resetSummary}; buffer ${Math.round(bufferMs / 60000)} min + jitter ${Math.round(jitterMs / 1000)}s) until ${deadline.toISOString()}.`, { level: 'warn' });
      await sleep(waitMs);
      continue;
    }

    // Check if this is a transient network / GitHub-server error worth retrying
    // (issue #2168 — the classification is logged either way so the next
    // failure of this kind is diagnosable from the session log alone).
    const description = describeTransientError(errorLike);
    if (description.transient && attempt < maxAttempts) {
      const waitTime = delay * Math.pow(backoff, attempt - 1);
      await log(`⚠️ ${label}: transient error (attempt ${attempt}/${maxAttempts}), retrying in ${waitTime / 1000}s... [${formatTransientDiagnostics(description)}]`, { level: 'warn' });
      await sleep(waitTime);
      continue;
    }

    await log(`   ${label}: not retrying [${formatTransientDiagnostics(description)}] attempt=${attempt}/${maxAttempts} exit=${result.code}`, { verbose: true });

    // Non-transient error or last attempt — return the result as-is
    return result;
  }
};

/**
 * Execute a git command-stream `$` call with retry on transient transport
 * errors. The git analogue of `ghCmdRetry`.
 *
 * Issue #2168: `gh` calls have been retry-wrapped since #1536/#1726/#1756, but
 * the network-facing *git* operations (`git push`, `git fetch`, `git clone`)
 * were still single-shot — a dropped pack transfer or a GitHub 5xx on the
 * smart-HTTP endpoint aborted the run exactly like the GraphQL error did.
 *
 * Semantics match `ghCmdRetry` deliberately so call sites need only wrap the
 * existing expression in a thunk: the resolved command-stream result object is
 * returned unchanged for success, for non-transient failures, and for the
 * final attempt. Nothing throws that would not have thrown before.
 *
 * Retries are only issued for errors classified as transient by
 * `src/transient-errors.lib.mjs`, so genuinely terminal outcomes
 * (`non-fast-forward`, `Permission ... denied`, `repository is archived`)
 * still surface immediately and keep their existing dedicated handling.
 *
 * @param {Function} cmdFn - Thunk returning a command-stream result, e.g. `() => $({ cwd })\`git push origin main\``
 * @param {Object} [options]
 * @param {number} [options.maxAttempts] - Maximum number of attempts (default `retryLimits.maxGitRetries`)
 * @param {number} [options.delay=2000] - Initial delay between retries in ms
 * @param {number} [options.backoff] - Backoff multiplier (default `retryLimits.retryBackoffMultiplier`)
 * @param {string} [options.label='git command'] - Label for log messages
 * @returns {Promise<{stdout: *, stderr: *, code: number}>} Command result
 */
export const gitCmdRetry = async (cmdFn, options = {}) => {
  const { retryLimits } = await import('./config.lib.mjs');
  const { maxAttempts = retryLimits.maxGitRetries, delay = 2000, backoff = retryLimits.retryBackoffMultiplier, label = 'git command' } = options;

  let result;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    result = await cmdFn();

    if (result?.code === 0) return result;

    // `2>&1` is the prevailing idiom at these call sites, so the diagnosis
    // text can be on either stream.
    const combinedOutput = `${result?.stdout?.toString() || ''}\n${result?.stderr?.toString() || ''}`;
    const description = describeTransientError({ message: combinedOutput });

    if (description.transient && attempt < maxAttempts) {
      const waitTime = delay * Math.pow(backoff, attempt - 1);
      await log(`⚠️ ${label}: transient git error (attempt ${attempt}/${maxAttempts}), retrying in ${Math.round(waitTime / 1000)}s... [${formatTransientDiagnostics(description)}]`, { level: 'warn' });
      await sleep(waitTime);
      continue;
    }

    await log(`   ${label}: not retrying [${formatTransientDiagnostics(description)}] attempt=${attempt}/${maxAttempts} exit=${result?.code}`, { verbose: true });
    return result;
  }
  return result;
};

/**
 * Format bytes to human readable string
 * @param {number} bytes - Number of bytes
 * @param {number} [decimals=2] - Number of decimal places
 * @returns {string} Formatted size string
 */
export const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

/**
 * Measure execution time of async functions
 * @param {Function} fn - Function to measure
 * @param {string} [label='Operation'] - Label for the operation
 * @returns {Promise<*>} Result of the function
 * @throws {Error} Error from the function if it fails
 */
export const measureTime = async (fn, label = 'Operation') => {
  const start = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - start;
    await log(`${label} completed in ${duration}ms`, { verbose: true });
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    await log(`${label} failed after ${duration}ms`, { level: 'error' });
    reportError(error, {
      context: 'measure_time',
      operation: label,
      duration,
    });
    throw error;
  }
};

/**
 * Check if an error is an ENOSPC (no space left on device) error
 * Issue #1212: ENOSPC errors need specific handling because they cascade
 * (once disk is full, all operations fail) and require user action (cleanup).
 * @param {Error|string} error - Error object or message
 * @returns {boolean} True if the error is an ENOSPC error
 */
export const isENOSPC = error => {
  if (!error) return false;
  const message = error?.message || (typeof error === 'string' ? error : '');
  const lowerMessage = message.toLowerCase();
  return (
    error?.code === 'ENOSPC' ||
    message.includes('ENOSPC') ||
    lowerMessage.includes('no space left on device') ||
    // Issue #1211: git clone ENOSPC patterns — "unable to write file" and
    // "cannot create directory" occur when disk fills during checkout
    (lowerMessage.includes('unable to write file') && lowerMessage.includes('error')) ||
    (lowerMessage.includes('cannot create directory') && lowerMessage.includes('no space left'))
  );
};

/**
 * Clean up error messages for better user experience
 * @param {Error|string} error - Error object or message
 * @returns {string} Cleaned error message
 */
export const cleanErrorMessage = error => {
  let message = error.message || error.toString();

  // Remove common noise from error messages
  message = message.split('\n')[0]; // Take only first line
  message = message.replace(/^Command failed: /, ''); // Remove "Command failed: " prefix
  message = message.replace(/^Error: /, ''); // Remove redundant "Error: " prefix
  message = message.replace(/^\/bin\/sh: \d+: /, ''); // Remove shell path info

  return message;
};

/**
 * Decide whether a string looks like a meaningful, human-readable error message
 * rather than a stray structural fragment (Issue #1941).
 *
 * When a tool process is interrupted mid-stream (CTRL+C / SIGINT) or killed, the
 * last captured stdout line can be a lone JSON-structural character left over
 * from a truncated stream — for example a bare `}` or `{`. Surfacing that as the
 * "core error" produced nonsense failure messages such as
 * "CLAUDE execution failed with }" / "failed by {". A real error message always
 * contains at least one letter or digit (in any script), so we treat fragments
 * that contain none as not meaningful.
 *
 * @param {*} value - Candidate error string
 * @returns {boolean} True when the value contains usable error text
 */
export const isMeaningfulErrorText = value => {
  if (!value || typeof value !== 'string') return false;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return false;
  // Issue #2141: "[object Object]" has letters, but it is the *absence* of an
  // error message — a structured payload that was stringified by mistake.
  if (isPlaceholderErrorText(collapsed)) return false;
  // Require at least one Unicode letter or number; pure punctuation/brackets
  // (e.g. "}", "{", "[]", ",") are stream fragments, not real errors.
  return /[\p{L}\p{N}]/u.test(collapsed);
};

/**
 * Build a clean tool error message for `errorInfo.message`, rejecting
 * meaningless stream fragments (Issue #1941).
 *
 * Picks the tool-reported `lastMessage` only when it is meaningful; otherwise
 * falls back to an interrupt label (exit code 130 = SIGINT/CTRL+C) or the
 * provided generic fallback. This keeps junk like a lone `}` out of the stored
 * error so every downstream surface (GitHub comment, terminal, retry logic)
 * shows something honest.
 *
 * @param {Object} options
 * @param {string} [options.lastMessage] - The last message captured from the tool stream
 * @param {number} [options.exitCode] - Process exit code
 * @param {string} [options.fallback] - Generic fallback message
 * @param {string} [options.toolLabel='Tool'] - Human tool label for the interrupt message
 * @returns {string} A clean, meaningful error message
 */
export const buildToolErrorMessage = ({ lastMessage, exitCode, fallback, toolLabel = 'Tool' } = {}) => {
  if (isMeaningfulErrorText(lastMessage)) return lastMessage.replace(/\s+/g, ' ').trim();
  if (exitCode === 130) return `${toolLabel} command interrupted (CTRL+C)`;
  return fallback;
};

/**
 * Extract the core/root error string from a tool runner result (Issue #1845).
 *
 * Applies a single precedence everywhere so every failure surface shows the
 * same root cause: `errorInfo.message` → `errorInfo.errorMatch` → string
 * `errorInfo` → `result`. Returns a collapsed single line, or null when no
 * usable error string is available. Shared by `formatToolExecutionFailure`
 * (GitHub comments / exit message) and the terminal "Error details:" lines in
 * watch / auto-merge so they never diverge.
 *
 * Issue #1941: a meaningless structural fragment (e.g. a lone `}` captured when
 * a tool is interrupted mid-stream) is treated as "no usable error" so callers
 * fall back to the generic phrase instead of "execution failed with }".
 *
 * @param {Object} options
 * @param {Object} [options.toolResult] - Result object returned by the tool runner
 * @returns {string|null} The core error string, or null when none is available
 */
export const extractToolErrorCore = ({ toolResult } = {}) => {
  // Prefer the structured error message surfaced by the tool runner. We do NOT
  // fall back to resultSummary here, because that holds the agent's normal
  // work summary on success and would be misleading when used as an error.
  const errorInfo = toolResult?.errorInfo;
  const rawCore = errorInfo?.message || errorInfo?.errorMatch || (typeof errorInfo === 'string' ? errorInfo : null) || toolResult?.result || null;

  if (!rawCore || typeof rawCore !== 'string') return null;

  // Issue #1941: reject stray fragments with no letters/digits (e.g. "}").
  if (!isMeaningfulErrorText(rawCore)) return null;

  // Issue #2141: a core that embeds "[object Object]" (e.g. "Agent reported
  // error: [object Object]") carries no diagnosis at all. Publishing the generic
  // phrase is more honest than publishing a stringified object, and it keeps the
  // symptom out of GitHub comments even if a new adapter forgets to render its
  // payload as text.
  if (rawCore.includes('[object Object]')) return null;

  // Collapse to a single clean line and strip noise.
  const core = rawCore.replace(/\s+/g, ' ').trim();
  return core || null;
};

/**
 * Build a user-facing tool execution failure message that includes the core
 * error reported by the underlying tool (Issue #1845).
 *
 * Previously users only saw the generic "<TOOL> execution failed" and had to
 * dig through the full failure log to discover what actually went wrong (for
 * example "API Error: Output blocked by content filtering policy"). When the
 * tool runner surfaces a specific error this appends it so the failure is
 * self-explanatory:
 *
 *   "CLAUDE execution failed with API Error: Output blocked by content filtering policy"
 *
 * Falls back to the generic phrase when no specific error is available.
 *
 * @param {Object} options
 * @param {string} [options.tool] - Tool name (e.g. 'claude'); defaults to 'claude'
 * @param {Object} [options.toolResult] - Result object returned by the tool runner
 * @param {number} [options.maxLength=300] - Max length of the appended core error
 * @returns {string} The formatted failure message
 */
export const formatToolExecutionFailure = ({ tool, toolResult, maxLength = 300 } = {}) => {
  const base = `${(tool || 'claude').toUpperCase()} execution failed`;

  let core = extractToolErrorCore({ toolResult });
  if (!core) return base;

  // Avoid duplicating the base phrase if the core error already contains it.
  if (core.toLowerCase().includes('execution failed')) return base;

  if (core.length > maxLength) core = `${core.slice(0, maxLength - 1)}…`;
  return `${base} with ${core}`;
};

/**
 * Format aligned console output
 * @param {string} icon - Icon to display
 * @param {string} label - Label text
 * @param {string} value - Value text
 * @param {number} [indent=0] - Indentation level
 * @returns {string} Formatted string
 */
export const formatAligned = (icon, label, value, indent = 0) => {
  const spaces = ' '.repeat(indent);
  const labelWidth = 25 - indent;
  const paddedLabel = label.padEnd(labelWidth, ' ');
  return `${spaces}${icon} ${paddedLabel} ${value || ''}`;
};

/**
 * Display formatted error messages with sections
 * @param {Object} options - Display options
 * @param {string} options.title - Error title
 * @param {string} [options.what] - What happened
 * @param {string|Array} [options.details] - Error details
 * @param {Array<string>} [options.causes] - Possible causes
 * @param {Array<string>} [options.fixes] - Possible fixes
 * @param {string} [options.workDir] - Working directory
 * @param {Function} [options.log] - Log function to use
 * @param {string} [options.level='error'] - Log level
 * @returns {Promise<void>}
 */
export const displayFormattedError = async options => {
  const { title, what, details, causes, fixes, workDir, log: logFn = log, level = 'error' } = options;

  await logFn('');
  await logFn(`❌ ${title}`, { level });
  await logFn('');

  if (what) {
    await logFn('  🔍 What happened:');
    await logFn(`     ${what}`);
    await logFn('');
  }

  if (details) {
    await logFn('  📦 Error details:');
    const detailLines = Array.isArray(details) ? details : details.split('\n');
    for (const line of detailLines) {
      if (line.trim()) await logFn(`     ${line.trim()}`);
    }
    await logFn('');
  }

  if (causes && causes.length > 0) {
    await logFn('  💡 Possible causes:');
    for (const cause of causes) {
      await logFn(`     • ${cause}`);
    }
    await logFn('');
  }

  if (fixes && fixes.length > 0) {
    await logFn('  🔧 How to fix:');
    for (let i = 0; i < fixes.length; i++) {
      await logFn(`     ${i + 1}. ${fixes[i]}`);
    }
    await logFn('');
  }

  if (workDir) {
    await logFn(`  📂 Working directory: ${workDir}`);
    await logFn('');
  }

  // Always show the log file path if it exists - using absolute path
  if (logFile) {
    const path = await use('path');
    const absoluteLogPath = path.resolve(logFile);
    await logFn(`  📁 Full log file: ${absoluteLogPath}`);
    await logFn('');
  }
};

/**
 * Clean up temporary directories.
 *
 * Issue #2160: this used to run `sudo rm -rf /tmp/* /var/tmp/*`, which also wipes the workspaces,
 * lock directories and logs of any *concurrent* hive/solve process on the same host. The entries
 * are now enumerated first and anything a live process is sitting in (or that the caller protects)
 * is left alone.
 *
 * @param {Object} argv - Command line arguments
 * @param {boolean} [argv.autoCleanup] - Whether auto-cleanup is enabled
 * @param {Iterable<string>} [argv.protectedTempPaths] - Paths this run still needs
 * @returns {Promise<void>}
 */
export const cleanupTempDirectories = async argv => {
  if (!argv || !argv.autoCleanup) {
    return;
  }

  // Dynamic import for command-stream
  const { $ } = await use('command-stream');
  const { listCleanableTempEntries } = await import('./disk-guard.lib.mjs');
  const path = await use('path');

  try {
    await log('\n🧹 Auto-cleanup enabled, removing temporary directories...');
    const protectedPaths = new Set(argv.protectedTempPaths || []);
    const currentLogFile = getLogFile();
    if (currentLogFile) protectedPaths.add(path.resolve(currentLogFile));
    const { remove, keep } = await listCleanableTempEntries({ protectedPaths });
    for (const kept of keep) {
      await log(`   🔒 Keeping ${kept.path} (${kept.reason === 'process_cwd' ? 'a live process is using it' : 'needed by this run'})`, { verbose: true });
    }
    if (remove.length === 0) {
      await log('   ✅ Nothing to clean: every temporary entry is still in use');
      return;
    }
    await log(`   ⚠️  Executing: sudo rm -rf on ${remove.length} temporary entr${remove.length === 1 ? 'y' : 'ies'} (${keep.length} kept)`, { verbose: true });

    // Execute cleanup command using command-stream
    const cleanupCommand = $`sudo rm -rf ${remove}`;

    let exitCode = 0;
    for await (const chunk of cleanupCommand.stream()) {
      if (chunk.type === 'stderr') {
        const error = chunk.data.toString().trim();
        if (error && !error.includes('cannot remove')) {
          // Ignore "cannot remove" warnings for files in use
          await log(`   [cleanup WARNING] ${error}`, { level: 'warn', verbose: true });
        }
      } else if (chunk.type === 'exit') {
        exitCode = chunk.code;
      }
    }

    if (exitCode === 0) {
      await log('   ✅ Temporary directories cleaned successfully');
    } else {
      await log(`   ⚠️  Cleanup completed with warnings (exit code: ${exitCode})`, { level: 'warn' });
    }
  } catch (error) {
    reportError(error, {
      context: 'cleanup_temp_directories',
      autoCleanup: argv?.autoCleanup,
    });
    await log(`   ❌ Error during cleanup: ${cleanErrorMessage(error)}`, { level: 'error' });
    // Don't fail the entire process if cleanup fails
  }
};

// Export all functions as default object too
export default {
  log,
  setLogFile,
  getLogFile,
  getAbsoluteLogPath,
  maskToken,
  formatTimestamp,
  sanitizeFileName,
  getRuntime,
  getPlatformInfo,
  safeJsonParse,
  sleep,
  retry,
  formatBytes,
  measureTime,
  isENOSPC,
  cleanErrorMessage,
  formatAligned,
  displayFormattedError,
  cleanupTempDirectories,
  setupVerboseLogInterceptor,
  setupStdioLogInterceptor,
};

// Issue #1596: log the solve startup banner (version + raw command) and return
// the raw command string for reuse. Extracted from solve.mjs to keep that file
// under the 1500-line limit enforced by scripts/check-file-line-limits.sh.
export const logSolveStartup = async versionInfo => {
  const rawCommand = process.argv.join(' ');
  await log('');
  await log(`🚀 solve v${versionInfo}`);
  await log('🔧 Raw command executed:');
  await log(`   ${rawCommand}`);
  await log('');
  return rawCommand;
};

/**
 * Get version information for logging
 * @returns {Promise<string>} Version string
 */
export const getVersionInfo = async () => {
  const path = await use('path');
  const $ = (await use('zx')).$;
  const { getGitVersionAsync } = await import('./git.lib.mjs');

  try {
    const packagePath = path.join(path.dirname(path.dirname(new globalThis.URL(import.meta.url).pathname)), 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'));
    const currentVersion = packageJson.version;

    // Use git.lib.mjs to get version with proper git error handling
    return await getGitVersionAsync($, currentVersion);
  } catch {
    // Fallback to hardcoded version if all else fails
    return '0.10.4';
  }
};

// Export reportError for other modules that may import it
export { reportError, reportWarning };
