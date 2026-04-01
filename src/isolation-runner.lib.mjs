/**
 * Isolation Runner for Telegram bot
 *
 * Executes commands using the `$` CLI from start-command with isolation backends
 * (screen, tmux, docker). Uses GUIDs for unique session tracking and
 * `$ --status <uuid>` for reliable completion detection.
 *
 * Uses command-stream library to invoke the globally-installed `$` CLI,
 * following the same pattern as claude.lib.mjs, agent.lib.mjs, etc.
 *
 * @see https://github.com/link-foundation/start
 * @see https://github.com/link-assistant/hive-mind/issues/380
 */

import crypto from 'crypto';

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const { $ } = await use('command-stream');

// Valid isolation backends
const VALID_ISOLATION_BACKENDS = ['screen', 'tmux', 'docker'];

/**
 * Generate a UUID v4 for unique session identification
 * @returns {string} UUID v4 string
 */
export function generateSessionId() {
  return crypto.randomUUID();
}

/**
 * Find the `$` CLI binary path
 * @returns {Promise<string|null>} Path to `$` binary or null
 */
async function findStartCommandBinary() {
  try {
    const result = await $`which $`;
    const path = result.stdout?.toString().trim() || '';
    return path || null;
  } catch {
    return null;
  }
}

/**
 * Execute a command with isolation via `$` from start-command
 *
 * @param {string} command - The command to run (e.g., 'solve')
 * @param {string[]} args - Arguments for the command
 * @param {Object} options - Isolation options
 * @param {string} options.backend - Isolation backend: 'screen', 'tmux', or 'docker'
 * @param {string} [options.sessionId] - UUID for session tracking (auto-generated if not provided)
 * @param {boolean} [options.verbose] - Enable verbose logging
 * @returns {Promise<{success: boolean, sessionId: string, output: string, error?: string, warning?: string}>}
 */
export async function executeWithIsolation(command, args, options = {}) {
  const { backend, verbose = false } = options;
  const sessionId = options.sessionId || generateSessionId();

  if (!VALID_ISOLATION_BACKENDS.includes(backend)) {
    return {
      success: false,
      sessionId,
      output: '',
      error: `Invalid isolation backend: '${backend}'. Must be one of: ${VALID_ISOLATION_BACKENDS.join(', ')}`,
    };
  }

  const binPath = await findStartCommandBinary();
  if (!binPath) {
    return {
      success: false,
      sessionId,
      output: '',
      warning: '⚠️ WARNING: start-command ($) not found in PATH\nPlease install: npm install -g start-command',
      error: 'start-command ($) not found',
    };
  }

  if (verbose) {
    console.log(`[VERBOSE] isolation-runner: Using $ binary at: ${binPath}`);
    console.log(`[VERBOSE] isolation-runner: Backend: ${backend}, Session ID: ${sessionId}`);
  }

  // Build arguments as array for the $ CLI:
  // $ --isolated <backend> --detached --session <sessionId> -- <command> <args...>
  const argsStr = args.join(' ');

  if (verbose) {
    console.log(`[VERBOSE] isolation-runner: $ --isolated ${backend} --detached --session ${sessionId} -- ${command} ${argsStr}`);
  }

  try {
    const result = await $({ mirror: false })`${binPath} --isolated ${backend} --detached --session ${sessionId} -- ${command} ${argsStr}`;

    const stdout = result.stdout?.toString() || '';
    const stderr = result.stderr?.toString() || '';
    const output = stdout + (stderr ? '\n' + stderr : '');

    if (verbose) {
      console.log(`[VERBOSE] isolation-runner: Output: ${output.substring(0, 500)}`);
    }

    return {
      success: true,
      sessionId,
      output: output.trim(),
    };
  } catch (error) {
    const stdout = error.stdout?.toString() || '';
    const stderr = error.stderr?.toString() || '';
    const output = stdout + stderr;

    if (verbose) {
      console.error(`[VERBOSE] isolation-runner: Error: ${error.message}`);
      console.error(`[VERBOSE] isolation-runner: Output: ${output.substring(0, 500)}`);
    }

    return {
      success: false,
      sessionId,
      output: output.trim(),
      error: error.message,
    };
  }
}

/**
 * Query the status of an isolated session via `$ --status <uuid>`
 *
 * @param {string} sessionId - UUID of the session to check
 * @param {boolean} [verbose] - Enable verbose logging
 * @returns {Promise<{exists: boolean, status: string|null, exitCode: number|null, raw: string}>}
 */
export async function querySessionStatus(sessionId, verbose = false) {
  const binPath = await findStartCommandBinary();
  if (!binPath) {
    if (verbose) {
      console.log('[VERBOSE] isolation-runner: Cannot query status - $ binary not found');
    }
    return { exists: false, status: null, exitCode: null, raw: '' };
  }

  try {
    const result = await $({ mirror: false })`${binPath} --status ${sessionId} --output-format json`;

    const stdout = result.stdout?.toString().trim() || '';

    if (verbose) {
      console.log(`[VERBOSE] isolation-runner: Status query result: ${stdout.substring(0, 300)}`);
    }

    try {
      const data = JSON.parse(stdout);
      return {
        exists: true,
        status: data.status || null,
        exitCode: data.exitCode !== undefined ? data.exitCode : null,
        raw: stdout,
      };
    } catch {
      // If JSON parsing fails, try text-based detection
      const isExecuting = stdout.includes('executing');
      const isExecuted = stdout.includes('executed');
      return {
        exists: isExecuting || isExecuted,
        status: isExecuting ? 'executing' : isExecuted ? 'executed' : null,
        exitCode: null,
        raw: stdout,
      };
    }
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] isolation-runner: Status query error: ${error.message}`);
    }
    return { exists: false, status: null, exitCode: null, raw: '' };
  }
}

/**
 * Check if an isolated session is still running
 *
 * @param {string} sessionId - UUID of the session
 * @param {boolean} [verbose] - Enable verbose logging
 * @returns {Promise<boolean>} True if session is still executing
 */
export async function isSessionRunning(sessionId, verbose = false) {
  const result = await querySessionStatus(sessionId, verbose);
  return result.exists && result.status === 'executing';
}

/**
 * Validate that an isolation backend value is valid
 * @param {string} backend - Backend value to validate
 * @returns {boolean}
 */
export function isValidIsolationBackend(backend) {
  return VALID_ISOLATION_BACKENDS.includes(backend);
}

export { VALID_ISOLATION_BACKENDS };
