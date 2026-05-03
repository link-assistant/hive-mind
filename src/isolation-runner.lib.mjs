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
const RUNNING_SESSION_STATUSES = new Set(['executing', 'running']);
const TERMINAL_SESSION_STATUSES = new Set(['executed', 'completed', 'failed', 'cancelled', 'canceled', 'error']);

/**
 * Generate a UUID v4 for unique session identification
 * @returns {string} UUID v4 string
 */
export function generateSessionId() {
  return crypto.randomUUID();
}

/**
 * Parse output from `$ --status <session>`.
 *
 * start-command versions used in the wild may return JSON when
 * `--output-format json` is supported, or human-readable key/value text.
 * Keep the parser tolerant so completion monitoring survives either format.
 *
 * @param {string} output - Raw stdout from `$ --status`
 * @returns {{exists: boolean, uuid: string|null, status: string|null, exitCode: number|null, startTime: string|null, endTime: string|null, currentTime: string|null, logPath: string|null, command: string|null, isolation: string|null, workingDirectory: string|null, raw: string}}
 */
export function parseSessionStatusOutput(output) {
  const raw = (output || '').trim();
  if (!raw) {
    return { exists: false, uuid: null, status: null, exitCode: null, startTime: null, endTime: null, currentTime: null, logPath: null, command: null, isolation: null, workingDirectory: null, raw: '' };
  }

  try {
    const parsed = JSON.parse(raw);
    const data = Array.isArray(parsed) ? parsed[0] : parsed;
    // start-command (link-foundation/start) reports the isolation backend at
    // `options.isolated` in both JSON and links-notation output. Older
    // hypothetical layouts used `options.isolation` or a top-level `isolation`
    // field — keep accepting all three so we are tolerant of future renames.
    // See https://github.com/link-assistant/hive-mind/issues/1700.
    const isolationCandidate = (typeof data?.isolation === 'string' && data.isolation) || (typeof data?.options?.isolated === 'string' && data.options.isolated) || (typeof data?.options?.isolation === 'string' && data.options.isolation) || null;
    return {
      exists: true,
      uuid: data?.uuid || null,
      status: typeof data?.status === 'string' ? data.status.toLowerCase() : null,
      exitCode: data?.exitCode !== undefined && data?.exitCode !== null ? Number(data.exitCode) : null,
      startTime: data?.startTime || null,
      endTime: data?.endTime || null,
      currentTime: data?.currentTime || null,
      logPath: data?.logPath || null,
      command: data?.command || null,
      isolation: isolationCandidate ? isolationCandidate.toLowerCase() : null,
      workingDirectory: data?.workingDirectory || null,
      raw,
    };
  } catch {
    // Fall through to text parsing.
  }

  const firstLine =
    raw
      .split('\n')
      .find(line => line.trim() && !line.includes(' '))
      ?.trim() || null;
  const readField = name => {
    const match = raw.match(new RegExp(`^\\s*${name}\\s+"?([^"\\n]+)"?\\s*$`, 'mi'));
    return match ? match[1].trim() : null;
  };

  const status = readField('status')?.toLowerCase() || null;
  const exitCodeText = readField('exitCode');
  // `start-command` links-notation output nests the isolation backend under
  // `options` as `isolated <backend>` (not `isolation`). The leading indent
  // varies by depth, but `readField` is anchored with `^\s*` which already
  // matches indented lines. Older code only looked for `isolation`, which
  // returned null for every real session and made /log + /terminal_watch
  // reject screen/tmux/docker sessions. See issue #1700.
  const isolationText = readField('isolated') || readField('isolation');

  return {
    exists: Boolean(status || firstLine),
    uuid: readField('uuid') || firstLine,
    status,
    exitCode: exitCodeText !== null ? Number(exitCodeText) : null,
    startTime: readField('startTime'),
    endTime: readField('endTime'),
    currentTime: readField('currentTime'),
    logPath: readField('logPath'),
    command: readField('command'),
    isolation: isolationText?.toLowerCase() || null,
    workingDirectory: readField('workingDirectory'),
    raw,
  };
}

export function isExecutingSessionStatus(status) {
  return RUNNING_SESSION_STATUSES.has(String(status || '').toLowerCase());
}

export function isTerminalSessionStatus(status) {
  return TERMINAL_SESSION_STATUSES.has(String(status || '').toLowerCase());
}

export function shouldFallbackToScreenStatus(statusResult) {
  return !statusResult?.exists || !statusResult?.status;
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
 * @returns {Promise<{exists: boolean, uuid: string|null, status: string|null, exitCode: number|null, startTime: string|null, endTime: string|null, currentTime: string|null, raw: string}>}
 */
export async function querySessionStatus(sessionId, verbose = false) {
  const binPath = await findStartCommandBinary();
  if (!binPath) {
    if (verbose) {
      console.log('[VERBOSE] isolation-runner: Cannot query status - $ binary not found');
    }
    return { exists: false, uuid: null, status: null, exitCode: null, startTime: null, endTime: null, currentTime: null, logPath: null, command: null, isolation: null, workingDirectory: null, raw: '' };
  }

  try {
    const result = await $({ mirror: false })`${binPath} --status ${sessionId} --output-format json`;

    const stdout = result.stdout?.toString().trim() || '';

    if (verbose) {
      console.log(`[VERBOSE] isolation-runner: Status query result: ${stdout.substring(0, 300)}`);
    }

    return parseSessionStatusOutput(stdout);
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] isolation-runner: Status query error: ${error.message}`);
    }
    return { exists: false, uuid: null, status: null, exitCode: null, startTime: null, endTime: null, currentTime: null, logPath: null, command: null, isolation: null, workingDirectory: null, raw: '' };
  }
}

/**
 * Check if a screen session exists via `screen -ls`.
 * Used as a fallback when `$ --status` fails to find or correctly track
 * screen-based isolation sessions.
 *
 * @param {string} sessionName - Name of the screen session to check
 * @param {boolean} [verbose] - Enable verbose logging
 * @returns {Promise<boolean>} True if screen session exists
 * @see https://github.com/link-assistant/hive-mind/issues/1545
 */
export async function checkScreenSessionRunning(sessionName, verbose = false) {
  try {
    const result = await $({ mirror: false })`screen -ls`;
    const output = result.stdout?.toString() || '';
    const exists = output.includes(sessionName);
    if (verbose) {
      console.log(`[VERBOSE] isolation-runner: screen -ls check for '${sessionName}': ${exists ? 'running' : 'not found'}`);
    }
    return exists;
  } catch {
    // screen -ls returns exit code 1 when no sessions exist
    return false;
  }
}

/**
 * Check if an isolated session is still running.
 * Uses `$ --status` first, with a `screen -ls` fallback for screen-backend
 * sessions to work around start-command UUID mismatch issues.
 *
 * @param {string} sessionId - UUID of the session (used for both $ --status and screen session name)
 * @param {Object} [options] - Options
 * @param {string} [options.backend] - Isolation backend ('screen', 'tmux', 'docker')
 * @param {boolean} [options.verbose] - Enable verbose logging
 * @returns {Promise<boolean>} True if session is still executing
 */
export async function isSessionRunning(sessionId, options = {}) {
  // Support legacy call signature: isSessionRunning(sessionId, verbose)
  const opts = typeof options === 'boolean' ? { verbose: options } : options;
  const { backend, verbose = false } = opts;

  const result = await querySessionStatus(sessionId, verbose);
  if (result.exists && result.status) {
    if (isExecutingSessionStatus(result.status)) {
      return true;
    }
    if (isTerminalSessionStatus(result.status)) {
      return false;
    }
  }

  // Fallback: for screen backend, check screen -ls directly.
  // Only use this when $ --status has no usable record. This works around
  // older start-command bugs where:
  // 1. $ --status can't find session by --session name (only by internal UUID)
  // See: https://github.com/link-assistant/hive-mind/issues/1545
  if (backend === 'screen' && shouldFallbackToScreenStatus(result)) {
    const screenRunning = await checkScreenSessionRunning(sessionId, verbose);
    if (screenRunning && verbose) {
      console.log(`[VERBOSE] isolation-runner: $ --status says not running, but screen -ls confirms session '${sessionId}' is still active`);
    }
    return screenRunning;
  }

  return false;
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
