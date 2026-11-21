/**
 * Free space on the Docker daemon's data root, for the `--isolation docker`
 * preflight and the kill-recovery snapshot guards. Split out of
 * isolation-runner.lib.mjs (issue #3469), which re-exports it.
 */
import { getCommandStreamDollar } from './start-command-cli.lib.mjs';

// Same bound as the other docker queries of isolation-runner.lib.mjs (issue #3278).
const DOCKER_CLI_TIMEOUT_MS = 120_000;

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
export async function checkDockerDiskSpace(verbose = false, { getDollar = getCommandStreamDollar } = {}) {
  try {
    let dataRoot = '/var/lib/docker';
    try {
      const $ = await getDollar();
      const info = await $({ mirror: false, signal: AbortSignal.timeout(DOCKER_CLI_TIMEOUT_MS) })`docker info --format ${'{{.DockerRootDir}}'}`;
      const root = (info.stdout?.toString() || '').trim();
      if (root) dataRoot = root;
    } catch {
      // Daemon unreachable: fall back to the conventional data root. If df then
      // fails on it (e.g. the path does not exist) we return null below.
    }
    const $ = await getDollar();
    const df = await $({ mirror: false })`df -Pk ${dataRoot}`;
    const availableKb = parseDfAvailableKb(df.stdout?.toString());
    if (availableKb === null) {
      // Issue #3469: the bot log said only "could not parse df output", which
      // cannot tell a missing data root (the daemon's path is not visible in
      // this container) from an unexpected df format.
      if (verbose) console.log(`[VERBOSE] isolation-runner: could not parse df output for Docker disk space (data root '${dataRoot}', df exit ${df.code ?? 'unknown'}, stdout ${JSON.stringify((df.stdout?.toString() || '').trim().split('\n').at(-1) || '')}, stderr ${JSON.stringify((df.stderr?.toString() || '').trim())})`);
      return null;
    }
    const availableGiB = availableKb / (1024 * 1024);
    if (verbose) console.log(`[VERBOSE] isolation-runner: Docker data root '${dataRoot}' has ${availableGiB.toFixed(1)} GiB free`);
    return { availableGiB, dataRoot };
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] isolation-runner: df unavailable; Docker disk space unknown (${String(error?.message || error).split('\n')[0]})`);
    return null;
  }
}

/**
 * Available KiB in `df -Pk` output, or null. `df -P` guarantees one logical line
 * per filesystem (no wrapping); the last line is the data row:
 * Filesystem 1024-blocks Used Available Capacity Mount.
 */
export const parseDfAvailableKb = stdout => {
  const lines = String(stdout ?? '')
    .trim()
    .split('\n');
  const cols = (lines[lines.length - 1] || '').trim().split(/\s+/);
  if (lines.length < 2 || !/^\d+$/.test(cols[3] ?? '')) return null;
  return Number(cols[3]);
};
