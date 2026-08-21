/**
 * Getting the logs back out (issue #2164, R8/R14/R15).
 *
 * The router only earns its keep if what it records can be read afterwards, and
 * "read afterwards" is harder than it sounds: the request logs live in a named
 * Docker volume that outlives every container that wrote to it, so at the
 * moment an auditor wants them there may well be no router running to ask.
 *
 * Two paths are therefore supported — copy out of the live container when there
 * is one, and mount the volume into a throwaway container when there is not.
 * The second is the one that matters, because it still works after the sidecar
 * has been stopped by the idle reconciler.
 *
 * `describeSystemLogLocations()` is the other half: Hive Mind writes logs in
 * five different places, and an operator collecting evidence needs the whole
 * list, not just the router's part of it. The list is code rather than prose so
 * `docs/COLLECTING-LOGS.md` and `examples/collect-logs.mjs` cannot drift from
 * each other.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2164
 */

import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

import { dockerOk, inspectDockerContainer } from './docker-sidecar.lib.mjs';
import { ROUTER_DATA_MOUNT, ROUTER_DATA_VOLUME_NAME, ROUTER_SIDECAR_CONTAINER_NAME, ROUTER_SIDECAR_IMAGE } from './router-isolation.lib.mjs';
import { resolveBotLogDir } from './bot-logger.lib.mjs';
import { resolveBotStateDir } from './session-store.lib.mjs';
import { TASK_SESSION_ARCHIVE_DIR } from './router-session-drain.lib.mjs';

const execFileAsync = promisify(execFile);

/** Where `$` (start-command) keeps the console log of an isolated session. */
export const START_COMMAND_LOG_ROOT = '/tmp/start-command/logs';

/**
 * Path of a task session's own console log.
 *
 * Mirrors `resolveLogPath()` in telegram-log-command.lib.mjs, which is what the
 * `/log` Telegram command uses; kept in one shape here so a collector and the
 * bot never disagree about where a session's log is.
 */
export const resolveSessionConsoleLogPath = ({ sessionId, backend = 'docker' }) => (backend ? path.join(START_COMMAND_LOG_ROOT, 'isolation', backend, `${sessionId}.log`) : path.join(START_COMMAND_LOG_ROOT, 'direct', `${sessionId}.log`));

/**
 * Every place Hive Mind writes something an audit might need.
 *
 * @returns {Array<{key: string, path: string, kind: string, description: string}>}
 */
export const describeSystemLogLocations = ({ env = process.env } = {}) => [
  {
    key: 'run-logs',
    path: String(env.HIVE_MIND_LOG_DIR || '').trim() || process.cwd(),
    kind: 'directory',
    description: 'Per-run `solve-*.log` / `hive-*.log`, renamed to `<sessionId>.log` once the AI tool reports its session id. Written to the working directory unless --log-dir says otherwise.',
  },
  {
    key: 'bot-logs',
    path: resolveBotLogDir(env),
    kind: 'directory',
    description: 'Rotated Telegram bot log (`telegram-bot.log` plus timestamped backups): every command, launch, and lifecycle event.',
  },
  {
    key: 'bot-state',
    path: resolveBotStateDir(env),
    kind: 'directory',
    description: 'Tracked sessions and sidecar state, including `router-sidecar.json` — which task held which token, and when. Contains the router signing secret, so it is mode 0600 and must not be copied into a shared archive.',
  },
  {
    key: 'session-console',
    path: path.join(START_COMMAND_LOG_ROOT, 'isolation'),
    kind: 'directory',
    description: 'Console output of each isolated session, one `<sessionId>.log` per backend. This is what the Telegram `/log <uuid>` command serves.',
  },
  {
    key: 'container-logs',
    path: 'docker logs <sessionId>',
    kind: 'command',
    description: "Docker's own capture of a task container's stdout/stderr, available until the container is removed.",
  },
  {
    key: 'router-requests',
    path: `${ROUTER_DATA_VOLUME_NAME}:${ROUTER_DATA_MOUNT}/requests/<token-hash>/requests.jsonl`,
    kind: 'volume',
    description: 'One redacted JSONL request log per issued token — that is, per task (R6). Retained after the token is revoked and after the sidecar is stopped.',
  },
  {
    key: 'router-audit',
    path: `${ROUTER_DATA_VOLUME_NAME}:${ROUTER_DATA_MOUNT}/audit.jsonl`,
    kind: 'volume',
    description: 'Router audit log: token issuance, revocation and rotation events.',
  },
  {
    key: 'task-sessions',
    path: `${ROUTER_DATA_VOLUME_NAME}:${TASK_SESSION_ARCHIVE_DIR}/<sessionId>/`,
    kind: 'volume',
    description: 'Agent session data drained out of each routed task before its container was reclaimed (R7): the transcripts of what the agent actually did.',
  },
];

/**
 * Arguments for reading the router volume without a running router.
 *
 * The router image is used because it is already on the host; its entrypoint is
 * overridden because we want `cp`, not a server. The volume is mounted read-only
 * so a collection can never damage the evidence it is collecting, and the copy
 * runs as the calling user so the exported files are readable without root.
 */
export const buildRouterVolumeExportArgs = ({ destination, image = ROUTER_SIDECAR_IMAGE, volume = ROUTER_DATA_VOLUME_NAME, uid = null, gid = null }) => {
  const args = ['run', '--rm', '--entrypoint', 'cp', '--volume', `${volume}:${ROUTER_DATA_MOUNT}:ro`, '--volume', `${destination}:/export`];
  if (uid !== null && gid !== null) args.push('--user', `${uid}:${gid}`);
  args.push(image, '-a', `${ROUTER_DATA_MOUNT}/.`, '/export/');
  return args;
};

/**
 * Copy the router's data volume — request logs, audit log, drained task
 * sessions — into a host directory.
 *
 * @returns {Promise<{collected: boolean, via: string|null, destination: string, error: string|null}>}
 */
export const collectRouterLogs = async ({ destination, run = execFileAsync, timeoutMs, image = ROUTER_SIDECAR_IMAGE, containerName = ROUTER_SIDECAR_CONTAINER_NAME, uid = typeof process.getuid === 'function' ? process.getuid() : null, gid = typeof process.getgid === 'function' ? process.getgid() : null, log = null } = {}) => {
  const target = path.resolve(destination || path.join(os.tmpdir(), 'hive-mind-router-logs'));
  const container = await inspectDockerContainer(containerName, { run, timeoutMs });
  if (container.running) {
    if (await dockerOk(run, ['cp', `${containerName}:${ROUTER_DATA_MOUNT}/.`, target], { timeoutMs })) {
      if (log) await log(`📥 Copied router logs from the running sidecar into ${target}`);
      return { collected: true, via: 'container', destination: target, error: null };
    }
  }
  // The usual case once the idle reconciler has done its job: the volume is
  // still there, the container is not.
  if (await dockerOk(run, buildRouterVolumeExportArgs({ destination: target, image, uid, gid }), { timeoutMs })) {
    if (log) await log(`📥 Copied router logs from volume '${ROUTER_DATA_VOLUME_NAME}' into ${target}`);
    return { collected: true, via: 'volume', destination: target, error: null };
  }
  return { collected: false, via: null, destination: target, error: `could not read '${ROUTER_DATA_VOLUME_NAME}': is Docker running, and has the router ever been started?` };
};

export default { buildRouterVolumeExportArgs, collectRouterLogs, describeSystemLogLocations, resolveSessionConsoleLogPath, START_COMMAND_LOG_ROOT };
