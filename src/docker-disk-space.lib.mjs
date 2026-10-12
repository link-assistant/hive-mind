/**
 * Free-space probe for the Docker daemon's storage (issues #1914, #3001).
 *
 * `--isolation docker` tasks write their image layers and writable layers to
 * the daemon's storage, so the startup preflight warns when it is too small to
 * pull the multi-GB isolation image. The probe used to run `df` on the daemon's
 * `DockerRootDir` *in the bot's own filesystem*. That only works when the bot
 * shares a filesystem with the daemon (bot on the host, or a nested
 * Docker-in-Docker daemon). In production the bot container talks to the
 * HOST daemon through `/var/run/docker.sock`: `DockerRootDir` is the host's
 * `/var/lib/docker`, which does not exist in the bot container, `df` exits 1,
 * and the check was silently skipped (logged as "could not parse df output",
 * because command-stream resolves — it does not throw — on a non-zero exit).
 *
 * This module measures the storage where it actually lives:
 *
 *   1. `docker info` gives the data root, the storage driver and the
 *      containerd address. When the daemon's `Name` differs from this
 *      machine's hostname, the daemon is in another filesystem namespace
 *      (host socket, remote `DOCKER_HOST`, Docker Desktop VM).
 *   2. Local daemon: `df -Pk <path>` here, as before.
 *   3. Otherwise, or when the local `df` fails: a throwaway container from an
 *      image that is already present (`--pull never`, nothing is downloaded)
 *      bind-mounts the path read-only and runs `df` on it, so the daemon's
 *      host does the measuring.
 *   4. With the containerd image store (the default for fresh Docker Engine 29
 *      installs, `driver-type: io.containerd.snapshotter.v1`), image layers
 *      live in containerd's root (`/var/lib/containerd`), not in
 *      `DockerRootDir`, so that path is measured too and the smaller free
 *      space wins.
 *
 * When nothing can be measured the result carries the real reason in `error`
 * so the preflight can report a disabled safety check at warning level.
 *
 * Everything that touches the outside world is injectable for tests.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3001
 */

import { execFile } from 'node:child_process';
import os from 'node:os';

/** Where the throwaway measuring container mounts the daemon path. */
export const DOCKER_DISK_PROBE_MOUNT = '/hive-mind-disk-probe';

/** containerd's default root when Docker talks to a system containerd. */
export const DEFAULT_CONTAINERD_ROOT = '/var/lib/containerd';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_PROBE_IMAGES = 3;

/**
 * Run a command and resolve with its exit status instead of throwing, so every
 * failure reason (missing binary, non-zero exit, timeout) reaches the caller.
 *
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export function runCommand(file, args, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise(resolve => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) });
      const code = Number.isInteger(error.code) ? error.code : error.code === 'ENOENT' ? 127 : 1;
      const reason = error.killed ? `timed out after ${timeoutMs} ms` : error.code === 'ENOENT' ? `${file}: command not found` : '';
      resolve({ code, stdout: String(stdout || ''), stderr: String(stderr || '') || reason || error.message });
    });
  });
}

/** Available KiB from the last line of `df -Pk` output, or null when absent. */
export function parseDfAvailableKb(stdout) {
  const lines = String(stdout || '')
    .trim()
    .split('\n')
    .filter(Boolean);
  if (lines.length < 2) return null;
  const cols = lines[lines.length - 1].trim().split(/\s+/);
  if (cols.length < 4 || !/^\d+$/.test(cols[3])) return null;
  return Number(cols[3]);
}

/** First non-empty line of a command's stderr (or stdout), for a one-line reason. */
export function describeFailure(result) {
  const text = `${result?.stderr?.toString() ?? ''}\n${result?.stdout?.toString() ?? ''}`
    .split('\n')
    .map(line => line.trim())
    .find(Boolean);
  return text || `exit code ${result?.code}`;
}

/**
 * Parse `docker info --format '{{json .}}'`.
 *
 * @returns {{dataRoot: string|null, driver: string|null, containerdStore: boolean, containerdAddress: string|null, name: string|null}|null}
 */
export function parseDockerInfo(stdout) {
  let info;
  try {
    info = JSON.parse(String(stdout || '').trim());
  } catch {
    return null;
  }
  if (!info || typeof info !== 'object') return null;
  const driver = typeof info.Driver === 'string' && info.Driver ? info.Driver.toLowerCase() : null;
  const driverStatus = Array.isArray(info.DriverStatus) ? info.DriverStatus : [];
  const driverType = driverStatus.find(pair => Array.isArray(pair) && pair[0] === 'driver-type')?.[1] || '';
  // `overlayfs` is the containerd snapshotter's name; the legacy graph driver
  // is `overlay2`. Older daemons do not report `driver-type`, so accept either.
  const containerdStore = /io\.containerd\.snapshotter/.test(driverType) || driver === 'overlayfs';
  return {
    dataRoot: typeof info.DockerRootDir === 'string' && info.DockerRootDir ? info.DockerRootDir : null,
    driver,
    containerdStore,
    containerdAddress: typeof info.Containerd?.Address === 'string' ? info.Containerd.Address : null,
    name: typeof info.Name === 'string' && info.Name ? info.Name : null,
  };
}

/**
 * containerd's root for the containerd image store.
 *
 * A dockerd-managed containerd listens under Docker's exec root
 * (`/var/run/docker/containerd/containerd.sock`) and keeps its state in
 * `<DockerRootDir>/containerd/daemon`, which the data-root measurement already
 * covers. A system containerd (`/run/containerd/containerd.sock`, what the
 * docker-ce packages install) uses its own root, `/var/lib/containerd` by
 * default. `HIVE_MIND_DOCKER_CONTAINERD_ROOT` overrides it for custom setups.
 */
export function resolveContainerdRoot(info, env = process.env) {
  if (env.HIVE_MIND_DOCKER_CONTAINERD_ROOT) return env.HIVE_MIND_DOCKER_CONTAINERD_ROOT;
  const address = info?.containerdAddress || '';
  if (/^\/(var\/)?run\/docker\//.test(address) && info?.dataRoot) return `${info.dataRoot.replace(/\/+$/, '')}/containerd/daemon`;
  return DEFAULT_CONTAINERD_ROOT;
}

/** Paths whose filesystems hold the daemon's images and writable layers. */
export function resolveDockerStoragePaths(info, env = process.env) {
  const paths = [info?.dataRoot || '/var/lib/docker'];
  if (info?.containerdStore) {
    const containerdRoot = resolveContainerdRoot(info, env);
    if (!paths.some(p => containerdRoot === p || containerdRoot.startsWith(`${p.replace(/\/+$/, '')}/`))) paths.push(containerdRoot);
  }
  return paths;
}

async function measureLocally(path, run) {
  const result = await run('df', ['-Pk', path]);
  if (result.code !== 0) return { error: `df failed: ${describeFailure(result)}` };
  const availableKb = parseDfAvailableKb(result.stdout);
  if (availableKb == null) return { error: `could not parse df output: ${JSON.stringify(String(result.stdout).slice(0, 200))}` };
  return { availableKb };
}

async function listLocalImages(run) {
  const result = await run('docker', ['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}']);
  if (result.code !== 0) return [];
  return String(result.stdout)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.includes('<none>'));
}

async function measureThroughDaemon(path, images, run) {
  const errors = [];
  for (const image of images) {
    // --pull never: measuring must never download anything. --entrypoint df
    // skips the image's entrypoint (the dind images would start dockerd).
    // --mount (not -v) fails instead of creating a missing host path.
    const result = await run('docker', ['run', '--rm', '--pull', 'never', '--network', 'none', '--log-driver', 'none', '--entrypoint', 'df', '--mount', `type=bind,source=${path},target=${DOCKER_DISK_PROBE_MOUNT},readonly`, image, '-Pk', DOCKER_DISK_PROBE_MOUNT]);
    if (result.code !== 0) {
      errors.push(`${image}: ${describeFailure(result)}`);
      continue;
    }
    const availableKb = parseDfAvailableKb(result.stdout);
    if (availableKb != null) return { availableKb, image };
    errors.push(`${image}: could not parse df output`);
  }
  return { error: errors.length ? `measuring through the Docker daemon failed (${errors.join('; ')})` : 'measuring through the Docker daemon failed: no local image to run df in' };
}

/**
 * Report the free space on the Docker daemon's storage.
 *
 * Never throws. `availableGiB` is the smallest free space among the measured
 * paths (null when none could be measured, with the reason in `error`);
 * `dataRoot` is the path it belongs to.
 *
 * @param {boolean} [verbose]
 * @param {Object} [options]
 * @param {string} [options.image] - Image to measure in first (the task image; it must already be present)
 * @param {Object} [options.env]
 * @param {Function} [options.run] - runCommand-compatible runner (injectable for tests)
 * @param {string} [options.hostname] - This machine's hostname (injectable for tests)
 * @param {Object} [options.logger] - Logger with .log for verbose output
 * @returns {Promise<{availableGiB: number|null, dataRoot: string|null, via: ('local'|'daemon'|null), daemonIsLocal: (boolean|null), measurements: Array<{path: string, availableGiB: number, via: string, image?: string}>, errors: string[], error: string|null}>}
 */
export async function checkDockerDiskSpace(verbose = false, options = {}) {
  const { image = null, env = process.env, run = runCommand, hostname = os.hostname(), logger = console } = options;
  const debug = message => {
    if (verbose) logger.log(`[VERBOSE] docker-disk-space: ${message}`);
  };
  const result = { availableGiB: null, dataRoot: null, via: null, daemonIsLocal: null, measurements: [], errors: [], error: null };
  try {
    const infoResult = await run('docker', ['info', '--format', '{{json .}}']);
    const info = infoResult.code === 0 ? parseDockerInfo(infoResult.stdout) : null;
    if (!info) {
      result.error = infoResult.code === 0 ? 'could not parse docker info output' : `docker info failed: ${describeFailure(infoResult)}`;
      debug(result.error);
      return result;
    }
    result.daemonIsLocal = info.name ? info.name === hostname : null;
    const paths = resolveDockerStoragePaths(info, env);
    debug(`daemon '${info.name || '?'}' (${result.daemonIsLocal === false ? `not this machine '${hostname}'` : 'this machine'}), driver ${info.driver || '?'}${info.containerdStore ? ' (containerd image store)' : ''}, measuring ${paths.join(', ')}`);
    let images = null;
    for (const path of paths) {
      let measured = null;
      if (result.daemonIsLocal !== false) {
        const local = await measureLocally(path, run);
        if (local.availableKb != null) measured = { availableKb: local.availableKb, via: 'local' };
        else {
          result.errors.push(`${path}: ${local.error}`);
          debug(`${path}: ${local.error}; measuring through the Docker daemon instead`);
        }
      } else {
        debug(`${path}: the daemon is not in this container's filesystem, so ${path} here is not the daemon's; measuring through the Docker daemon`);
      }
      if (!measured) {
        if (!images) images = [...new Set([image, ...(await listLocalImages(run))].filter(Boolean))].slice(0, MAX_PROBE_IMAGES);
        const remote = await measureThroughDaemon(path, images, run);
        if (remote.availableKb != null) measured = { availableKb: remote.availableKb, via: 'daemon', image: remote.image };
        else {
          result.errors.push(`${path}: ${remote.error}`);
          debug(`${path}: ${remote.error}`);
        }
      }
      if (!measured) continue;
      const availableGiB = measured.availableKb / (1024 * 1024);
      result.measurements.push({ path, availableGiB, via: measured.via, ...(measured.image ? { image: measured.image } : {}) });
      debug(`${path} has ${availableGiB.toFixed(1)} GiB free (measured ${measured.via === 'daemon' ? `through the Docker daemon in '${measured.image}'` : 'locally'})`);
    }
    const smallest = result.measurements.reduce((min, m) => (min && min.availableGiB <= m.availableGiB ? min : m), null);
    if (smallest) {
      result.availableGiB = smallest.availableGiB;
      result.dataRoot = smallest.path;
      result.via = smallest.via;
    }
    // A path that could not be measured makes the result incomplete even when
    // another one succeeded, so the reason is always surfaced.
    if (result.errors.length) result.error = result.errors.join('; ');
  } catch (error) {
    result.error = `unexpected error: ${error?.message || error}`;
    debug(result.error);
  }
  return result;
}
