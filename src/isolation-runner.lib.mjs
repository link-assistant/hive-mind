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
import { isExecutingSessionStatus, isTerminalSessionStatus } from './session-status.lib.mjs';

if (typeof use === 'undefined') {
  await ensureUseM();
}

const { $ } = await use('command-stream');

// Re-export the shared status predicates so existing callers that reach them via
// the isolation-runner module (e.g. session-monitor's `runner.isExecutingSessionStatus`)
// keep working. The canonical definitions live in session-status.lib.mjs so the
// killed/terminated/oom vocabulary stays consistent everywhere (issue #1927).
export { isExecutingSessionStatus, isTerminalSessionStatus, isKilledSessionStatus } from './session-status.lib.mjs';

// Valid isolation backends
const VALID_ISOLATION_BACKENDS = ['screen', 'tmux', 'docker'];
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
// Docker isolation runs in one of two modes (issue #1962). The runner code is
// identical for both — it always issues a plain `$ --isolated docker` (i.e.
// `docker run`); the mode only describes WHICH daemon that `docker` talks to,
// which changes the disk math and the wording of the startup/post-launch
// diagnostics:
//   - DinD (Docker-in-Docker): the bot runs its own NESTED daemon and isolated
//     tasks run on it. The image must be seeded into that nested store (box
//     host-image passthrough), which copies the multi-GB image — unusable on a
//     host whose free disk cannot hold a second copy.
//   - DooD (Docker-out-of-Docker): the bot shares the HOST daemon (host socket
//     mounted as /var/run/docker.sock, DIND_SKIP_DAEMON=1). Isolated tasks reuse
//     the host's copy of the image — zero copy, zero pull, zero extra disk — and
//     each task still runs in its own container (process/fs/network isolation);
//     only the daemon is shared.
const DOCKER_ISOLATION_MODE_DIND = 'dind';
const DOCKER_ISOLATION_MODE_DOOD = 'dood';
// Sentinel start-command's detached docker logger records when it cannot capture
// the container's real exit code. A terminal `$ --status` carrying this value is
// ambiguous — the container may still be running — so we cross-check it against
// a live `docker inspect` before concluding the session finished. See #1939.
// The upstream emission of this premature sentinel was fixed in
// start-command 0.29.1 (link-foundation/start#136), which the Hive Mind images
// now pin; this cross-check is retained as defense-in-depth so an older `$` on
// an operator's PATH cannot resurrect the bug.
const DOCKER_UNKNOWN_EXIT_CODE = -1;

function isTruthyEnv(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

/**
 * Decide whether a `DOCKER_HOST` value points at a daemon OTHER than the
 * in-container nested default — i.e. a shared/external daemon, which is DooD.
 *
 * `tcp://` and `ssh://` always reach a separate daemon. A `unix://` socket is
 * DooD only when it is NOT the conventional in-container path
 * (`/var/run/docker.sock`), because in DinD the nested daemon also listens
 * there, so that bare value cannot distinguish the two modes (issue #1962).
 */
function dockerHostLooksRemote(dockerHost) {
  const value = String(dockerHost || '')
    .trim()
    .toLowerCase();
  if (!value) return false;
  if (value.startsWith('tcp://') || value.startsWith('ssh://')) return true;
  if (value.startsWith('unix://')) {
    const socketPath = value.slice('unix://'.length);
    return Boolean(socketPath) && socketPath !== '/var/run/docker.sock';
  }
  return false;
}

/**
 * Resolve which Docker isolation MODE the bot runs in: `dind` or `dood`
 * (issue #1962). Resolved from, in priority order:
 *
 *   1. `HIVE_MIND_DOCKER_ISOLATION_MODE` — explicit `dind`|`dood` override.
 *   2. `DIND_SKIP_DAEMON` truthy — box's DooD switch: the entrypoint skips the
 *      nested daemon, so the docker CLI targets the host daemon → DooD.
 *   3. `DOCKER_HOST` pointing at a non-nested daemon (tcp/ssh, or a unix socket
 *      that is not the in-container default) → DooD.
 *   4. Otherwise `dind` — the historical default, so existing DinD deployments
 *      and the diagnostics they rely on are unchanged.
 */
export function resolveDockerIsolationMode({ env = process.env } = {}) {
  const explicit = String(env.HIVE_MIND_DOCKER_ISOLATION_MODE || '')
    .trim()
    .toLowerCase();
  if (explicit === DOCKER_ISOLATION_MODE_DOOD || explicit === DOCKER_ISOLATION_MODE_DIND) return explicit;
  if (isTruthyEnv(env.DIND_SKIP_DAEMON)) return DOCKER_ISOLATION_MODE_DOOD;
  if (dockerHostLooksRemote(env.DOCKER_HOST)) return DOCKER_ISOLATION_MODE_DOOD;
  return DOCKER_ISOLATION_MODE_DIND;
}

/**
 * True when Docker isolation shares the host daemon (DooD) rather than running a
 * nested daemon (DinD). See {@link resolveDockerIsolationMode}. Issue #1962.
 */
export function isDoodIsolationMode({ env = process.env } = {}) {
  return resolveDockerIsolationMode({ env }) === DOCKER_ISOLATION_MODE_DOOD;
}

/**
 * Resolve the home directory that credential mount SOURCES are built from.
 *
 * In DinD the isolated task runs on a nested daemon that shares the bot
 * filesystem, so the bot's own home (`os.homedir()`, e.g. `/home/box`) is the
 * right source — `/home/box/.gitconfig` is the real file. In DooD the task runs
 * on the HOST daemon, where the bot's home paths don't exist; binding them makes
 * Docker auto-create empty directories on the host (the two failures in issue
 * #1962: `.claude.json` "directory onto a file" and an empty git identity).
 *
 * Setting `HIVE_MIND_HOST_CONFIG_DIR` to the host-side config root (where the
 * bot's `~/.gitconfig`, `~/.claude`, … are exposed on the host) relocates the
 * conventional `~/.x` mount sources there so Docker binds the real host files.
 * It only takes effect in DooD; DinD always uses the bot home. See issue #1962.
 */
export function resolveDockerIsolationConfigSourceHome({ env = process.env, homeDir = os.homedir() } = {}) {
  const hostConfigDir = String(env.HIVE_MIND_HOST_CONFIG_DIR || '').trim();
  if (hostConfigDir && isDoodIsolationMode({ env })) return hostConfigDir;
  return homeDir;
}

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
 * GitHub auth is mounted for every task because solve/hive/task need gh. Git
 * identity (`~/.gitconfig` and the XDG `~/.config/git` directory) is mounted for
 * every task too: it is tool-agnostic and `solve` aborts early with "Git
 * identity not configured" when `user.name`/`user.email` are absent, so a child
 * container that authenticates with gh but inherits no git identity still cannot
 * commit. See issue #1939. Tool credentials are deliberately scoped: Codex
 * sessions do not receive Claude files and Claude sessions do not receive Codex
 * files.
 */
export function getDockerIsolationAuthMounts({ tool = 'claude', env = process.env, homeDir = os.homedir(), existsSync = fs.existsSync } = {}) {
  const mounts = [];
  const normalizedTool = normalizeTool(tool);

  // Credential mount SOURCES are resolved against the bot's home in DinD (the
  // nested daemon shares the bot filesystem, so `/home/box/.gitconfig` is the
  // real file). In DooD the task runs on the HOST daemon, where those bot paths
  // don't exist — Docker then auto-creates them as empty DIRECTORIES, breaking
  // file mounts (`.claude.json` / `.gitconfig` "directory onto a file") and
  // yielding an empty git identity. When the operator points
  // HIVE_MIND_HOST_CONFIG_DIR at the host-side config root, resolve the
  // conventional `~/.x` sources against it so Docker binds the real host files.
  // Because the bot cannot stat host paths, relocated sources skip the bot-FS
  // existence gate (trust the operator's host layout). See issue #1962.
  const sourceHome = resolveDockerIsolationConfigSourceHome({ env, homeDir });
  const relocated = sourceHome !== homeDir;
  const add = (source, target, { readOnly = false } = {}) => {
    if (!source) return;
    if (relocated || existsSync(source)) mounts.push(readOnly ? { source, target, readOnly: true } : { source, target });
  };

  add(env.GH_CONFIG_DIR || path.join(sourceHome, '.config', 'gh'), path.join(DOCKER_CONTAINER_HOME, '.config', 'gh'));

  // Git identity (tool-agnostic, required for commits). Honor the same env vars
  // git itself reads for an alternate global config location (GIT_CONFIG_GLOBAL)
  // and the XDG base dir, falling back to the conventional `~/.gitconfig` and
  // `~/.config/git`. Missing host paths are skipped, so a container image that
  // already bakes a git identity is left untouched. See issue #1939.
  //
  // Mounted READ-ONLY (`:ro`). The task only READS the git identity to commit; it
  // must never write through the mount. `~/.gitconfig` as a single-file bind mount
  // is the one credential that breaks under writes: `git config --global` (e.g.
  // `gh-setup-git-identity --repair`) writes a temp file and rename()s it over the
  // target, and rename-over-a-mountpoint fails with "Device or resource busy"
  // (git config exits 4). A `:ro` mount makes the read-only contract explicit and
  // turns any stray write attempt into an immediate, legible error instead of a
  // confusing mid-run failure. The bot's OWN identity must be populated on a path
  // that is NOT this mount (write-then-copy, or a mounted directory with
  // GIT_CONFIG_GLOBAL) — see docs/DOCKER-ISOLATION.md. Issue #1962.
  add(env.GIT_CONFIG_GLOBAL || path.join(sourceHome, '.gitconfig'), path.join(DOCKER_CONTAINER_HOME, '.gitconfig'), { readOnly: true });
  add(env.XDG_CONFIG_HOME ? path.join(env.XDG_CONFIG_HOME, 'git') : path.join(sourceHome, '.config', 'git'), path.join(DOCKER_CONTAINER_HOME, '.config', 'git'), { readOnly: true });

  if (normalizedTool === 'codex') {
    add(path.join(sourceHome, '.codex'), path.join(DOCKER_CONTAINER_HOME, '.codex'));
  } else if (normalizedTool === 'claude') {
    add(path.join(sourceHome, '.claude'), path.join(DOCKER_CONTAINER_HOME, '.claude'));
    add(path.join(sourceHome, '.claude.json'), path.join(DOCKER_CONTAINER_HOME, '.claude.json'));
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
    startArgs.push('--volume', mount.readOnly ? `${mount.source}:${mount.target}:ro` : `${mount.source}:${mount.target}`);
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

/**
 * Decide whether a detached-docker exit code is "unknown" (not a real result).
 *
 * start-command's detached docker logger writes the exit-code footer only after
 * `docker logs -f` returns, capturing the real code via `docker inspect`. When
 * it cannot capture one it records the sentinel `-1`. A `$ --status` that
 * reports a terminal status ("executed") while still carrying that sentinel — or
 * no exit code at all — is therefore ambiguous: the container may actually still
 * be running. Callers treat such a status as provisional and cross-check the
 * live container before declaring the session finished. See issue #1939.
 *
 * @param {number|null|undefined} exitCode
 * @returns {boolean} True when the exit code carries no real result.
 */
export function isUnknownDockerExitCode(exitCode) {
  return exitCode === null || exitCode === undefined || Number(exitCode) === DOCKER_UNKNOWN_EXIT_CODE;
}

export function shouldFallbackToScreenStatus(statusResult) {
  return !statusResult?.exists || !statusResult?.status;
}

/**
 * Parse the footer start-command appends to every execution log when the wrapped
 * command exits. The footer is authoritative about the terminal exit code even
 * when `$ --status` is wrong: start-command writes it from the command's own
 * `close`/`exited` handler, so its presence proves the command terminated.
 *
 * Footer shape (see start-command spawn-helpers.js):
 *
 *     ==================================================
 *     Finished: 2026-06-14 19:10:49.822
 *     Exit Code: 137
 *
 * Issue #1927: start-command's `enrichDetachedStatus` can flip a completed
 * `executed/137` record back to `executing` (nulling the exit code) when a
 * lingering shell keeps the screen session alive — so `$ --status` reports
 * `executing` forever and the bot never notices the kill. Reading this footer
 * lets hive-mind detect the real terminal exit regardless of that flip.
 *
 * @param {string} text - Log text (typically the tail of the log file)
 * @returns {{finished: boolean, exitCode: number|null, endTime: string|null}}
 */
export function parseSessionExitFooter(text) {
  if (!text) return { finished: false, exitCode: null, endTime: null };
  // Match the LAST footer block in the text (a re-run could append more than
  // one). Anchor on the `=` separator so command output that merely prints
  // "Exit Code: N" mid-stream is not mistaken for the footer.
  const re = /={10,}\s*\r?\nFinished:\s*([^\r\n]+)\r?\nExit Code:\s*(-?\d+)/g;
  let match;
  let last = null;
  while ((match = re.exec(text)) !== null) last = match;
  if (!last) return { finished: false, exitCode: null, endTime: null };
  return { finished: true, exitCode: Number(last[2]), endTime: last[1].trim() };
}

/**
 * Read the terminal exit code from the tail of a start-command execution log.
 *
 * Only the last `tailBytes` of the file are read (the footer lives at the end),
 * so this is cheap even for multi-megabyte logs. Never throws — a missing or
 * unreadable log yields `{ finished: false }`.
 *
 * @param {string} logPath
 * @param {Object} [options]
 * @param {Object} [options.fsImpl=fs] - Injectable fs (for tests)
 * @param {number} [options.tailBytes=16384] - How many trailing bytes to scan
 * @param {boolean} [options.verbose]
 * @returns {{finished: boolean, exitCode: number|null, endTime: string|null}}
 */
export function readSessionExitFromLog(logPath, options = {}) {
  const { fsImpl = fs, tailBytes = 16384, verbose = false } = options;
  if (!logPath) return { finished: false, exitCode: null, endTime: null };
  try {
    const { size } = fsImpl.statSync(logPath);
    if (!size) return { finished: false, exitCode: null, endTime: null };
    const start = Math.max(0, size - tailBytes);
    const length = size - start;
    const buffer = Buffer.alloc(length);
    const fd = fsImpl.openSync(logPath, 'r');
    try {
      fsImpl.readSync(fd, buffer, 0, length, start);
    } finally {
      fsImpl.closeSync(fd);
    }
    const result = parseSessionExitFooter(buffer.toString('utf8'));
    if (verbose && result.finished) {
      console.log(`[VERBOSE] isolation-runner: log footer for ${logPath} reports exit ${result.exitCode} (finished ${result.endTime})`);
    }
    return result;
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] isolation-runner: could not read exit footer from ${logPath}: ${error.message}`);
    }
    return { finished: false, exitCode: null, endTime: null };
  }
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
 * Verbose post-launch diagnostics for a native docker-isolated session.
 *
 * Logs, side by side: what `$ --status` reports (status + exit code) and what
 * the nested Docker daemon reports for the container (running state + image
 * presence). The two together make problems #1 and #2 of issue #1939
 * observable on the next run — a status of "executed"/-1 while `docker inspect`
 * says the container is running is the premature-completion symptom (problem
 * #1); an isolation image that is absent right after launch points at a missing
 * host-image passthrough that forced a re-pull (problem #2). Best-effort: any
 * probe failure is swallowed so diagnostics never disrupt the task.
 *
 * @param {string} sessionId - Session UUID (also the container name)
 * @param {Object} [env] - Environment used to resolve the isolation image
 */
async function logDockerIsolationPostLaunchDiagnostics(sessionId, env = process.env) {
  try {
    const status = await querySessionStatus(sessionId, false);
    console.log(`[VERBOSE] isolation-runner: Docker post-launch $ --status: status=${status.status ?? '(none)'} exitCode=${status.exitCode ?? '(none)'} exists=${status.exists} (issue #1939)`);
    const containerRunning = await checkDockerContainerRunning(sessionId, false);
    console.log(`[VERBOSE] isolation-runner: Docker post-launch container '${sessionId}' running=${containerRunning} (issue #1939)`);
    if (status.exists && isTerminalSessionStatus(status.status) && isUnknownDockerExitCode(status.exitCode) && containerRunning) {
      console.log(`[VERBOSE] isolation-runner: ⚠️ Docker session '${sessionId}' reports a terminal status with the unknown exit-code sentinel while its container is still running — premature-completion symptom (issue #1939, problem #1)`);
    }
    const image = getDockerIsolationImage({ env });
    const imagePresent = await checkDockerImagePresent(image, false);
    const dood = isDoodIsolationMode({ env });
    console.log(`[VERBOSE] isolation-runner: Docker post-launch isolation image '${image}' present=${imagePresent} on the ${dood ? 'host' : 'nested'} daemon (issue #1939)`);
    if (!imagePresent) {
      // The remediation differs by mode: in DinD an absent image means the
      // nested daemon was not seeded (passthrough); in DooD it means the HOST
      // daemon simply lacks the concrete tag, so don't false-warn about a
      // passthrough that does not exist in DooD (issue #1962).
      if (dood) {
        console.log(`[VERBOSE] isolation-runner: ⚠️ Docker isolation image '${image}' is absent on the host daemon right after launch — the host did not hold this concrete tag, so the task re-pulled it. Pull/pin '${image}' on the host for zero-copy reuse (issue #1962)`);
      } else {
        console.log(`[VERBOSE] isolation-runner: ⚠️ Docker isolation image '${image}' is absent right after launch — host-image passthrough likely did not seed the nested daemon, so the task re-pulled it (issue #1939, problem #2)`);
      }
    }
  } catch {
    // Diagnostics are best-effort; never let a probe failure affect the task.
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
      const mode = resolveDockerIsolationMode({ env });
      console.log(`[VERBOSE] isolation-runner: Docker isolation mode: ${mode} (${mode === DOCKER_ISOLATION_MODE_DOOD ? 'DooD — "docker" targets the HOST daemon; tasks reuse the host image with zero copy/zero pull (issue #1962)' : 'DinD — "docker" targets the bot\'s NESTED daemon; the image must be seeded into it (host-image passthrough)'})`);
      console.log(`[VERBOSE] isolation-runner: Docker isolation image: ${image}`);
      console.log(`[VERBOSE] isolation-runner: Docker isolation privileged: ${shouldRunPrivilegedDockerIsolation(image, env)}`);
      console.log('[VERBOSE] isolation-runner: Docker isolation pull: reuse local image if present, pull only if missing (start-command default)');
      console.log(`[VERBOSE] isolation-runner: Docker isolation mounts: ${mounts.map(m => (m.readOnly ? `${m.target} (ro)` : m.target)).join(', ') || '(none)'}`);
      const gitIdentityMounted = mounts.some(m => m.target === path.join(DOCKER_CONTAINER_HOME, '.gitconfig') || m.target === path.join(DOCKER_CONTAINER_HOME, '.config', 'git'));
      console.log(`[VERBOSE] isolation-runner: Docker isolation git identity propagated: ${gitIdentityMounted ? 'yes' : 'no (host ~/.gitconfig missing — child may fail with "Git identity not configured", issue #1939)'}`);
    }
  }

  const result = await runStartCommand(binPath, startCommandArgs);

  if (verbose) {
    const stream = result.success ? console.log : console.error;
    stream(`[VERBOSE] isolation-runner: Output: ${result.output.substring(0, 500)}`);
    if (result.error) stream(`[VERBOSE] isolation-runner: Error: ${result.error}`);
  }

  // Issue #1939: capture the freshly-launched docker session's reported status
  // and the live container state together, so the next iteration has the data to
  // diagnose a premature "executed/-1" status (problem #1) or a surprise image
  // re-pull (problem #2). Best-effort and verbose-only — never affects the run.
  if (verbose && backend === 'docker' && result.success) {
    await logDockerIsolationPostLaunchDiagnostics(sessionId, options.env || process.env);
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
 * Parse output from `$ --list --output-format json`.
 *
 * start-command may return a top-level array, or an object with an
 * `executions`/`sessions` array. Each entry is normalized to the same shape used
 * by {@link parseSessionStatusOutput} (uuid/status/exitCode/command/isolation/…).
 * Tolerant of unknown layouts — anything unparseable yields an empty list.
 *
 * @param {string} output - Raw stdout from `$ --list`
 * @returns {Array<{uuid: string|null, status: string|null, exitCode: number|null, startTime: string|null, endTime: string|null, command: string|null, isolation: string|null, workingDirectory: string|null, sessionName: string|null}>}
 */
export function parseSessionListOutput(output) {
  const raw = (output || '').trim();
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.executions) ? parsed.executions : Array.isArray(parsed?.sessions) ? parsed.sessions : parsed && typeof parsed === 'object' ? [parsed] : [];

  return records
    .map(data => {
      if (!data || typeof data !== 'object') return null;
      const isolationCandidate = (typeof data.isolation === 'string' && data.isolation) || (typeof data.options?.isolated === 'string' && data.options.isolated) || (typeof data.options?.isolation === 'string' && data.options.isolation) || null;
      return {
        uuid: data.uuid || data.session || data.sessionId || null,
        status: typeof data.status === 'string' ? data.status.toLowerCase() : null,
        exitCode: data.exitCode !== undefined && data.exitCode !== null ? Number(data.exitCode) : null,
        startTime: data.startTime || null,
        endTime: data.endTime || null,
        command: data.command || null,
        isolation: isolationCandidate ? isolationCandidate.toLowerCase() : null,
        workingDirectory: data.workingDirectory || null,
        sessionName: data.sessionName || data.options?.sessionName || null,
      };
    })
    .filter(Boolean);
}

/**
 * List all executions known to start-command via `$ --list --output-format json`.
 *
 * Unlike `$ --status`, the `--list` path does NOT run start-command's
 * `enrichDetachedStatus` liveness gate, so it reports the recorded status/exit
 * code as stored. Used by the bot's restart-resume scan to discover detached
 * solve/hive/task sessions that were launched before the bot last started
 * (issue #1927, requirement #2). Never throws — returns an empty list on any
 * failure.
 *
 * @param {boolean} [verbose]
 * @returns {Promise<Array<object>>} Normalized session records (see parseSessionListOutput)
 */
export async function listIsolationSessions(verbose = false) {
  const binPath = await findStartCommandBinary();
  if (!binPath) {
    if (verbose) console.log('[VERBOSE] isolation-runner: Cannot list sessions - $ binary not found');
    return [];
  }
  try {
    const result = await $({ mirror: false })`${binPath} --list --output-format json`;
    const stdout = result.stdout?.toString().trim() || '';
    const sessions = parseSessionListOutput(stdout);
    if (verbose) console.log(`[VERBOSE] isolation-runner: $ --list returned ${sessions.length} session(s)`);
    return sessions;
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] isolation-runner: $ --list error: ${error.message}`);
    return [];
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
 * Check whether a tmux session with the given name still exists.
 * `tmux has-session -t <name>` exits 0 when it exists and non-zero otherwise,
 * so command-stream throwing is treated as "not found".
 *
 * @param {string} sessionName
 * @param {boolean} [verbose]
 * @returns {Promise<boolean>}
 */
export async function checkTmuxSessionRunning(sessionName, verbose = false) {
  try {
    await $({ mirror: false })`tmux has-session -t ${sessionName}`;
    if (verbose) console.log(`[VERBOSE] isolation-runner: tmux has-session '${sessionName}': running`);
    return true;
  } catch {
    if (verbose) console.log(`[VERBOSE] isolation-runner: tmux has-session '${sessionName}': not found`);
    return false;
  }
}

/**
 * Directly probe whether the backend session/container is still alive, bypassing
 * `$ --status`. This is the cross-check used to detect a session that
 * start-command still reports as `executing` even though its backing process is
 * gone (issue #1927). Returns `null` for unknown backends so callers can treat
 * an indeterminate probe as "no signal" rather than "dead".
 *
 * @param {string} sessionId - Session UUID (also the screen name / container name)
 * @param {string} backend - 'screen' | 'tmux' | 'docker'
 * @param {boolean} [verbose]
 * @returns {Promise<boolean|null>}
 */
export async function checkBackendSessionAlive(sessionId, backend, verbose = false) {
  if (backend === 'screen') return checkScreenSessionRunning(sessionId, verbose);
  if (backend === 'tmux') return checkTmuxSessionRunning(sessionId, verbose);
  if (backend === 'docker') return checkDockerContainerRunning(sessionId, verbose);
  return null;
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
 * In DooD mode (issue #1962) the daemon is the HOST daemon, so there is no
 * nested store and no host-image passthrough: the socket/passthrough warnings
 * are replaced with host-daemon, concrete-tag guidance and the "nested daemon"
 * wording is dropped so the diagnostics never false-warn.
 *
 * @param {Object} [options]
 * @param {Object} [options.env] - Environment (defaults to process.env)
 * @param {Function} [options.existsSync] - fs.existsSync (injectable for tests)
 * @param {boolean} [options.verbose] - Enable verbose logging
 * @param {Object} [options.logger] - Logger with .log/.warn (defaults to console)
 * @param {Function} [options.checkImagePresent] - Image-presence probe (injectable for tests)
 * @param {Function} [options.checkStorageDriver] - Storage-driver probe (injectable for tests)
 * @param {Function} [options.checkDiskSpace] - Disk-space probe (injectable for tests)
 * @returns {Promise<{image: string, sock: string, socketMounted: boolean, imagePresent: boolean, isDind: boolean, mode: string, storageDriver: (string|null), storageDriverOk: boolean, diskAvailableGiB: (number|null), ok: boolean, warnings: string[]}>}
 */
export async function preflightDockerIsolation(options = {}) {
  const { env = process.env, existsSync = fs.existsSync, verbose = false, logger = console, checkImagePresent = checkDockerImagePresent, checkStorageDriver = checkDockerStorageDriver, checkDiskSpace = checkDockerDiskSpace } = options;

  const image = getDockerIsolationImage({ env });
  const sock = resolveHostDockerSock({ env });
  const isDind = shouldRunPrivilegedDockerIsolation(image, env);
  const mode = resolveDockerIsolationMode({ env });
  const isDood = mode === DOCKER_ISOLATION_MODE_DOOD;
  const socketMounted = Boolean(existsSync(sock));
  const imagePresent = Boolean(await checkImagePresent(image, verbose));
  const storageDriver = await checkStorageDriver(verbose);
  const disk = await checkDiskSpace(verbose);
  const diskAvailableGiB = disk && Number.isFinite(disk.availableGiB) ? disk.availableGiB : null;
  // Unknown driver (probe returned null) is treated as ok — we only flag the
  // one driver known to overflow the disk, never block on missing information.
  const storageDriverOk = storageDriver !== 'vfs';

  const result = { image, sock, socketMounted, imagePresent, isDind, mode, storageDriver, storageDriverOk, diskAvailableGiB, ok: imagePresent, warnings: [] };
  const info = typeof logger.log === 'function' ? logger.log.bind(logger) : () => {};
  const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : info;

  // "host" vs "nested" daemon — the only word that changes between DooD and DinD
  // in the shared parts of the diagnostics.
  const daemonLabel = isDood ? 'host' : 'nested';
  const preload = `node scripts/preload-dind-isolation-image.mjs --image ${image}`;

  // Root Cause A of the issue #1914 reopen: a non-copy-on-write storage driver.
  // `vfs` stores a full copy of every image layer, so the multi-GB images
  // consume many times their size on disk and any layer write (pull, run,
  // commit) can fail with `failed to register layer: no space left on device`.
  // This is dangerous even when the image is already present — a task that
  // commits or pulls more layers still overflows — so we warn independent of
  // image presence. The remediation differs by mode: a nested daemon is
  // reconfigured via the DIND_* env / Dockerfile.dind; the host daemon is
  // reconfigured on the host (issue #1962).
  if (storageDriver === 'vfs') {
    const fix = isDood ? `Switch the HOST Docker daemon to a copy-on-write driver (e.g. set '"storage-driver": "overlay2"' in /etc/docker/daemon.json and restart dockerd).` : `Switch to a copy-on-write driver: rebuild/redeploy with the current Dockerfile.dind (it defaults to 'fuse-overlayfs'), or for an already-running container add '-e DIND_STORAGE_DRIVER=fuse-overlayfs' to the bot container's 'docker run' and recreate it.`;
    result.warnings.push(`The Docker daemon backing '--isolation docker' is using the 'vfs' storage driver, which performs NO copy-on-write: ` + `it stores a full copy of every image layer, so the multi-GB Hive Mind images consume many times their size on disk and isolated tasks can fail with 'failed to register layer: no space left on device' (issue #1914). ` + fix);
  }

  if (!imagePresent) {
    // Image absent: the first isolated task will pull the full image. Explain
    // the most likely cause and the exact fix instead of letting the operator
    // first discover it as a surprise multi-gigabyte download mid-task.
    if (isDood) {
      // DooD: the daemon is the host daemon, so there is no nested store to seed
      // and no passthrough — the host simply does not hold this concrete tag.
      result.warnings.push(`Docker isolation image '${image}' is NOT present on the host Docker daemon (DooD mode). ` + `The FIRST isolated task will pull the full image (the Hive Mind images are multiple GB) instead of reusing a host copy. ` + `For zero-copy reuse, pull the EXACT tag on the host before starting tasks: 'docker pull ${image}' (pin HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG to that version — never rely on a floating ':latest', which re-pulls on digest drift). See issue #1962.`);
    } else if (isDind && !socketMounted) {
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
      const seed = isDood ? `Pull '${image}' on the host (it already has it if you deployed in DooD for zero-copy reuse), and free space on the Docker data root.` : `Seed it via host passthrough (mount the host docker socket) or with '${preload}', and free space on the Docker data root.`;
      result.warnings.push(`Only ~${diskAvailableGiB.toFixed(0)} GiB free on ${root} and the isolation image '${image}' is not present yet. ` + `The Hive Mind isolation image is well over 30 GB extracted, so the first isolated task's pull may fail with 'no space left on device' (issue #1914). ` + seed);
    }
  }

  if (imagePresent) {
    const reuse = isDood ? `isolated tasks reuse the host copy (zero copy, zero pull, zero extra disk — issue #1962).` : `isolated tasks reuse it (no multi-GB pull). See issue #1914.`;
    info(`✅ Docker isolation image '${image}' is already present on the ${daemonLabel} Docker daemon — ${reuse}`);
  }
  for (const w of result.warnings) warn(`⚠️ ${w}`);
  return result;
}

/**
 * Host paths that, when present, propagate a git identity into a docker-isolated
 * container via getDockerIsolationAuthMounts. Honors the same env vars git reads
 * for an alternate global config (GIT_CONFIG_GLOBAL) and the XDG base dir, then
 * the conventional `~/.gitconfig` and `~/.config/git`. See issue #1939.
 */
export function resolveHostGitIdentityPaths({ env = process.env, homeDir = os.homedir() } = {}) {
  return [env.GIT_CONFIG_GLOBAL || path.join(homeDir, '.gitconfig'), env.XDG_CONFIG_HOME ? path.join(env.XDG_CONFIG_HOME, 'git') : path.join(homeDir, '.config', 'git')];
}

/**
 * True when the host exposes a git identity that getDockerIsolationAuthMounts can
 * mount into an isolated container. See issue #1939.
 */
export function hostHasMountableGitIdentity({ env = process.env, homeDir = os.homedir(), existsSync = fs.existsSync } = {}) {
  return resolveHostGitIdentityPaths({ env, homeDir }).some(p => Boolean(existsSync(p)));
}

/**
 * Startup git-identity preflight for `--isolation docker`.
 *
 * A docker-isolated child container starts from a clean image and inherits the
 * host's git identity ONLY through the mounted `~/.gitconfig`
 * (getDockerIsolationAuthMounts). If the host has no git identity to mount, the
 * child `solve` aborts with "Git identity not configured" even though gh is
 * authenticated — the exact failure in issue #1939.
 *
 * This makes the deployment self-healing: when the host has no mountable git
 * identity but `gh-setup-git-identity` is installed (the Hive Mind images bake
 * it in) and gh is authenticated, it derives an identity from the gh account so
 * the mount has something to propagate. The repair is idempotent — it runs only
 * when no identity exists, so it never overwrites a configured one — and
 * best-effort: any failure degrades to a loud, actionable warning rather than a
 * thrown error. When neither a host identity nor a repair is possible, the
 * warning tells the operator exactly how to fix it.
 *
 * @param {Object} [options]
 * @param {Object} [options.env] - Environment (defaults to process.env)
 * @param {string} [options.homeDir] - Home dir (injectable for tests)
 * @param {Function} [options.existsSync] - fs.existsSync (injectable for tests)
 * @param {Object} [options.logger] - Logger with .log/.warn (defaults to console)
 * @param {Function} [options.repair] - repairGitIdentity-style probe (injectable for tests)
 * @returns {Promise<{present: boolean, repaired: boolean, warnings: string[]}>}
 */
export async function ensureHostGitIdentityForIsolation(options = {}) {
  const { env = process.env, homeDir = os.homedir(), existsSync = fs.existsSync, logger = console, repair = null } = options;
  const info = typeof logger.log === 'function' ? logger.log.bind(logger) : () => {};
  const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : info;
  const result = { present: false, repaired: false, warnings: [] };

  if (hostHasMountableGitIdentity({ env, homeDir, existsSync })) {
    result.present = true;
    info('✅ Host git identity present — docker-isolated tasks inherit it via the mounted ~/.gitconfig (issue #1939).');
    return result;
  }

  // No mountable identity. Try to derive one from the authenticated gh account
  // so the next isolated task does not fail with "Git identity not configured".
  const repairFn =
    repair ||
    (async () => {
      const gitLib = await import('./git.lib.mjs');
      return gitLib.repairGitIdentity();
    });
  let repairOutcome = null;
  try {
    repairOutcome = await repairFn();
  } catch (error) {
    repairOutcome = { success: false, error: error?.message || String(error) };
  }

  if (repairOutcome?.success && hostHasMountableGitIdentity({ env, homeDir, existsSync })) {
    result.present = true;
    result.repaired = true;
    info('✅ Host git identity was missing; derived it from the authenticated gh account via gh-setup-git-identity so docker-isolated tasks can mount it (issue #1939).');
    return result;
  }

  result.warnings.push(`No host git identity (~/.gitconfig) to mount into docker-isolated containers, so isolated 'solve' tasks will fail with "Git identity not configured" even though gh is authenticated (issue #1939). ` + `Configure one on the bot host: run 'gh-setup-git-identity' (derives it from the authenticated gh account), set 'git config --global user.name/.email', or pass '--auto-gh-configuration-repair' to solve.` + (repairOutcome?.error ? ` Auto-repair attempt failed: ${repairOutcome.error}` : ''));
  for (const w of result.warnings) warn(`⚠️ ${w}`);
  return result;
}

/**
 * Startup credential-mount preflight for DooD `--isolation docker`.
 *
 * `getDockerIsolationAuthMounts` binds the bot's `~/.config/gh`, `~/.gitconfig`,
 * `~/.claude[.json]` / `~/.codex` into each task. Those mount SOURCES are the
 * bot's home paths, which only resolve correctly when the task daemon shares the
 * bot filesystem (DinD). In DooD the task runs on the HOST daemon, where those
 * paths don't exist — Docker auto-creates them as empty DIRECTORIES, which is
 * the root cause of the two failures in issue #1962:
 *
 *   1. `.claude.json` / `.gitconfig` bind fails with "Are you trying to mount a
 *      directory onto a file (or vice-versa)?" — the task dies before it starts.
 *   2. The git identity is empty ("fatal: empty ident name (for <>)") because the
 *      mounted `~/.gitconfig` is an empty dir.
 *
 * This preflight makes that trap loud and actionable before the first task,
 * instead of surfacing as a raw Docker mount error mid-run. DinD is unaffected
 * (it shares the bot filesystem, so the same sources are the real files), and
 * setting `HIVE_MIND_HOST_CONFIG_DIR` (see
 * {@link resolveDockerIsolationConfigSourceHome}) clears the warning.
 *
 * The warning is mode-level (it names both the Claude and Codex config files), so
 * it does not depend on which tool a given task uses.
 *
 * @param {Object} [options]
 * @param {Object} [options.env] - Environment (defaults to process.env)
 * @param {string} [options.homeDir] - Bot home dir (injectable for tests)
 * @param {Object} [options.logger] - Logger with .log/.warn (defaults to console)
 * @returns {Promise<{mode: string, ok: boolean, warnings: string[]}>}
 */
export async function preflightDockerIsolationAuthMounts({ env = process.env, homeDir = os.homedir(), logger = console } = {}) {
  const info = typeof logger.log === 'function' ? logger.log.bind(logger) : () => {};
  const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : info;
  const mode = resolveDockerIsolationMode({ env });
  const result = { mode, ok: true, warnings: [] };

  // DinD shares the bot filesystem, so the bot-home mount sources are the real
  // files — nothing to validate here.
  if (mode !== DOCKER_ISOLATION_MODE_DOOD) return result;

  const sourceHome = resolveDockerIsolationConfigSourceHome({ env, homeDir });
  if (sourceHome !== homeDir) {
    info(`✅ DooD: credential mount sources resolved against HIVE_MIND_HOST_CONFIG_DIR ('${sourceHome}') so the HOST daemon binds the real config files (issue #1962).`);
    return result;
  }

  result.ok = false;
  result.warnings.push(`Docker isolation is in DooD mode but credential mount sources are the bot's home paths (e.g. '${path.join(homeDir, '.gitconfig')}', '${path.join(homeDir, '.claude.json')}'). ` + `Isolated tasks run on the HOST daemon, where those paths usually do not exist, so Docker auto-creates them as empty DIRECTORIES — breaking file mounts ('.claude.json'/'.gitconfig' fail with "directory onto a file") and producing an empty git identity ("fatal: empty ident name") (issue #1962). ` + `Expose the bot's ~/.config/gh, ~/.claude, ~/.claude.json, ~/.codex and ~/.gitconfig at the SAME host paths (symlinks work — Docker follows symlink mount sources), or set HIVE_MIND_HOST_CONFIG_DIR to the host-side config root. See docs/DOCKER-ISOLATION.md.`);
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
      // Issue #1939: a native docker session can report a terminal status
      // ("executed") while the container is still alive, carrying the unknown
      // exit-code sentinel (-1) because start-command's detached logger marks
      // the launcher process executed before the container exits. Trust the
      // terminal status only when a real exit code was captured; otherwise
      // cross-check the live container before declaring the session finished.
      if (backend === 'docker' && isUnknownDockerExitCode(result.exitCode)) {
        const containerRunning = await checkDockerContainerRunning(sessionId, verbose);
        if (containerRunning) {
          if (verbose) {
            console.log(`[VERBOSE] isolation-runner: $ --status reports '${result.status}' (exitCode ${result.exitCode}) for docker session '${sessionId}', but docker inspect shows the container is still running — treating as active (issue #1939)`);
          }
          return true;
        }
      }
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
