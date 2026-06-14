import { ensureUseM } from './use-m-bootstrap.lib.mjs';
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
  await ensureUseM();
}

const { $ } = await use('command-stream');

// Valid isolation backends
const VALID_ISOLATION_BACKENDS = ['screen', 'tmux', 'docker'];
const RUNNING_SESSION_STATUSES = new Set(['executing', 'running']);
const TERMINAL_SESSION_STATUSES = new Set(['executed', 'completed', 'failed', 'cancelled', 'canceled', 'error']);
const HIVE_MIND_IMAGE_REPO = 'konard/hive-mind';
const HIVE_MIND_DIND_IMAGE_REPO = 'konard/hive-mind-dind';
const DEFAULT_HIVE_MIND_IMAGE_TAG = 'latest';
const DOCKER_CONTAINER_HOME = '/home/box';
// Default path where the host Docker socket is bind-mounted inside a DinD
// container so box's host-image passthrough can copy host images into the
// nested daemon. Matches box's own DIND_HOST_DOCKER_SOCK default. The deploy
// must mount it (`-v /var/run/docker.sock:/var/run/host-docker.sock:ro`) or the
// nested daemon starts empty and the first isolated task pulls the full,
// multi-gigabyte image. See issue #1914.
const DEFAULT_HOST_DOCKER_SOCK = '/var/run/host-docker.sock';
// Force a POSIX shell for the inner command of Docker-isolated tasks. solve/
// hive/task live on the image's baked-in PATH, so `sh -c` resolves them without
// needing a login shell. Forcing the shell (instead of start's 'auto') also
// skips start's shell-detection probe, which would otherwise `docker run` a
// throwaway container — booting the dind image's dockerd entrypoint — purely to
// check whether bash exists. See issue #1914.
const DOCKER_ISOLATION_SHELL = 'sh';
// Free-space floor (GiB) below which the preflight warns that an impending
// isolation-image pull may fail with `no space left on device`. The Hive Mind
// isolation images are well over 30 GB extracted, so a host/nested daemon with
// less headroom than this cannot safely pull one. Diagnostic only — never
// blocks startup. See issue #1914.
const DOCKER_ISOLATION_LOW_DISK_GIB = 40;

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

function buildShellCommand(command, args = []) {
  return [command, ...args].map(shellQuote).join(' ');
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
 * Resolve the tag used for the Docker isolation image.
 *
 * Release Docker images bake this env var from `HIVE_MIND_VERSION`, so a parent
 * container started via `:latest` still launches child isolation containers from
 * the same immutable release tag. Local/PR builds fall back to `latest`, and
 * operators can override the tag explicitly when using custom images. Pinning
 * matters for Docker-in-Docker deployments: the nested daemon starts with an
 * empty image store, so a `:latest` digest drift from the host copy forces a
 * fresh multi-gigabyte pull. See issue #1879.
 */
export function resolveDockerIsolationImageTag({ env = process.env } = {}) {
  const explicit = String(env.HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG || '').trim();
  return explicit || DEFAULT_HIVE_MIND_IMAGE_TAG;
}

/**
 * Pick the Docker image used for `--isolation docker`.
 *
 * start-command defaults its Docker backend to a base OS image. Hive Mind needs
 * an image with the same CLI/tooling baseline as the parent process instead.
 *
 * `HIVE_MIND_DOCKER_ISOLATION_IMAGE` is a full override (repo:tag). Otherwise
 * the repo is chosen by image variant and the tag by
 * `resolveDockerIsolationImageTag()`.
 */
export function getDockerIsolationImage({ env = process.env } = {}) {
  if (env.HIVE_MIND_DOCKER_ISOLATION_IMAGE) return env.HIVE_MIND_DOCKER_ISOLATION_IMAGE;
  const repo = String(env.HIVE_MIND_IMAGE_VARIANT || '').toLowerCase() === 'dind' ? HIVE_MIND_DIND_IMAGE_REPO : HIVE_MIND_IMAGE_REPO;
  return `${repo}:${resolveDockerIsolationImageTag({ env })}`;
}

/**
 * Resolve the path where the host Docker socket is expected to be mounted inside
 * a DinD container. box's entrypoint reads this socket to copy host images into
 * the nested daemon (host-image passthrough). Defaults to
 * `/var/run/host-docker.sock` and can be overridden with `DIND_HOST_DOCKER_SOCK`
 * (the same variable box honors). See issue #1914.
 */
export function resolveHostDockerSock({ env = process.env } = {}) {
  const explicit = String(env.DIND_HOST_DOCKER_SOCK || '').trim();
  return explicit || DEFAULT_HOST_DOCKER_SOCK;
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
 * Resolve the image-variant marker recorded inside the isolated container.
 * A `hive-mind-dind` image is always the dind variant; otherwise fall back to
 * the parent's `HIVE_MIND_IMAGE_VARIANT` (or `regular`).
 */
function resolveImageVariant(image, env = process.env) {
  return image.includes('hive-mind-dind') ? 'dind' : env.HIVE_MIND_IMAGE_VARIANT || 'regular';
}

/**
 * Build the `$` (start-command) arguments that launch a Docker-isolated task
 * using start-command's NATIVE Docker backend (`$ --isolated docker`).
 *
 * Issue #1914: earlier versions wrapped a hand-rolled `docker run` inside a
 * `screen` session (`$ --isolated screen -- docker run …`). That was *screen*
 * isolation merely shelling out to Docker — not Docker isolation. We now hand
 * the container lifecycle to start-command itself and only contribute the
 * pieces Hive Mind must control: which image to run, privileged mode for the
 * dind variant, the environment markers, and the credential mounts scoped to
 * the selected tool.
 *
 * start-command's Docker backend reuses a locally present image and only pulls
 * when it is missing (`docker run` with Docker's default "missing" pull
 * policy), so a host image seeded into the nested daemon via box passthrough is
 * reused instead of re-downloaded — no `--pull` plumbing required (issue #1879).
 */
export function buildDockerIsolationStartArgs(command, args = [], options = {}) {
  const { sessionId, tool = 'claude', env = process.env, homeDir = os.homedir(), existsSync = fs.existsSync } = options;
  const image = getDockerIsolationImage({ env });

  const startArgs = ['--isolated', 'docker', '--image', image];

  if (shouldRunPrivilegedDockerIsolation(image, env)) {
    startArgs.push('--privileged');
  }

  // Force the inner shell so start-command does not probe the image to detect
  // one (see DOCKER_ISOLATION_SHELL).
  startArgs.push('--shell', DOCKER_ISOLATION_SHELL);

  // The image already sets HOME=/home/box and WORKDIR /home/box; pass HOME
  // explicitly anyway so the credential mounts under /home/box resolve even if
  // a future image forgets to. start-command has no --workdir flag, so the
  // working directory comes from the image's WORKDIR.
  startArgs.push('-e', `HOME=${DOCKER_CONTAINER_HOME}`, '-e', `HIVE_MIND_PARENT_SESSION_ID=${sessionId || ''}`, '-e', `HIVE_MIND_IMAGE_VARIANT=${resolveImageVariant(image, env)}`);

  for (const mount of getDockerIsolationAuthMounts({ tool, env, homeDir, existsSync })) {
    startArgs.push('--volume', `${mount.source}:${mount.target}`);
  }

  startArgs.push('--detached', '--session', sessionId, '--', buildShellCommand(command, args));
  return startArgs;
}

export function buildStartCommandArgs(command, args = [], options = {}) {
  const { backend, sessionId } = options;
  if (backend === 'docker') {
    return buildDockerIsolationStartArgs(command, args, { ...options, sessionId });
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
      const env = options.env || process.env;
      const image = getDockerIsolationImage({ env });
      const mounts = getDockerIsolationAuthMounts({ tool: options.tool, env, homeDir: options.homeDir || os.homedir(), existsSync: options.existsSync || fs.existsSync });
      console.log('[VERBOSE] isolation-runner: Docker isolation backend: native ($ --isolated docker)');
      console.log(`[VERBOSE] isolation-runner: Docker isolation image: ${image}`);
      console.log(`[VERBOSE] isolation-runner: Docker isolation privileged: ${shouldRunPrivilegedDockerIsolation(image, env)}`);
      console.log('[VERBOSE] isolation-runner: Docker isolation pull: reuse local image if present, pull only if missing (start-command default)');
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
 * Check whether the Docker container backing a native `$ --isolated docker`
 * session is still running.
 *
 * start-command names the container after the `--session` value, so the
 * (possibly nested) Docker daemon can be queried directly. This is the
 * native-Docker analogue of the `screen -ls` fallback: it is consulted only
 * when `$ --status` has no usable record. The bot runs inside a Docker-in-
 * Docker container, so `docker` here talks to the same nested daemon that
 * start-command launched the task container on. See issue #1914.
 *
 * @param {string} containerName - Container name (the session UUID)
 * @param {boolean} [verbose] - Enable verbose logging
 * @returns {Promise<boolean>} True if the container exists and is running
 */
export async function checkDockerContainerRunning(containerName, verbose = false) {
  try {
    const result = await $({ mirror: false })`docker inspect -f ${'{{.State.Running}}'} ${containerName}`;
    const running = (result.stdout?.toString() || '').trim() === 'true';
    if (verbose) {
      console.log(`[VERBOSE] isolation-runner: docker inspect for '${containerName}': ${running ? 'running' : 'not running'}`);
    }
    return running;
  } catch {
    // `docker inspect` exits non-zero when no such container exists.
    return false;
  }
}

/**
 * Check whether an image is present in the local Docker daemon.
 *
 * Inside a Docker-in-Docker container "local" is the NESTED daemon. `docker
 * image inspect` exits 0 only when the image exists, so a non-zero exit (or a
 * missing docker binary) is treated as absent. Used by the startup preflight to
 * predict whether the first isolated task will trigger a full image pull.
 * See issue #1914.
 *
 * @param {string} image - Image reference (repo:tag)
 * @param {boolean} [verbose] - Enable verbose logging
 * @returns {Promise<boolean>} True if the image is present locally
 */
export async function checkDockerImagePresent(image, verbose = false) {
  try {
    await $({ mirror: false })`docker image inspect ${image}`;
    if (verbose) console.log(`[VERBOSE] isolation-runner: docker image inspect '${image}': present`);
    return true;
  } catch {
    if (verbose) console.log(`[VERBOSE] isolation-runner: docker image inspect '${image}': absent`);
    return false;
  }
}

/**
 * Report the storage driver the (nested) Docker daemon is using.
 *
 * `vfs` performs NO copy-on-write — it stores a full copy of every image layer
 * — so the multi-gigabyte Hive Mind images consume many times their real size
 * on disk and the first isolated `docker run`/pull dies with
 * `failed to register layer: no space left on device` (issue #1914 reopen).
 * The preflight uses this to warn loudly when the daemon is on `vfs` instead of
 * letting the disk silently overflow mid-task.
 *
 * Never throws: returns the lowercased driver name, or `null` when docker is
 * unavailable / the daemon is unreachable.
 *
 * @param {boolean} [verbose] - Enable verbose logging
 * @returns {Promise<string|null>} e.g. 'fuse-overlayfs', 'overlay2', 'vfs', or null
 */
export async function checkDockerStorageDriver(verbose = false) {
  try {
    const result = await $({ mirror: false })`docker info --format ${'{{.Driver}}'}`;
    const driver = (result.stdout?.toString() || '').trim().toLowerCase() || null;
    if (verbose) console.log(`[VERBOSE] isolation-runner: docker storage driver: ${driver || '(unknown)'}`);
    return driver;
  } catch {
    if (verbose) console.log('[VERBOSE] isolation-runner: docker info unavailable; storage driver unknown');
    return null;
  }
}

/**
 * Report the free space (in GiB) on the Docker daemon's data root.
 *
 * The Hive Mind isolation images are multiple gigabytes; when the nested daemon
 * has to pull one, it needs room for the extracted layers. This lets the
 * preflight predict a `no space left on device` failure (issue #1914) instead
 * of discovering it mid-pull. Resolves the daemon's real data root via
 * `docker info` and falls back to `/var/lib/docker`, then reads `df -Pk`.
 *
 * Never throws: returns `{ availableGiB, dataRoot }`, or `null` when the
 * information cannot be determined (no docker, no df, unparseable output).
 *
 * @param {boolean} [verbose] - Enable verbose logging
 * @returns {Promise<{availableGiB: number, dataRoot: string}|null>}
 */
export async function checkDockerDiskSpace(verbose = false) {
  try {
    let dataRoot = '/var/lib/docker';
    try {
      const info = await $({ mirror: false })`docker info --format ${'{{.DockerRootDir}}'}`;
      const root = (info.stdout?.toString() || '').trim();
      if (root) dataRoot = root;
    } catch {
      // Daemon unreachable: fall back to the conventional data root. If df then
      // fails on it (e.g. the path does not exist) we return null below.
    }

    const df = await $({ mirror: false })`df -Pk ${dataRoot}`;
    // `df -P` guarantees one logical line per filesystem (no wrapping). The last
    // line is the data row: Filesystem 1024-blocks Used Available Capacity Mount
    const lines = (df.stdout?.toString() || '').trim().split('\n');
    const cols = (lines[lines.length - 1] || '').trim().split(/\s+/);
    const availableKb = Number(cols[3]);
    if (!Number.isFinite(availableKb)) {
      if (verbose) console.log('[VERBOSE] isolation-runner: could not parse df output for Docker disk space');
      return null;
    }
    const availableGiB = availableKb / (1024 * 1024);
    if (verbose) console.log(`[VERBOSE] isolation-runner: Docker data root '${dataRoot}' has ${availableGiB.toFixed(1)} GiB free`);
    return { availableGiB, dataRoot };
  } catch {
    if (verbose) console.log('[VERBOSE] isolation-runner: df unavailable; Docker disk space unknown');
    return null;
  }
}

/**
 * Startup preflight for `--isolation docker`.
 *
 * The bot usually runs inside a Docker-in-Docker container whose NESTED daemon
 * starts with an empty image store. If the isolation image is not already in
 * that nested daemon, the first isolated task makes `docker run` pull a fresh
 * copy — which for the Hive Mind images is multiple gigabytes (issues #1914,
 * #1879). box can seed the nested daemon automatically (host-image passthrough)
 * but only when the host Docker socket is bind-mounted into the container; if it
 * is not mounted, passthrough is a SILENT no-op and the re-download is the first
 * symptom an operator sees.
 *
 * This preflight makes that condition observable at startup instead: it reports
 * whether the image is already present (reuse, no pull) and, when it is absent,
 * warns loudly with the exact remediation (mount the host socket / set the
 * passthrough allowlist, or run the preload script). It never throws and never
 * blocks startup — a misconfigured passthrough should degrade to a slow first
 * task, not a dead bot.
 *
 * It also surfaces the two root causes of the issue #1914 reopen
 * (`failed to register layer: no space left on device`): a non-copy-on-write
 * storage driver (`vfs`, which copies every layer in full) and a Docker data
 * root with too little free space to hold the >30 GB image. Both are reported
 * as loud, actionable warnings so the disk overflow is self-diagnosing at
 * startup instead of surfacing mid-task.
 *
 * @param {Object} [options]
 * @param {Object} [options.env] - Environment (defaults to process.env)
 * @param {Function} [options.existsSync] - fs.existsSync (injectable for tests)
 * @param {boolean} [options.verbose] - Enable verbose logging
 * @param {Object} [options.logger] - Logger with .log/.warn (defaults to console)
 * @param {Function} [options.checkImagePresent] - Image-presence probe (injectable for tests)
 * @param {Function} [options.checkStorageDriver] - Storage-driver probe (injectable for tests)
 * @param {Function} [options.checkDiskSpace] - Disk-space probe (injectable for tests)
 * @returns {Promise<{image: string, sock: string, socketMounted: boolean, imagePresent: boolean, isDind: boolean, storageDriver: (string|null), storageDriverOk: boolean, diskAvailableGiB: (number|null), ok: boolean, warnings: string[]}>}
 */
export async function preflightDockerIsolation(options = {}) {
  const { env = process.env, existsSync = fs.existsSync, verbose = false, logger = console, checkImagePresent = checkDockerImagePresent, checkStorageDriver = checkDockerStorageDriver, checkDiskSpace = checkDockerDiskSpace } = options;

  const image = getDockerIsolationImage({ env });
  const sock = resolveHostDockerSock({ env });
  const isDind = shouldRunPrivilegedDockerIsolation(image, env);
  const socketMounted = Boolean(existsSync(sock));
  const imagePresent = Boolean(await checkImagePresent(image, verbose));
  const storageDriver = await checkStorageDriver(verbose);
  const disk = await checkDiskSpace(verbose);
  const diskAvailableGiB = disk && Number.isFinite(disk.availableGiB) ? disk.availableGiB : null;
  // Unknown driver (probe returned null) is treated as ok — we only flag the
  // one driver known to overflow the disk, never block on missing information.
  const storageDriverOk = storageDriver !== 'vfs';

  const result = { image, sock, socketMounted, imagePresent, isDind, storageDriver, storageDriverOk, diskAvailableGiB, ok: imagePresent, warnings: [] };
  const info = typeof logger.log === 'function' ? logger.log.bind(logger) : () => {};
  const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : info;

  const preload = `node scripts/preload-dind-isolation-image.mjs --image ${image}`;

  // Root Cause A of the issue #1914 reopen: a non-copy-on-write storage driver.
  // `vfs` stores a full copy of every image layer, so the multi-GB images
  // consume many times their size on disk and any layer write (pull, run,
  // commit) can fail with `failed to register layer: no space left on device`.
  // This is dangerous even when the image is already present — a task that
  // commits or pulls more layers still overflows — so we warn independent of
  // image presence.
  if (storageDriver === 'vfs') {
    result.warnings.push(`The Docker daemon backing '--isolation docker' is using the 'vfs' storage driver, which performs NO copy-on-write: ` + `it stores a full copy of every image layer, so the multi-GB Hive Mind images consume many times their size on disk and isolated tasks can fail with 'failed to register layer: no space left on device' (issue #1914). ` + `Switch to a copy-on-write driver: rebuild/redeploy with the current Dockerfile.dind (it defaults to 'fuse-overlayfs'), or for an already-running container add '-e DIND_STORAGE_DRIVER=fuse-overlayfs' to the bot container's 'docker run' and recreate it.`);
  }

  if (!imagePresent) {
    // Image absent: the first isolated task will pull the full image. Explain
    // the most likely cause and the exact fix instead of letting the operator
    // first discover it as a surprise multi-gigabyte download mid-task.
    if (isDind && !socketMounted) {
      result.warnings.push(`Docker isolation image '${image}' is NOT in the nested Docker daemon and the host Docker socket is not mounted at ${sock}. ` + `box host-image passthrough cannot seed the nested daemon, so the FIRST isolated task will pull the full image (the Hive Mind images are multiple GB). ` + `Fix the deployment: add '-v /var/run/docker.sock:${sock}:ro' and '-e DIND_HOST_PASSTHROUGH_IMAGES="konard/hive-mind konard/hive-mind-dind"' to the bot container's 'docker run', or seed it now with: ${preload}`);
    } else if (isDind && socketMounted) {
      result.warnings.push(`Docker isolation image '${image}' is NOT in the nested Docker daemon even though the host Docker socket is mounted at ${sock}. ` + `box host-image passthrough may have skipped it (check DIND_HOST_PASSTHROUGH mode, the DIND_HOST_PASSTHROUGH_IMAGES allowlist, and that the host actually has '${image}' with a registry digest). ` + `The first isolated task will pull the full image. Seed it now with: ${preload}`);
    } else {
      result.warnings.push(`Docker isolation image '${image}' is not present locally; the first isolated task will pull it. ` + `If this host already has it under a different tag, pin HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG, or seed it with: ${preload}`);
    }

    // Root Cause B of the issue #1914 reopen: too little disk for the pull. The
    // image is well over 30 GB extracted; predict the `no space left on device`
    // failure here rather than hitting it mid-pull.
    if (diskAvailableGiB != null && diskAvailableGiB < DOCKER_ISOLATION_LOW_DISK_GIB) {
      const root = disk?.dataRoot || 'the Docker data root';
      result.warnings.push(`Only ~${diskAvailableGiB.toFixed(0)} GiB free on ${root} and the isolation image '${image}' is not present yet. ` + `The Hive Mind isolation image is well over 30 GB extracted, so the first isolated task's pull may fail with 'no space left on device' (issue #1914). ` + `Seed it via host passthrough (mount the host docker socket) or with '${preload}', and free space on the Docker data root.`);
    }
  }

  if (imagePresent) {
    info(`✅ Docker isolation image '${image}' is already present locally — isolated tasks reuse it (no multi-GB pull). See issue #1914.`);
  }
  for (const w of result.warnings) warn(`⚠️ ${w}`);
  return result;
}

/**
 * Check if an isolated session is still running.
 * Uses `$ --status` first, with a backend-specific fallback (screen -ls for
 * screen, docker inspect for docker) to work around start-command UUID
 * mismatch issues.
 *
 * @param {string} sessionId - UUID of the session (also the screen session name / docker container name)
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

  // Fallback used only when `$ --status` has no usable record. This works
  // around older start-command bugs where `$ --status` can't resolve a session
  // by its --session name (only by an internal UUID). See issue #1545.
  //   - screen sessions: confirm via `screen -ls`.
  //   - docker sessions: confirm via `docker inspect` on the container that
  //     start-command named after the session UUID. Native Docker isolation
  //     (issue #1914) is a real container, not a screen wrapper, so the screen
  //     check no longer applies to it.
  if (shouldFallbackToScreenStatus(result)) {
    if (backend === 'screen') {
      const screenRunning = await checkScreenSessionRunning(sessionId, verbose);
      if (screenRunning && verbose) {
        console.log(`[VERBOSE] isolation-runner: $ --status says not running, but screen -ls confirms session '${sessionId}' is still active`);
      }
      return screenRunning;
    }
    if (backend === 'docker') {
      const containerRunning = await checkDockerContainerRunning(sessionId, verbose);
      if (containerRunning && verbose) {
        console.log(`[VERBOSE] isolation-runner: $ --status says not running, but docker inspect confirms container '${sessionId}' is still active`);
      }
      return containerRunning;
    }
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
