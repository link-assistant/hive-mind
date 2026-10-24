/**
 * Shared, rate-limited liveness probes for isolated sessions.
 *
 * Issue #3614: each `checkDockerContainerRunning`, `checkScreenSessionRunning`
 * and `checkTmuxSessionRunning` call used to start `/bin/sh -l -c` (command-
 * stream wraps every command in a login shell) plus the probe itself, once per
 * session per caller. These helpers run the probe binary directly with
 * `execFile` (no shell) and answer every session from one listing that is
 * refreshed at most once per `HIVE_MIND_DOCKER_STATUS_MIN_INTERVAL_MS`:
 *
 * - Docker: one `docker ps` for all running containers, instead of one
 *   `docker inspect` per container;
 * - screen: one `screen -ls` for all sessions;
 * - tmux: one `tmux has-session` per session (tmux has no cheaper listing that
 *   matches `-t` target rules), cached per session.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3614
 */
import { execFile } from 'node:child_process';
import { statusCheckCache } from './status-check-cache.lib.mjs';

// Same bound as the other docker queries the bot runs (issue #3278): a hung
// daemon fails the probe instead of leaving the monitor waiting forever.
export const STATUS_PROBE_TIMEOUT_MS = 120_000;

/**
 * Run a probe binary without a shell. Never throws.
 *
 * @param {string} file
 * @param {string[]} args
 * @param {{timeout?: number, execFileImpl?: Function}} [options]
 * @returns {Promise<{code: number, stdout: string, stderr: string, error: string|null}>}
 */
export function runProbe(file, args, { timeout = STATUS_PROBE_TIMEOUT_MS, execFileImpl = execFile } = {}) {
  return new Promise(resolve => {
    execFileImpl(file, args, { timeout, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolve({ code: 0, stdout: stdout || '', stderr: stderr || '', error: null });
      // ENOENT (binary missing) has a string code; report it like a shell would.
      const code = Number.isInteger(error.code) ? error.code : error.code === 'ENOENT' ? 127 : 1;
      resolve({ code, stdout: stdout || '', stderr: stderr || '', error: error.message });
    });
  });
}

/**
 * Parse `docker ps --no-trunc --format '{{.ID}}\t{{.Names}}'` into the set of
 * identifiers (full IDs and every name) of running containers.
 *
 * @param {string} output
 * @returns {Set<string>}
 */
export function parseDockerPsNames(output) {
  const names = new Set();
  for (const line of String(output || '').split('\n')) {
    const [id, namesField = ''] = line.trim().split('\t');
    if (!id) continue;
    names.add(id);
    for (const name of namesField.split(',')) if (name.trim()) names.add(name.trim());
  }
  return names;
}

/**
 * Names and IDs of the running containers, from one shared `docker ps`.
 * Resolves to `null` when Docker cannot be queried.
 *
 * @param {{verbose?: boolean, run?: typeof runProbe}} [options]
 * @returns {Promise<Set<string>|null>}
 */
export async function getRunningDockerContainerNames({ verbose = false, run = runProbe } = {}) {
  const output = await statusCheckCache.get('docker-ps', async () => {
    const result = await run('docker', ['ps', '--no-trunc', '--format', '{{.ID}}\t{{.Names}}']);
    if (verbose) console.log(`[VERBOSE] status-probes: docker ps exited ${result.code}${result.error ? ` (${result.error})` : ''}`);
    return result.code === 0 ? result.stdout : null;
  });
  return output === null ? null : parseDockerPsNames(output);
}

/**
 * `screen -ls` output shared by every screen session check. `screen -ls`
 * exits 1 when it lists no sessions, so the output is used regardless of the
 * exit code.
 *
 * @param {{run?: typeof runProbe}} [options]
 * @returns {Promise<string>}
 */
export function getScreenSessionListing({ run = runProbe } = {}) {
  return statusCheckCache.get('screen-ls', async () => (await run('screen', ['-ls'])).stdout);
}

/**
 * Whether `tmux has-session -t <name>` succeeds, cached per session.
 *
 * @param {string} sessionName
 * @param {{run?: typeof runProbe}} [options]
 * @returns {Promise<boolean>}
 */
export function hasTmuxSession(sessionName, { run = runProbe } = {}) {
  return statusCheckCache.get(`tmux:${sessionName}`, async () => (await run('tmux', ['has-session', '-t', String(sessionName)])).code === 0);
}
