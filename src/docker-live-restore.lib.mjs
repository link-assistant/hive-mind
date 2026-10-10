/**
 * Docker `live-restore` diagnostics for the `--isolation docker` startup
 * preflight (issue #2900).
 *
 * With the Docker default (`"live-restore": false`) ANY restart of dockerd —
 * a crash, an OOM kill, `apt upgrade docker-ce`, `systemctl restart docker` —
 * stops every container on that daemon. For Hive Mind that means the bot
 * container, every running task and the in-memory solve queue die together.
 * Container processes are children of `containerd-shim`, not of dockerd, so
 * with `"live-restore": true` dockerd re-attaches to them after a restart and
 * nothing is lost. The option is reloadable (SIGHUP / `systemctl reload
 * docker`), so it can be turned on without stopping a single container.
 *
 * This module only diagnoses. It never throws and never blocks startup, like
 * the storage-driver and disk-space checks in isolation-runner.lib.mjs.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2900
 * @see https://docs.docker.com/engine/daemon/live-restore/
 */
import { getCommandStreamDollar } from './start-command-cli.lib.mjs';

// Ships in the repository so a host operator can fetch and run it directly.
export const LIVE_RESTORE_SCRIPT_URL = 'https://raw.githubusercontent.com/link-assistant/hive-mind/main/scripts/enable-docker-live-restore.sh';
export const LIVE_RESTORE_DOCS_URL = 'https://github.com/link-assistant/hive-mind/blob/main/docs/DOCKER.md#host-docker-daemon-settings';
// One `docker info` call reports both the setting and the daemon identity, so
// the preflight can tell whether the default CLI daemon and the mounted host
// socket are the same daemon (Docker-outside-of-Docker) or two daemons (DinD).
const LIVE_RESTORE_INFO_FORMAT = '{{.LiveRestoreEnabled}} {{.ID}}';

/**
 * Parse `docker info --format '{{.LiveRestoreEnabled}} {{.ID}}'` output.
 *
 * @param {string} output - Raw stdout
 * @returns {{enabled: boolean, daemonId: (string|null)}|null} null when the output is not a boolean report
 */
export function parseLiveRestoreInfoOutput(output) {
  const [flag, daemonId] = String(output || '')
    .trim()
    .split(/\s+/);
  const normalized = String(flag || '').toLowerCase();
  if (normalized !== 'true' && normalized !== 'false') return null;
  return { enabled: normalized === 'true', daemonId: daemonId || null };
}

/**
 * Report whether a Docker daemon has `live-restore` enabled.
 *
 * Never throws: returns null when docker is unavailable, the daemon is
 * unreachable, or the output cannot be parsed.
 *
 * @param {boolean} [verbose] - Enable verbose logging
 * @param {Object} [options]
 * @param {string|null} [options.socket] - Unix socket of the daemon to query; null queries the CLI's default daemon
 * @returns {Promise<{enabled: boolean, daemonId: (string|null)}|null>}
 */
export async function checkDockerLiveRestore(verbose = false, { socket = null } = {}) {
  const label = socket ? `daemon at ${socket}` : 'default daemon';
  try {
    const $ = await getCommandStreamDollar();
    const result = socket ? await $({ mirror: false })`docker -H ${`unix://${socket}`} info --format ${LIVE_RESTORE_INFO_FORMAT}` : await $({ mirror: false })`docker info --format ${LIVE_RESTORE_INFO_FORMAT}`;
    const stdout = result.stdout?.toString() || '';
    const code = Number.isFinite(result.code) ? result.code : 0;
    // An unreachable daemon still renders the template with zero values
    // ("false ") and exits 1 — that is "unknown", not "disabled".
    const parsed = code === 0 ? parseLiveRestoreInfoOutput(stdout) : null;
    if (verbose) console.log(`[VERBOSE] docker-live-restore: ${label}: exit=${code} raw=${JSON.stringify(stdout.trim())} liveRestore=${parsed ? parsed.enabled : '(unknown)'} id=${parsed?.daemonId || '(unknown)'}`);
    return parsed;
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] docker-live-restore: ${label}: docker info unavailable (${error?.message || error}); live-restore unknown`);
    return null;
  }
}

/**
 * The exact host-side remediation, embedded in the warning so the operator
 * does not have to look anything up mid-incident.
 *
 * @returns {string}
 */
export function buildLiveRestoreRemediation() {
  return [`Enable it on the HOST without stopping any container: curl -fsSL ${LIVE_RESTORE_SCRIPT_URL} | sudo bash`, `(or add "live-restore": true to /etc/docker/daemon.json, keeping the other keys, then run 'sudo systemctl reload docker').`, `Use 'systemctl reload docker', NEVER 'systemctl restart docker', while containers are running: the restart itself would kill them all.`, `Verify with: docker info -f '{{.LiveRestoreEnabled}}' (expect true). Details: ${LIVE_RESTORE_DOCS_URL}`].join(' ');
}

/**
 * Assess live-restore for the daemons a Docker-isolated bot depends on.
 *
 * Two daemons can matter:
 *   - the *task* daemon, reached by the plain `docker` CLI, which runs every
 *     isolated task;
 *   - the *host* daemon, reached through the mounted host socket in a DinD
 *     deployment, which runs the bot container itself.
 *
 * A daemon that answers to both (Docker-outside-of-Docker, or a bot running
 * directly on the host) is reported once. A nested DinD daemon is started by
 * the box entrypoint with `nohup` and nothing restarts it, so its setting is
 * only logged; the warning is reserved for a daemon whose restart would kill
 * the bot or its tasks (anything that is not the nested daemon).
 *
 * @param {Object} options
 * @param {string} options.sock - Path where the host socket is mounted
 * @param {boolean} options.socketMounted - Whether that path exists
 * @param {boolean} options.isDind - Whether the bot runs the DinD image variant
 * @param {Object} [options.env] - Environment (reads DIND_SKIP_DAEMON)
 * @param {Function} [options.checkLiveRestore] - Probe (injectable for tests)
 * @param {boolean} [options.verbose] - Enable verbose logging
 * @returns {Promise<{liveRestore: {task: (boolean|null), host: (boolean|null), sameDaemon: boolean, taskDaemonNested: boolean}, liveRestoreOk: boolean, warnings: string[], notes: string[]}>}
 */
export async function assessDockerLiveRestore({ sock, socketMounted, isDind, env = process.env, checkLiveRestore = checkDockerLiveRestore, verbose = false } = {}) {
  const task = await checkLiveRestore(verbose, { socket: null });
  const host = socketMounted ? await checkLiveRestore(verbose, { socket: sock }) : null;
  const sameDaemon = Boolean(task?.daemonId && host?.daemonId && task.daemonId === host.daemonId);
  // With the host socket mounted, a different daemon ID proves the default
  // daemon is the nested one. Without it, fall back to the deployment mode:
  // DinD starts a nested daemon unless DIND_SKIP_DAEMON=1 (box DooD mode).
  const taskDaemonNested = host?.daemonId && task?.daemonId ? !sameDaemon : Boolean(isDind && String(env.DIND_SKIP_DAEMON || '') !== '1');
  const liveRestore = { task: task ? task.enabled : null, host: host ? host.enabled : null, sameDaemon, taskDaemonNested };
  const warnings = [];
  const notes = [];
  const remediation = buildLiveRestoreRemediation();
  const consequence = `With live-restore off, ANY restart of that dockerd (crash, OOM kill, 'apt upgrade docker-ce', 'systemctl restart docker') kills every container on it`;
  if (host && host.enabled === false && !sameDaemon) {
    warnings.push(`The HOST Docker daemon (mounted at ${sock}) has live-restore DISABLED. ${consequence} — including this bot's own container, every task running inside it and the in-memory solve queue (issue #2900). ${remediation}`);
  }
  if (task && task.enabled === false && !taskDaemonNested) {
    warnings.push(`The Docker daemon that runs '--isolation docker' tasks has live-restore DISABLED. ${consequence} — every running task and, when the bot itself runs in a container there, the bot and its in-memory solve queue (issue #2900). ${remediation}`);
  }
  if (task && task.enabled === false && taskDaemonNested) {
    notes.push(`ℹ️ The nested DinD Docker daemon has live-restore disabled. Nothing restarts the nested daemon automatically, so this is low risk; the HOST daemon's setting is what protects the bot container (issue #2900).`);
  }
  if (taskDaemonNested && !host) {
    const why = socketMounted ? `the host socket at ${sock} did not answer 'docker info'` : `no host socket at ${sock}`;
    notes.push(`ℹ️ Could not check live-restore on the HOST Docker daemon (${why}). Check it on the host with: docker info -f '{{.LiveRestoreEnabled}}'. If it prints false, a host dockerd restart kills this bot and every task (issue #2900). ${remediation}`);
  }
  const liveRestoreOk = warnings.length === 0;
  if (liveRestoreOk && (liveRestore.host === true || (liveRestore.task === true && !taskDaemonNested))) {
    notes.push(`✅ Docker live-restore is enabled on the daemon that runs the bot/tasks — a dockerd restart will not kill them (issue #2900).`);
  }
  return { liveRestore, liveRestoreOk, warnings, notes };
}
