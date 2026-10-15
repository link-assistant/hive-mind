/**
 * Copy a path out of a (stopped) task container (issue #2888).
 *
 * A fresh kill-recovery run gets a new container. Tool session state the killed
 * container wrote outside its host mounts is only reachable through its
 * stopped filesystem, so recovery copies it back with `docker cp`, which works
 * on stopped containers too.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2888
 */

import { getCommandStreamDollar } from './start-command-cli.lib.mjs';

// Issue #3278: kill recovery runs in the bot process, so a hung `docker cp` must not hold it forever.
const DOCKER_CP_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * `docker cp <container>:<sourcePath> <destinationPath>`. Never throws.
 *
 * @returns {Promise<{success: boolean, output: string, error: string|null}>}
 */
export async function copyFromDockerContainer(containerName, sourcePath, destinationPath, verbose = false) {
  if (!containerName || !sourcePath || !destinationPath) return { success: false, output: '', error: 'missing container name, source or destination' };
  try {
    const $ = await getCommandStreamDollar();
    const result = await $({ mirror: false, signal: AbortSignal.timeout(DOCKER_CP_TIMEOUT_MS) })`docker cp ${`${containerName}:${sourcePath}`} ${destinationPath}`;
    if (verbose) console.log(`[VERBOSE] isolation-runner: docker cp '${containerName}:${sourcePath}' '${destinationPath}' succeeded`);
    return { success: true, output: result.stdout?.toString() || result.stderr?.toString() || '', error: null };
  } catch (error) {
    const stderr = error?.stderr?.toString?.() || '';
    if (verbose) console.log(`[VERBOSE] isolation-runner: docker cp '${containerName}:${sourcePath}' failed: ${stderr.trim() || error?.message || error}`);
    return { success: false, output: error?.stdout?.toString?.() || '', error: stderr.trim() || error?.message || String(error) };
  }
}
