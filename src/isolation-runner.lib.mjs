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
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const { $ } = await use('command-stream');

// Valid isolation backends
const VALID_ISOLATION_BACKENDS = ['screen', 'tmux', 'docker'];
const RUNNING_SESSION_STATUSES = new Set(['executing', 'running']);
const TERMINAL_SESSION_STATUSES = new Set(['executed', 'completed', 'failed', 'cancelled', 'canceled', 'error']);
const DEFAULT_HIVE_MIND_IMAGE = 'konard/hive-mind:latest';
const DEFAULT_HIVE_MIND_DIND_IMAGE = 'konard/hive-mind-dind:latest';
const DOCKER_ISOLATION_TRACKING_BACKEND = 'screen';
const DOCKER_CONTAINER_HOME = '/home/box';
const DOCKER_CONTAINER_PREFIX = 'hive-mind-isolation';

function normalizeProcessIds(value) {
  if (!value || typeof value !== 'object') return {};
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    const number = Number(raw);
    if (Number.isInteger(number) && number > 0) out[key] = number;
  }
  return out;
}

function normalizeTool(tool) {
  return String(tool || 'claude')
    .trim()
    .toLowerCase();
}

function shellQuote(value) {
  const stringValue = String(value);
  if (stringValue === '') return "''";
  return `'${stringValue.replaceAll("'", "'\\''")}'`;
}

function shellDoubleQuote(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', '\\$').replaceAll('`', '\\`')}"`;
}

function buildShellCommand(command, args = []) {
  return [command, ...args].map(shellQuote).join(' ');
}

function makeDockerContainerName(sessionId) {
  const normalizedSession = String(sessionId || crypto.randomUUID()).replace(/[^a-zA-Z0-9_.-]/g, '-');
  return `${DOCKER_CONTAINER_PREFIX}-${normalizedSession}`;
}

function shouldRunPrivilegedDockerIsolation(image, env = process.env) {
  return String(env.HIVE_MIND_IMAGE_VARIANT || '').toLowerCase() === 'dind' || String(image || '').includes('hive-mind-dind');
}

function maybeAddMount(mounts, source, target, existsSync) {
  if (!source) return;
  if (!existsSync(source)) return;
  mounts.push({ source, target });
}

/**
 * Pick the Docker image used for `--isolation docker`.
 *
 * start-command defaults its Docker backend to a base OS image. Hive Mind needs
 * an image with the same CLI/tooling baseline as the parent process instead.
 */
export function getDockerIsolationImage({ env = process.env } = {}) {
  if (env.HIVE_MIND_DOCKER_ISOLATION_IMAGE) return env.HIVE_MIND_DOCKER_ISOLATION_IMAGE;
  return String(env.HIVE_MIND_IMAGE_VARIANT || '').toLowerCase() === 'dind' ? DEFAULT_HIVE_MIND_DIND_IMAGE : DEFAULT_HIVE_MIND_IMAGE;
}

/**
 * Build host auth mounts for a Docker-isolated task.
 *
 * GitHub auth is mounted for every task because solve/hive/task need gh. Tool
 * credentials are deliberately scoped: Codex sessions do not receive Claude
 * files and Claude sessions do not receive Codex files.
 */
export function getDockerIsolationAuthMounts({ tool = 'claude', env = process.env, homeDir = os.homedir(), existsSync = fs.existsSync } = {}) {
  const mounts = [];
  const normalizedTool = normalizeTool(tool);

  maybeAddMount(mounts, env.GH_CONFIG_DIR || path.join(homeDir, '.config', 'gh'), path.join(DOCKER_CONTAINER_HOME, '.config', 'gh'), existsSync);

  if (normalizedTool === 'codex') {
    maybeAddMount(mounts, path.join(homeDir, '.codex'), path.join(DOCKER_CONTAINER_HOME, '.codex'), existsSync);
  } else if (normalizedTool === 'claude') {
    maybeAddMount(mounts, path.join(homeDir, '.claude'), path.join(DOCKER_CONTAINER_HOME, '.claude'), existsSync);
    maybeAddMount(mounts, path.join(homeDir, '.claude.json'), path.join(DOCKER_CONTAINER_HOME, '.claude.json'), existsSync);
  }

  return mounts;
}

/**
 * Build the shell command executed inside a start-command wrapper session for
 * Docker isolation. The wrapper remains a start-command session so Telegram can
 * keep using the same status/log lifecycle while Hive Mind controls image and
 * auth mounts directly.
 */
export function buildDockerIsolationCommand(command, args = [], options = {}) {
  const { sessionId, tool = 'claude', env = process.env, homeDir = os.homedir(), existsSync = fs.existsSync } = options;
  const image = getDockerIsolationImage({ env });
  const innerCommand = buildShellCommand(command, args);
  const dockerArgs = ['docker', 'run', '--rm', '--name', makeDockerContainerName(sessionId), '--workdir', DOCKER_CONTAINER_HOME, '-e', `HOME=${DOCKER_CONTAINER_HOME}`, '-e', `HIVE_MIND_PARENT_SESSION_ID=${sessionId || ''}`];

  if (shouldRunPrivilegedDockerIsolation(image, env)) {
    dockerArgs.push('--privileged');
  }

  const imageVariant = image.includes('hive-mind-dind') ? 'dind' : env.HIVE_MIND_IMAGE_VARIANT || 'regular';
  dockerArgs.push('-e', `HIVE_MIND_IMAGE_VARIANT=${imageVariant}`);

  for (const mount of getDockerIsolationAuthMounts({ tool, env, homeDir, existsSync })) {
    dockerArgs.push('--volume', `${mount.source}:${mount.target}`);
  }

  dockerArgs.push(image, 'bash', '-lc');

  return [...dockerArgs.map(shellQuote), shellDoubleQuote(innerCommand)].join(' ');
}

export function buildStartCommandArgs(command, args = [], options = {}) {
  const { backend, sessionId } = options;
  if (backend === 'docker') {
    return ['--isolated', DOCKER_ISOLATION_TRACKING_BACKEND, '--detached', '--session', sessionId, '--', buildDockerIsolationCommand(command, args, options)];
  }
  return ['--isolated', backend, '--detached', '--session', sessionId, '--', buildShellCommand(command, args)];
}

async function runStartCommand(binPath, startCommandArgs) {
  return await new Promise(resolve => {
    const child = spawn(binPath, startCommandArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', data => {
      stdout += data.toString();
    });
    child.stderr.on('data', data => {
      stderr += data.toString();
    });
    child.on('error', error => {
      resolve({
        success: false,
        output: (stdout + stderr).trim(),
        error: error.message,
      });
    });
    child.on('close', code => {
      const output = (stdout + (stderr ? `\n${stderr}` : '')).trim();
      if (code === 0) {
        resolve({ success: true, output, error: null });
      } else {
        resolve({
          success: false,
          output,
          error: stderr.trim() || `start-command exited with code ${code}`,
        });
      }
    });
  });
}

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
 * @returns {{exists: boolean, uuid: string|null, status: string|null, exitCode: number|null, startTime: string|null, endTime: string|null, currentTime: string|null, logPath: string|null, command: string|null, isolation: string|null, workingDirectory: string|null, sessionName: string|null, processIds: Object, raw: string}}
 */
export function parseSessionStatusOutput(output) {
  const raw = (output || '').trim();
  if (!raw) {
    return { exists: false, uuid: null, status: null, exitCode: null, startTime: null, endTime: null, currentTime: null, logPath: null, command: null, isolation: null, workingDirectory: null, sessionName: null, processIds: {}, raw: '' };
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
    const topPid = Number(data?.pid);
    const processIds = normalizeProcessIds(data?.processIds);
    if (Number.isInteger(topPid) && topPid > 0 && processIds.pid == null) processIds.pid = topPid;
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
      sessionName: data?.sessionName || data?.options?.sessionName || null,
      processIds,
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
  const processIds = {};
  for (const name of ['pid', 'wrapperPid', 'childPid', 'processPid', 'commandPid']) {
    const value = readField(name);
    const number = Number(value);
    if (Number.isInteger(number) && number > 0) processIds[name] = number;
  }

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
    sessionName: readField('sessionName'),
    processIds,
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
 * @param {string} [options.tool] - AI tool selected for the task; used to scope Docker auth mounts
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

  const startCommandArgs = buildStartCommandArgs(command, args, { ...options, sessionId });

  if (verbose) {
    console.log(`[VERBOSE] isolation-runner: ${[binPath, ...startCommandArgs].map(shellQuote).join(' ')}`);
    if (backend === 'docker') {
      const image = getDockerIsolationImage({ env: options.env || process.env });
      const mounts = getDockerIsolationAuthMounts({ tool: options.tool, env: options.env || process.env, homeDir: options.homeDir || os.homedir(), existsSync: options.existsSync || fs.existsSync });
      console.log(`[VERBOSE] isolation-runner: Docker isolation image: ${image}`);
      console.log(`[VERBOSE] isolation-runner: Docker isolation mounts: ${mounts.map(m => m.target).join(', ') || '(none)'}`);
    }
  }

  const result = await runStartCommand(binPath, startCommandArgs);

  if (verbose) {
    const stream = result.success ? console.log : console.error;
    stream(`[VERBOSE] isolation-runner: Output: ${result.output.substring(0, 500)}`);
    if (result.error) stream(`[VERBOSE] isolation-runner: Error: ${result.error}`);
  }

  if (result.success) {
    return {
      success: true,
      sessionId,
      output: result.output,
    };
  }

  return {
    success: false,
    sessionId,
    output: result.output,
    error: result.error,
  };
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
    return { exists: false, uuid: null, status: null, exitCode: null, startTime: null, endTime: null, currentTime: null, logPath: null, command: null, isolation: null, workingDirectory: null, sessionName: null, processIds: {}, raw: '' };
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
    return { exists: false, uuid: null, status: null, exitCode: null, startTime: null, endTime: null, currentTime: null, logPath: null, command: null, isolation: null, workingDirectory: null, sessionName: null, processIds: {}, raw: '' };
  }
}

/**
 * Ask the `$` CLI to gracefully stop an isolated session by sending CTRL+C.
 *
 * Wraps `$ --stop <uuid>` from start-command (link-foundation/start#112).
 * Works for any isolation backend (screen, tmux, docker, …) — `$` knows the
 * backend it launched with and forwards the interrupt accordingly.
 *
 * @param {string} sessionId - UUID of the session to stop
 * @param {boolean} [verbose] - Enable verbose logging
 * @returns {Promise<{success: boolean, output: string, error: string|null}>}
 */
export async function stopIsolatedSession(sessionId, verbose = false) {
  const binPath = await findStartCommandBinary();
  if (!binPath) {
    if (verbose) {
      console.log('[VERBOSE] isolation-runner: Cannot stop session - $ binary not found');
    }
    return {
      success: false,
      output: '',
      error: '`$` (start-command) binary not found on PATH. Install link-foundation/start to use /stop <UUID>.',
    };
  }

  try {
    const result = await $({ mirror: false })`${binPath} --stop ${sessionId}`;
    const stdout = result.stdout?.toString() || '';
    const stderr = result.stderr?.toString() || '';
    if (verbose) {
      console.log(`[VERBOSE] isolation-runner: $ --stop ${sessionId} stdout: ${stdout.substring(0, 300)}`);
      if (stderr) {
        console.log(`[VERBOSE] isolation-runner: $ --stop ${sessionId} stderr: ${stderr.substring(0, 300)}`);
      }
    }
    return { success: true, output: stdout || stderr, error: null };
  } catch (error) {
    const stderr = error?.stderr?.toString?.() || '';
    const stdout = error?.stdout?.toString?.() || '';
    if (verbose) {
      console.log(`[VERBOSE] isolation-runner: $ --stop ${sessionId} failed: ${error.message}`);
    }
    return {
      success: false,
      output: stdout,
      error: stderr.trim() || error?.message || String(error),
    };
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

  // Fallback: for screen-backed sessions, check screen -ls directly.
  // Docker isolation is also tracked through a screen wrapper so Hive Mind can
  // control image selection and credential mounts while preserving logs/status.
  // Only use this when $ --status has no usable record. This works around
  // older start-command bugs where:
  // 1. $ --status can't find session by --session name (only by internal UUID)
  // See: https://github.com/link-assistant/hive-mind/issues/1545
  if ((backend === 'screen' || backend === 'docker') && shouldFallbackToScreenStatus(result)) {
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
