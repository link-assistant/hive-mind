/**
 * Issue #2900: Docker `live-restore` preflight for `--isolation docker`.
 *
 * With the Docker default (`"live-restore": false`) any dockerd restart (crash,
 * OOM kill, package upgrade, `systemctl restart docker`) force-kills every
 * container: the bot container, every running task and the in-memory solve
 * queue die together. With `"live-restore": true` dockerd re-attaches to the
 * running containers (they are children of containerd-shim, not of dockerd).
 *
 * The setting is reloadable (SIGHUP), so it is applied with
 * `systemctl reload docker`. A `restart` would itself kill every container.
 *
 * Split out of isolation-runner.lib.mjs (size budget); preflightDockerIsolation
 * calls checkDockerLiveRestore and buildLiveRestoreWarning.
 */
import { execFile } from 'node:child_process';

// Same bound as the other docker queries of isolation-runner.lib.mjs (issue #3278).
const DOCKER_CLI_TIMEOUT_MS = 120_000;

export const LIVE_RESTORE_DOCS_URL = 'https://docs.docker.com/engine/daemon/live-restore/';

/**
 * Merge `"live-restore": true` into /etc/docker/daemon.json, keeping every other
 * key, then reload (never restart) dockerd and verify. Same commands as the
 * "Host Docker daemon settings" section of docs/DOCKER.md.
 */
export const LIVE_RESTORE_MERGE_COMMAND = `sudo python3 -c 'import json,os
p="/etc/docker/daemon.json"
d=json.load(open(p)) if os.path.exists(p) and os.path.getsize(p) else {}
d["live-restore"]=True
os.makedirs("/etc/docker",exist_ok=True)
open(p,"w").write(json.dumps(d,indent=2)+"\\n")'`;

export const LIVE_RESTORE_RELOAD_COMMAND = 'sudo systemctl reload docker';
export const LIVE_RESTORE_VERIFY_COMMAND = "docker info -f '{{.LiveRestoreEnabled}}'";

/**
 * Parse the output of `docker info -f '{{.LiveRestoreEnabled}}'`.
 * @param {string} stdout
 * @returns {boolean|null} true/false, or null when the output is not a boolean
 */
export function parseLiveRestoreEnabled(stdout) {
  const value = String(stdout ?? '')
    .trim()
    .toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function defaultRun(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: DOCKER_CLI_TIMEOUT_MS, encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout ?? ''));
    });
  });
}

/**
 * Read `LiveRestoreEnabled` from a Docker daemon.
 *
 * Never throws: returns true/false, or null when docker is missing, the daemon
 * is unreachable or the output is unexpected.
 *
 * @param {boolean} [verbose]
 * @param {Object} [options]
 * @param {string} [options.host] - Daemon address for `docker -H` (e.g. unix:///var/run/host-docker.sock); default is the ambient daemon
 * @param {Function} [options.run] - (file, args) => Promise<stdout> (injectable for tests)
 * @returns {Promise<boolean|null>}
 */
export async function checkDockerLiveRestore(verbose = false, { host = null, run = defaultRun } = {}) {
  const args = [...(host ? ['-H', host] : []), 'info', '-f', '{{.LiveRestoreEnabled}}'];
  const label = host || 'default daemon';
  try {
    const enabled = parseLiveRestoreEnabled(await run('docker', args));
    if (verbose) console.log(`[VERBOSE] isolation-runner: docker live-restore (${label}): ${enabled === null ? '(unknown)' : enabled}`);
    return enabled;
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] isolation-runner: docker info unavailable (${label}); live-restore unknown (${String(error?.message || error).split('\n')[0]})`);
    return null;
  }
}

/**
 * Warning text for a daemon reporting `LiveRestoreEnabled=false`.
 * @param {Object} [options]
 * @param {string} [options.daemon] - Human label of the daemon that was probed
 * @returns {string}
 */
export function buildLiveRestoreWarning({ daemon = 'The Docker daemon that runs the isolated tasks' } = {}) {
  return `${daemon} has live-restore disabled (docker info: LiveRestoreEnabled=false). ` + `Any dockerd restart (crash, OOM kill, package upgrade, 'systemctl restart docker') then force-kills every container: the bot, every running task and the in-memory queue (issue #2900). ` + `On the Docker host, merge "live-restore": true into /etc/docker/daemon.json (keep the other keys) and apply it with '${LIVE_RESTORE_RELOAD_COMMAND}'. ` + `Use reload, never restart, while containers are running: a restart kills them. Verify with: ${LIVE_RESTORE_VERIFY_COMMAND}. ` + `Live-restore does not survive a host reboot, so keep '--restart unless-stopped' on the bot container. See docs/DOCKER.md#host-docker-daemon-settings and ${LIVE_RESTORE_DOCS_URL}`;
}

/**
 * Probe the daemons that matter for `--isolation docker` and return warnings.
 *
 * - The ambient daemon (`docker info`): the one isolated tasks are launched on.
 * - In the DinD image with the host Docker socket mounted, also the host daemon:
 *   a host dockerd restart kills the bot container itself.
 *
 * Unknown (null) is never a warning: the preflight only flags a daemon that
 * reports false.
 *
 * @param {Object} options
 * @param {Function} options.checkLiveRestore - (verbose, {host}) => Promise<boolean|null>
 * @param {boolean} [options.isDind]
 * @param {boolean} [options.socketMounted]
 * @param {string} [options.sock] - Host Docker socket path inside the container
 * @param {boolean} [options.verbose]
 * @returns {Promise<{liveRestore: (boolean|null), hostLiveRestore: (boolean|null), warnings: string[]}>}
 */
export async function preflightLiveRestore({ checkLiveRestore = checkDockerLiveRestore, isDind = false, socketMounted = false, sock = '', verbose = false } = {}) {
  const warnings = [];
  let liveRestore;
  let hostLiveRestore = null;
  try {
    liveRestore = await checkLiveRestore(verbose, {});
  } catch {
    liveRestore = null;
  }
  if (liveRestore === false) {
    warnings.push(buildLiveRestoreWarning({ daemon: isDind ? 'The nested Docker daemon of this container (the one that runs the isolated tasks)' : undefined }));
  }
  if (isDind && socketMounted && sock) {
    try {
      hostLiveRestore = await checkLiveRestore(verbose, { host: `unix://${sock}` });
    } catch {
      hostLiveRestore = null;
    }
    if (hostLiveRestore === false) {
      warnings.push(buildLiveRestoreWarning({ daemon: `The host Docker daemon (socket mounted at ${sock}, the daemon that runs this bot container)` }));
    }
  }
  return { liveRestore, hostLiveRestore, warnings };
}
