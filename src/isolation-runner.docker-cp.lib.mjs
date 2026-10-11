import { getCommandStreamDollar } from './start-command-cli.lib.mjs';

/**
 * Copy a path out of a (possibly stopped) task container with `docker cp`.
 * Issue #2888: a killed Codex task's rollout lives in the container's own
 * repository-scoped CODEX_HOME; a fresh recovery run needs it on the host.
 *
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
export async function copyFromDockerContainer(containerName, sourcePath, destinationPath, verbose = false) {
  if (!containerName || !sourcePath || !destinationPath) return { success: false, error: 'containerName, sourcePath and destinationPath are required' };
  try {
    const $ = await getCommandStreamDollar();
    const result = await $({ mirror: false })`docker cp ${`${containerName}:${sourcePath}`} ${destinationPath}`;
    const code = Number.isFinite(result.code) ? result.code : 0;
    const error = code === 0 ? null : (result.stderr?.toString() || '').trim() || `docker cp exited with ${code}`;
    if (verbose) console.log(`[VERBOSE] isolation-runner: docker cp ${containerName}:${sourcePath} → ${destinationPath}: ${error || 'ok'}`);
    return { success: code === 0, error };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
}
