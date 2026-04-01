/**
 * Isolation Runner for Telegram bot
 *
 * Executes commands using the `$` CLI from start-command with isolation backends
 * (screen, tmux, docker). Uses GUIDs for unique session tracking and
 * `$ --status <uuid>` for reliable completion detection.
 *
 * @see https://github.com/link-foundation/start
 * @see https://github.com/link-assistant/hive-mind/issues/380
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { createRequire } from 'module';
import crypto from 'crypto';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

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
 * Find the `$` CLI binary from start-command
 * @returns {Promise<string|null>} Path to `$` binary or null
 */
async function findStartCommandBinary() {
  try {
    const { stdout } = await execFileAsync('which', ['$']);
    return stdout.trim() || null;
  } catch {
    // Try resolving from node_modules
    try {
      return require.resolve('start-command/src/bin/cli.js');
    } catch {
      return null;
    }
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

  // Build the $ command arguments:
  // $ --isolated <backend> --detached --session <sessionId> -- <command> <args...>
  const dollarArgs = ['--isolated', backend, '--detached', '--session', sessionId, '--', command, ...args];

  if (verbose) {
    console.log(`[VERBOSE] isolation-runner: $ ${dollarArgs.join(' ')}`);
  }

  try {
    const { stdout, stderr } = await execFileAsync(binPath, dollarArgs, {
      timeout: 30000,
      env: process.env,
    });

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
    const output = (error.stdout || '') + (error.stderr || '');

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
    const { stdout } = await execFileAsync(binPath, ['--status', sessionId, '--output-format', 'json'], {
      timeout: 10000,
      env: process.env,
    });

    if (verbose) {
      console.log(`[VERBOSE] isolation-runner: Status query result: ${stdout.substring(0, 300)}`);
    }

    try {
      const data = JSON.parse(stdout.trim());
      return {
        exists: true,
        status: data.status || null,
        exitCode: data.exitCode !== undefined ? data.exitCode : null,
        raw: stdout.trim(),
      };
    } catch {
      // If JSON parsing fails, try text-based detection
      const isExecuting = stdout.includes('executing');
      const isExecuted = stdout.includes('executed');
      return {
        exists: isExecuting || isExecuted,
        status: isExecuting ? 'executing' : isExecuted ? 'executed' : null,
        exitCode: null,
        raw: stdout.trim(),
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
