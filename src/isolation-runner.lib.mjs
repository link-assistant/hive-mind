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
import { describeChildExit } from './child-exit.lib.mjs';
import { lookup as lookupHost } from 'node:dns/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isExecutingSessionStatus, isTerminalSessionStatus } from './session-status.lib.mjs';
import { acquireFormalAiSidecarForTask, attachFormalAiTaskContainer, releaseFormalAiSidecarForTask } from './formal-ai-isolation.lib.mjs';
// The image references live in their own module so the Formal AI sidecar can
// resolve the locally present Hive Mind image (which bakes `formal-ai`) without
// importing this runner and creating a cycle. Re-exported here because callers
// and tests have always reached them through the isolation runner. See #2154.
import { getDockerIsolationImage } from './hive-mind-image.lib.mjs';
import { buildRouterGitConfigEntries, buildRouterTaskEnv, getRouterSuppressedCredentialPaths, hasUseRouterFlag, isRouterEnabled, resolveRouterBaseUrl, resolveRouterGitHubRouting } from './router-isolation.lib.mjs';
import { acquireRouterForTask, attachRouterTaskContainer, registerFormalAiWithRouter, releaseRouterForTask } from './router-task-isolation.lib.mjs';
import { buildGitConfigEnv, GIT_PUSH_GUARD_CONTAINER_DIR, GIT_PUSH_GUARD_ESCAPE_ENV, hasForcePushOptIn, installGitPushGuard } from './git-push-guard.lib.mjs';
export { getDockerIsolationImage, resolveDockerIsolationImageTag } from './hive-mind-image.lib.mjs';
// Re-export the shared status predicates so existing callers that reach them via the isolation-runner module (e.g. session-monitor's `runner.isExecutingSessionStatus`) keep working. The canonical definitions live in session-status.lib.mjs so the killed/terminated/oom vocabulary stays consistent everywhere (issue #1927).
export { isExecutingSessionStatus, isTerminalSessionStatus, isKilledSessionStatus } from './session-status.lib.mjs';
// Issue #2175: the `$` output parsers live in their own module to keep this file
// under the 1350-line warning threshold. Re-exported so importers are unaffected.
import { isUnknownDockerExitCode, parseSessionExitFooter, parseSessionListOutput, parseSessionStatusOutput, parseStartCommandExecutionUuid, readSessionExitFromLog, shouldFallbackToScreenStatus } from './isolation-runner.parsers.lib.mjs';
export { isUnknownDockerExitCode, parseSessionExitFooter, parseSessionListOutput, parseSessionStatusOutput, parseStartCommandExecutionUuid, readSessionExitFromLog, shouldFallbackToScreenStatus };
// Issue #2189: the `$` loader and PATH lookup live in their own module so the
// resume/attach wrappers can use them without importing this runner (a cycle).
import { findStartCommandBinary, getCommandStreamDollar } from './start-command-cli.lib.mjs';
export { findStartCommandBinary };
// Issue #2189: `$ --resume` / `$ --resume-all`, added in start-command 0.33.0
// (link-foundation/start#162). Re-exported so callers keep reaching every
// isolation verb through this module.
import { resumeAllIsolationSessions, resumeIsolatedSession } from './isolation-runner.resume.lib.mjs';
export { resumeAllIsolationSessions, resumeIsolatedSession };
export { parseExecutionResumeAllOutput, parseExecutionResumeOutput, RESUME_ALL_ACTIONS, RESUME_MODES } from './isolation-runner.resume.lib.mjs';
// Valid isolation backends
const VALID_ISOLATION_BACKENDS = ['screen', 'tmux', 'docker'];
const DOCKER_CONTAINER_HOME = '/home/box';
const FORMAL_AI_COMPOSE_HOSTNAME = 'link-assistant-formal-ai';
// Default path where the host Docker socket is bind-mounted inside a DinD container so box's host-image passthrough can copy host images into the nested daemon. Matches box's own DIND_HOST_DOCKER_SOCK default. The deploy must mount it (`-v /var/run/docker.sock:/var/run/host-docker.sock:ro`) or the nested daemon starts empty and the first isolated task pulls the full, multi-gigabyte image. See issue #1914.
const DEFAULT_HOST_DOCKER_SOCK = '/var/run/host-docker.sock';
// Force a POSIX shell for the inner command of Docker-isolated tasks. solve/ hive/task live on the image's baked-in PATH, so `sh -c` resolves them without needing a login shell. Forcing the shell (instead of start's 'auto') also skips start's shell-detection probe, which would otherwise `docker run` a throwaway container — booting the dind image's dockerd entrypoint — purely to check whether bash exists. See issue #1914.
const DOCKER_ISOLATION_SHELL = 'sh';
// Free-space floor (GiB) below which the preflight warns that an impending isolation-image pull may fail with `no space left on device`. The Hive Mind isolation images are well over 30 GB extracted, so a host/nested daemon with less headroom than this cannot safely pull one. Diagnostic only — never blocks startup. See issue #1914.
const DOCKER_ISOLATION_LOW_DISK_GIB = 40;
// Docker-only start gate used to capture the container writable-layer baseline before the task command begins cloning or generating files. The parent releases the gate immediately after `docker inspect --size`; the fallback keeps the task from hanging forever if the parent exits at the wrong time.
const DOCKER_START_GATE_WAIT_TENTHS = 300;
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
function buildDockerStartGatePath(sessionId) {
  return sessionId ? `/tmp/hive-mind-disk-baseline-${sessionId}` : null;
}
function buildDockerStartGatedCommand(taskCommand, sessionId) {
  const gatePath = buildDockerStartGatePath(sessionId);
  if (!gatePath) return taskCommand;
  return `gate=${shellQuote(gatePath)}; i=0; while [ ! -e "$gate" ] && [ "$i" -lt ${DOCKER_START_GATE_WAIT_TENTHS} ]; do i=$((i+1)); sleep 0.1; done; rm -f "$gate"; exec ${taskCommand}`;
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
 *
 * Issue #2164 (EXPERIMENTAL): with `useRouter` the vendor credential mounts are
 * withheld entirely, so the task never holds the subscription — it reaches the
 * `hive-mind-router` sidecar with its own scoped token instead. Git identity is
 * still mounted, because it carries no secret and `solve` aborts without it
 * (issue #1939). The gh config is only withheld when `ghRouted` says gh has
 * somewhere else to go; otherwise the task would lose GitHub access entirely.
 */
export function getDockerIsolationAuthMounts({ tool = 'claude', env = process.env, homeDir = os.homedir(), existsSync = fs.existsSync, useRouter = false, ghRouted = false } = {}) {
  const mounts = [];
  const normalizedTool = normalizeTool(tool);
  const suppressed = useRouter ? new Set(getRouterSuppressedCredentialPaths({ tool: normalizedTool, ghRouted })) : new Set();
  if (!suppressed.has('.config/gh')) {
    maybeAddMount(mounts, env.GH_CONFIG_DIR || path.join(homeDir, '.config', 'gh'), path.join(DOCKER_CONTAINER_HOME, '.config', 'gh'), existsSync);
  }
  // Git identity (tool-agnostic, required for commits). Honor the same env vars git itself reads for an alternate global config location (GIT_CONFIG_GLOBAL) and the XDG base dir, falling back to the conventional `~/.gitconfig` and `~/.config/git`. Missing host paths are skipped, so a container image that already bakes a git identity is left untouched. See issue #1939.
  maybeAddMount(mounts, env.GIT_CONFIG_GLOBAL || path.join(homeDir, '.gitconfig'), path.join(DOCKER_CONTAINER_HOME, '.gitconfig'), existsSync);
  maybeAddMount(mounts, env.XDG_CONFIG_HOME ? path.join(env.XDG_CONFIG_HOME, 'git') : path.join(homeDir, '.config', 'git'), path.join(DOCKER_CONTAINER_HOME, '.config', 'git'), existsSync);
  if (normalizedTool === 'codex') {
    if (!suppressed.has('.codex')) maybeAddMount(mounts, path.join(homeDir, '.codex'), path.join(DOCKER_CONTAINER_HOME, '.codex'), existsSync);
    // Issue #2074: Codex also discovers persistent user Agent Skills from ~/.agents/skills. Propagate that standard location alongside .codex so direct and Docker-isolated solver sessions expose the same capabilities.
    if (!suppressed.has('.agents')) maybeAddMount(mounts, path.join(homeDir, '.agents'), path.join(DOCKER_CONTAINER_HOME, '.agents'), existsSync);
  } else if (normalizedTool === 'claude') {
    if (!suppressed.has('.claude')) maybeAddMount(mounts, path.join(homeDir, '.claude'), path.join(DOCKER_CONTAINER_HOME, '.claude'), existsSync);
    if (!suppressed.has('.claude.json')) maybeAddMount(mounts, path.join(homeDir, '.claude.json'), path.join(DOCKER_CONTAINER_HOME, '.claude.json'), existsSync);
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
 * Resolve an outer Compose HTTP service before handing its origin to a nested
 * Docker daemon. The nested daemon has its own DNS namespace, but it can route
 * to the outer service's address through the parent container.
 *
 * HTTPS names are deliberately preserved for certificate verification.
 */
export async function resolveFormalAiIsolationEnv(env = process.env, { lookup = lookupHost } = {}) {
  const baseUrl = env.HIVE_MIND_FORMAL_AI_BASE_URL;
  if (!baseUrl) return env;
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return env;
  }
  if (parsed.protocol !== 'http:' || parsed.hostname !== FORMAL_AI_COMPOSE_HOSTNAME) {
    return env;
  }
  try {
    const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
    const selected = addresses.find(candidate => candidate.family === 4) || addresses[0];
    if (!selected?.address) return env;
    const host = selected.family === 6 ? `[${selected.address}]` : selected.address;
    return {
      ...env,
      HIVE_MIND_FORMAL_AI_BASE_URL: `${parsed.protocol}//${host}${parsed.port ? `:${parsed.port}` : ''}`,
    };
  } catch {
    // Keep the hostname for deployments whose nested DNS can resolve it.
    return env;
  }
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
  const { sessionId, tool = 'claude', env = process.env, homeDir = os.homedir(), existsSync = fs.existsSync, useRouter = false, routerToken = null, installGuard = installGitPushGuard } = options;
  // Issue #2164 (EXPERIMENTAL): router isolation replaces the credential mounts
  // with a scoped token pointing at the `hive-mind-router` sidecar. It only
  // engages when a token was actually issued; without one the task would have
  // neither credentials nor a route, so we fail open to the default mounts
  // rather than launching an agent that cannot reach any model.
  const routerActive = isRouterEnabled({ useRouter, env }) && Boolean(routerToken);
  const routerEndpoint = routerActive ? resolveRouterBaseUrl({ env }) : { baseUrl: null, external: false };
  const routerBaseUrl = routerEndpoint.baseUrl;
  const routerGitHub = routerActive ? resolveRouterGitHubRouting({ env, external: Boolean(routerEndpoint.external) }) : { mode: 'off', ghHost: null };
  const routerEnv = routerActive && routerBaseUrl ? buildRouterTaskEnv({ tool, baseUrl: routerBaseUrl, token: routerToken, githubMode: routerGitHub.mode, ghHost: routerGitHub.ghHost, homeDir: DOCKER_CONTAINER_HOME }) : {};
  const routerWired = Object.keys(routerEnv).length > 0;
  const image = getDockerIsolationImage({ env });
  const startArgs = ['--isolated', 'docker', '--image', image];
  if (shouldRunPrivilegedDockerIsolation(image, env)) {
    startArgs.push('--privileged');
  }
  // Force the inner shell so start-command does not probe the image to detect one (see DOCKER_ISOLATION_SHELL).
  startArgs.push('--shell', DOCKER_ISOLATION_SHELL);
  // The image already sets HOME=/home/box and WORKDIR /home/box; pass HOME explicitly anyway so the credential mounts under /home/box resolve even if a future image forgets to. start-command has no --workdir flag, so the working directory comes from the image's WORKDIR.
  startArgs.push('-e', `HOME=${DOCKER_CONTAINER_HOME}`, '-e', `HIVE_MIND_PARENT_SESSION_ID=${sessionId || ''}`, '-e', `HIVE_MIND_IMAGE_VARIANT=${resolveImageVariant(image, env)}`);
  // A persistent Formal AI server normally runs beside the Telegram/root container. Docker-isolated `/solve` jobs must receive the same endpoint; otherwise the wrapper starts a per-job server and loses shared memory.
  if (env.HIVE_MIND_FORMAL_AI_BASE_URL) {
    startArgs.push('-e', `HIVE_MIND_FORMAL_AI_BASE_URL=${env.HIVE_MIND_FORMAL_AI_BASE_URL}`);
  }
  for (const [name, value] of Object.entries(routerEnv)) {
    startArgs.push('-e', `${name}=${value}`);
  }
  const mounts = getDockerIsolationAuthMounts({ tool, env, homeDir, existsSync, useRouter: routerWired, ghRouted: routerWired && routerGitHub.mode !== 'off' });
  // Issue #2164 (R13): a routed task also loses the ability to destroy remote
  // history by accident. The hook lives on the host and is mounted read-only, so
  // the task cannot edit the rule it is being held to; git is pointed at it with
  // GIT_CONFIG_* rather than `git config --global`, because the container's
  // ~/.gitconfig is the operator's own file. This is one layer of three (see
  // git-push-guard.lib.mjs) and `--no-verify` still gets past it.
  if (routerWired) {
    // One `GIT_CONFIG_COUNT` covers both the hook and the router's git
    // transport: git shares the counter across all of them, so they have to be
    // built together or the second would silently replace the first.
    const gitConfigEntries = buildRouterGitConfigEntries({ baseUrl: routerBaseUrl, token: routerToken, githubMode: routerGitHub.mode });
    const guard = installGuard({ env, homeDir });
    if (guard.installed) {
      mounts.push({ source: guard.dir, target: GIT_PUSH_GUARD_CONTAINER_DIR, readOnly: true });
      gitConfigEntries.unshift(['core.hooksPath', GIT_PUSH_GUARD_CONTAINER_DIR]);
      if (hasForcePushOptIn(args)) startArgs.push('-e', `${GIT_PUSH_GUARD_ESCAPE_ENV}=1`);
    }
    for (const [name, value] of Object.entries(buildGitConfigEnv(gitConfigEntries))) {
      startArgs.push('-e', `${name}=${value}`);
    }
  }
  for (const mount of mounts) {
    startArgs.push('--volume', `${mount.source}:${mount.target}${mount.readOnly ? ':ro' : ''}`);
  }
  const taskCommand = buildShellCommand(command, args);
  startArgs.push('--detached', '--session', sessionId, '--', buildDockerStartGatedCommand(taskCommand, sessionId));
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
    // Issue #2135: keep `signal` - the captured session's child was killed by one, and `code` alone was null.
    child.on('close', (code, signal) => {
      const output = (stdout + (stderr ? `\n${stderr}` : '')).trim();
      if (code === 0) {
        resolve({ success: true, output, error: null });
      } else {
        resolve({
          success: false,
          output,
          error: stderr.trim() || describeChildExit({ command: 'start-command', code, signal }),
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
    console.log(`[VERBOSE] isolation-runner: Docker post-launch isolation image '${image}' present=${imagePresent} (issue #1939)`);
    if (!imagePresent) {
      console.log(`[VERBOSE] isolation-runner: ⚠️ Docker isolation image '${image}' is absent right after launch — host-image passthrough likely did not seed the nested daemon, so the task re-pulled it (issue #1939, problem #2)`);
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
 * @returns {Promise<{success: boolean, sessionId: string, output: string, error?: string, warning?: string, containerFilesystemStartBytes?: number|null}>}
 */
export async function executeWithIsolation(command, args, options = {}) {
  const { backend, verbose = false } = options;
  const sessionId = options.sessionId || generateSessionId();
  // Issue #2154: a launch that never produced a container left no trace in the
  // bot log — the reply went to Telegram and the log jumped straight to
  // "session untracked", so an operator could see that tasks were disappearing
  // but not why, and could not even name them. Every unsuccessful return from
  // this function now records the session UUID (the same one `$ --list` and the
  // session store use) together with the reason.
  const failLaunch = (error, extra = {}) => {
    console.error(`[isolation-runner] Session ${sessionId} was not launched (backend=${backend}, tool=${options.tool ?? 'claude'}, model=${options.model ?? 'default'}): ${error}`);
    return { success: false, sessionId, output: '', error, ...extra };
  };
  if (!VALID_ISOLATION_BACKENDS.includes(backend)) {
    return failLaunch(`Invalid isolation backend: '${backend}'. Must be one of: ${VALID_ISOLATION_BACKENDS.join(', ')}`);
  }
  const binPath = await findStartCommandBinary();
  if (!binPath) {
    return failLaunch('start-command ($) not found', { warning: '⚠️ WARNING: start-command ($) not found in PATH\nPlease install: npm install -g start-command' });
  }
  if (verbose) {
    console.log(`[VERBOSE] isolation-runner: Using $ binary at: ${binPath}`);
    console.log(`[VERBOSE] isolation-runner: Backend: ${backend}, Session ID: ${sessionId}`);
  }
  // Issue #2146 / PR #2147 review: a Formal AI task gets its own sidecar,
  // started on demand and reachable only over an internal Docker network. The
  // lease is taken before the container is launched so the endpoint is known
  // when the task's environment is built, and released again if the launch
  // fails. Fail closed — a Formal AI task must never start without Formal AI.
  const hostEnv = options.env || process.env;
  const { sidecar, error: sidecarError } = await acquireFormalAiSidecarForTask({ backend, args, model: options.model ?? null, tool: options.tool ?? null, sessionId, env: hostEnv, verbose });
  if (sidecarError) return failLaunch(sidecarError);
  // Issue #2164 (EXPERIMENTAL): --use-router replaces the task's credential
  // mounts with a token scoped to it alone. Like the Formal AI lease this is
  // taken before the container exists, because the token is part of the
  // environment the container is created with — and like it, it fails closed.
  const { router, error: routerError } = await acquireRouterForTask({ backend, useRouter: options.useRouter === true || hasUseRouterFlag(args), model: options.model ?? null, tool: options.tool ?? 'claude', githubRepo: options.githubRepo ?? null, sessionId, env: hostEnv, verbose });
  if (routerError) {
    await releaseFormalAiSidecarForTask({ sidecar, sessionId, env: hostEnv, verbose });
    return failLaunch(routerError);
  }
  // R11: when both sidecars are up, the router is taught to serve `formal-ai`
  // itself, so that model is mediated and audited like every other one. Done
  // before the container is created because the provider has to exist by the
  // time the task issues its first request.
  const formalAiRoutingError = await registerFormalAiWithRouter({ router, sidecar, verbose });
  if (formalAiRoutingError) {
    await releaseRouterForTask({ router, sessionId, env: hostEnv, verbose });
    await releaseFormalAiSidecarForTask({ sidecar, sessionId, env: hostEnv, verbose });
    return failLaunch(formalAiRoutingError);
  }
  const taskEnv = sidecar ? { ...hostEnv, HIVE_MIND_FORMAL_AI_BASE_URL: sidecar.baseUrl } : hostEnv;
  const effectiveOptions =
    backend === 'docker'
      ? {
          ...options,
          env: await resolveFormalAiIsolationEnv(taskEnv),
        }
      : options;
  const startCommandArgs = buildStartCommandArgs(command, args, { ...effectiveOptions, sessionId, useRouter: Boolean(router), routerToken: router?.token ?? null });
  if (verbose) {
    console.log(`[VERBOSE] isolation-runner: ${[binPath, ...startCommandArgs].map(shellQuote).join(' ')}`);
    if (backend === 'docker') {
      const env = effectiveOptions.env || process.env;
      const image = getDockerIsolationImage({ env });
      const mounts = getDockerIsolationAuthMounts({ tool: effectiveOptions.tool, env, homeDir: effectiveOptions.homeDir || os.homedir(), existsSync: effectiveOptions.existsSync || fs.existsSync });
      console.log('[VERBOSE] isolation-runner: Docker isolation backend: native ($ --isolated docker)');
      console.log(`[VERBOSE] isolation-runner: Docker isolation image: ${image}`);
      console.log(`[VERBOSE] isolation-runner: Docker isolation privileged: ${shouldRunPrivilegedDockerIsolation(image, env)}`);
      console.log('[VERBOSE] isolation-runner: Docker isolation pull: reuse local image if present, pull only if missing (start-command default)');
      console.log(`[VERBOSE] isolation-runner: Docker isolation mounts: ${mounts.map(m => m.target).join(', ') || '(none)'}`);
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
  let containerFilesystemStartBytes = null;
  let formalAiAttachError = null;
  let routerAttachError = null;
  if (result.success && backend === 'docker') {
    try {
      containerFilesystemStartBytes = await getDockerContainerWritableLayerSize(sessionId, verbose);
      // The task command is still held by the start gate — the only safe
      // moment to add a second network. `docker network connect` is additive;
      // a single `docker run --network` would replace the default bridge and
      // cut the task off from GitHub (issue #2146). start-command 0.32.0+
      // could attach both networks at launch (repeatable `--network`,
      // start#156), but it implements that with this very create → connect →
      // start sequence, and doing it here keeps the attach fail-closed on any
      // installed version instead of silently one-network on older parsers.
      formalAiAttachError = await attachFormalAiTaskContainer({ sidecar, sessionId, verbose });
      routerAttachError = await attachRouterTaskContainer({ router, sessionId, env: hostEnv, verbose });
    } finally {
      await releaseDockerContainerStartGate(sessionId, verbose);
    }
  }
  if (router && (!result.success || formalAiAttachError || routerAttachError)) {
    // Fail closed for the same reason the acquire does: a task that cannot
    // reach the router must not be left running with no route to a model.
    if (routerAttachError) await removeDockerContainer(sessionId, verbose);
    await releaseRouterForTask({ router, sessionId, env: hostEnv, verbose });
  }
  if (sidecar && (!result.success || formalAiAttachError)) {
    // Fail closed: without the internal network the task cannot reach Formal
    // AI, and issue #2146 forbids falling back to another model.
    if (formalAiAttachError) await removeDockerContainer(sessionId, verbose);
    await releaseFormalAiSidecarForTask({ sidecar, sessionId, env: hostEnv, verbose });
    if (formalAiAttachError) {
      return failLaunch(`Formal AI task container could not be attached to the internal Formal AI network, so the task was stopped instead of falling back to another model (issue #2146): ${formalAiAttachError}`, { output: result.output });
    }
  }
  if (routerAttachError) {
    if (sidecar) await releaseFormalAiSidecarForTask({ sidecar, sessionId, env: hostEnv, verbose });
    return failLaunch(`The task container could not be joined to the router (internal network, CA trust or api.github.com interception), so it was stopped rather than run without a route to any model (issue #2164): ${routerAttachError}`, { output: result.output });
  }
  // Issue #1939: capture the freshly-launched docker session's reported status
  // and the live container state together, so the next iteration has the data to
  // diagnose a premature "executed/-1" status (problem #1) or a surprise image
  // re-pull (problem #2). Best-effort and verbose-only — never affects the run.
  if (verbose && backend === 'docker' && result.success) {
    await logDockerIsolationPostLaunchDiagnostics(sessionId, options.env || process.env);
  }
  if (result.success) {
    // Issue #2154: hand the caller start-command's own execution UUID as well.
    // It is the identifier `$ --list` prints, so without it the bot and the
    // session list cannot be joined by an operator.
    const executionUuid = parseStartCommandExecutionUuid(result.output);
    if (verbose) {
      console.log(executionUuid ? `[VERBOSE] isolation-runner: start-command execution UUID for session ${sessionId}: ${executionUuid} (this is what '$ --list' shows)` : `[VERBOSE] isolation-runner: start-command reported no execution UUID for session ${sessionId}; '$ --list' cannot be correlated for this session`);
    }
    return {
      success: true,
      sessionId,
      executionUuid,
      output: result.output,
      containerFilesystemStartBytes,
    };
  }
  return failLaunch(result.error, { output: result.output });
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
    const $ = await getCommandStreamDollar();
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
    const $ = await getCommandStreamDollar();
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
    const $ = await getCommandStreamDollar();
    const result = await $({ mirror: false })`${binPath} --stop ${sessionId}`;
    const stdout = result.stdout?.toString() || '';
    const stderr = result.stderr?.toString() || '';
    if (verbose) {
      console.log(`[VERBOSE] isolation-runner: $ --stop ${sessionId} stdout: ${stdout.substring(0, 300)}`);
      if (stderr) {
        console.log(`[VERBOSE] isolation-runner: $ --stop ${sessionId} stderr: ${stderr.substring(0, 300)}`);
      }
    }
    // Issue #2189: `command-stream`'s `$` resolves — it does not throw — when the
    // child exits non-zero, so the catch below never sees a refusal. `$ --stop`
    // answers `Error: No execution found with UUID or session name: …` on stderr
    // with exit code 1; without this check every such refusal was reported to the
    // operator as a successful stop, and a session nobody stopped looked handled.
    const code = Number.isFinite(result.code) ? result.code : 0;
    if (code !== 0) {
      return { success: false, output: stdout, error: stderr.trim() || `\`$ --stop\` exited with code ${code}` };
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
    const $ = await getCommandStreamDollar();
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
    const $ = await getCommandStreamDollar();
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
 * Check whether the Docker container backing a session still exists at all —
 * running or stopped.
 *
 * Issue #2189 requirement R2: a killed session should be re-entered rather than
 * restarted from scratch, and `$ --resume` can only do that while the container
 * is still there. `checkDockerContainerRunning` answers a different question (a
 * stopped container is "not running" but is exactly the one worth resuming), so
 * the state is read instead of the running flag.
 *
 * @param {string} containerName - Container name (the session UUID)
 * @param {boolean} [verbose] - Enable verbose logging
 * @returns {Promise<boolean>} True when `docker inspect` finds the container
 */
export async function checkDockerContainerExists(containerName, verbose = false) {
  if (!containerName) return false;
  try {
    const $ = await getCommandStreamDollar();
    const result = await $({ mirror: false })`docker inspect -f ${'{{.State.Status}}'} ${containerName}`;
    const code = Number.isFinite(result.code) ? result.code : 0;
    const state = (result.stdout?.toString() || '').trim();
    const exists = code === 0 && state !== '';
    if (verbose) {
      console.log(`[VERBOSE] isolation-runner: docker inspect state for '${containerName}': ${exists ? state : 'no such container'}`);
    }
    return exists;
  } catch {
    // `docker inspect` exits non-zero when no such container exists.
    return false;
  }
}
export function parseDockerContainerWritableLayerSizeOutput(output) {
  const text = String(output || '').trim();
  if (!text) return null;
  const bytes = Number.parseInt(text.split(/\s+/)[0], 10);
  return Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
}
/**
 * Best-effort size of a Docker task container's writable layer.
 *
 * `docker inspect --size` exposes `.SizeRw`, which excludes the image's base
 * layers and counts only filesystem data created or changed by this container.
 * That is the closest Docker-native representation of per-task disk usage.
 *
 * @param {string} containerName - Container name (the session UUID)
 * @param {boolean} [verbose] - Enable verbose logging
 * @returns {Promise<number|null>} Writable layer bytes, or null when unavailable.
 */
export async function getDockerContainerWritableLayerSize(containerName, verbose = false) {
  if (!containerName) return null;
  try {
    const $ = await getCommandStreamDollar();
    const result = await $({ mirror: false })`docker inspect --size -f ${'{{.SizeRw}}'} ${containerName}`;
    const bytes = parseDockerContainerWritableLayerSizeOutput(result.stdout?.toString() || '');
    if (verbose) {
      const label = bytes === null ? 'unknown' : `${bytes} bytes`;
      console.log(`[VERBOSE] isolation-runner: docker writable layer size for '${containerName}': ${label}`);
    }
    return bytes;
  } catch (error) {
    if (verbose) {
      const stderr = error?.stderr?.toString?.().trim();
      console.log(`[VERBOSE] isolation-runner: could not inspect writable layer size for '${containerName}': ${stderr || error?.message || error}`);
    }
    return null;
  }
}
/**
 * Release the Docker-only start gate after the writable-layer baseline has been
 * captured. Best-effort: the gated task also has a timeout fallback.
 *
 * @param {string} containerName - Container name (the session UUID)
 * @param {boolean} [verbose] - Enable verbose logging
 * @returns {Promise<boolean>} true when the gate file was touched.
 */
export async function releaseDockerContainerStartGate(containerName, verbose = false) {
  const gatePath = buildDockerStartGatePath(containerName);
  if (!containerName || !gatePath) return false;
  const releaseCommand = `touch ${shellQuote(gatePath)}`;
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const $ = await getCommandStreamDollar();
      await $({ mirror: false })`docker exec ${containerName} sh -c ${releaseCommand}`;
      if (verbose) {
        console.log(`[VERBOSE] isolation-runner: released docker start gate for '${containerName}'`);
      }
      return true;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  if (verbose) {
    const stderr = lastError?.stderr?.toString?.().trim();
    console.log(`[VERBOSE] isolation-runner: could not release docker start gate for '${containerName}': ${stderr || lastError?.message || lastError}`);
  }
  return false;
}
/**
 * Best-effort removal for a Docker container backing a native
 * `$ --isolated docker` session.
 *
 * start-command names the container after the `--session` value. The monitor
 * calls this only after the session is terminal and after the host-side log has
 * been inspected, so removing the container reclaims its writable layer without
 * losing the captured task log. Never throws: completion notification must not
 * fail just because Docker already removed the container.
 *
 * @param {string} containerName - Container name (the session UUID)
 * @param {boolean} [verbose] - Enable verbose logging
 * @returns {Promise<{success: boolean, output: string, error: string|null}>}
 */
export async function removeDockerContainer(containerName, verbose = false) {
  if (!containerName) {
    return { success: false, output: '', error: 'missing container name' };
  }
  try {
    const $ = await getCommandStreamDollar();
    const result = await $({ mirror: false })`docker rm -f ${containerName}`;
    const stdout = result.stdout?.toString() || '';
    const stderr = result.stderr?.toString() || '';
    if (verbose) {
      console.log(`[VERBOSE] isolation-runner: docker rm -f '${containerName}' succeeded`);
    }
    return { success: true, output: stdout || stderr, error: null };
  } catch (error) {
    const stderr = error?.stderr?.toString?.() || '';
    const stdout = error?.stdout?.toString?.() || '';
    if (verbose) {
      console.log(`[VERBOSE] isolation-runner: docker rm -f '${containerName}' failed: ${stderr.trim() || error?.message || error}`);
    }
    return {
      success: false,
      output: stdout,
      error: stderr.trim() || error?.message || String(error),
    };
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
    const $ = await getCommandStreamDollar();
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
    const $ = await getCommandStreamDollar();
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
    const $ = await getCommandStreamDollar();
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
      const $ = await getCommandStreamDollar();
      const info = await $({ mirror: false })`docker info --format ${'{{.DockerRootDir}}'}`;
      const root = (info.stdout?.toString() || '').trim();
      if (root) dataRoot = root;
    } catch {
      // Daemon unreachable: fall back to the conventional data root. If df then
      // fails on it (e.g. the path does not exist) we return null below.
    }
    const $ = await getCommandStreamDollar();
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
  let repairOutcome;
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
