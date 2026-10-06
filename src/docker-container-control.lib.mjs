/**
 * Small Docker container-control helpers shared by task startup and monitoring.
 * Kept separate from the isolation runner so a resource-limit stop does not
 * need to load the complete runner and all of its task-launch dependencies.
 */
import { getCommandStreamDollar } from './start-command-cli.lib.mjs';
import { TASK_PAUSE_MARKER } from './task-pause-marker.lib.mjs';

/** Tell solve's signal cleanup to retain even an auto-cleaned private clone. */
export async function markDockerTaskPaused(containerName, paused = true, verbose = false) {
  try {
    const $ = await getCommandStreamDollar();
    const command = paused ? `touch ${TASK_PAUSE_MARKER}` : `rm -f ${TASK_PAUSE_MARKER}`;
    const result = await $({ mirror: false })`docker exec ${containerName} sh -c ${command}`;
    if (result.code !== 0) return { success: false, error: result.stderr?.toString().trim() || 'Could not mark the task workspace for retention.' };
    if (verbose) console.log(`[VERBOSE] docker-container-control: pause marker ${paused ? 'set' : 'cleared'} in ${containerName}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/** Stop a Docker task without removing it, preserving completion diagnostics. */
export async function killDockerContainer(containerName, verbose = false) {
  if (!containerName) return { success: false, output: '', error: 'missing container name' };
  try {
    const $ = await getCommandStreamDollar();
    const result = await $({ mirror: false })`docker kill ${containerName}`;
    const output = result.stdout?.toString() || result.stderr?.toString() || '';
    if (verbose) console.log(`[VERBOSE] docker-container-control: docker kill '${containerName}' succeeded`);
    return { success: true, output, error: null };
  } catch (error) {
    const stderr = error?.stderr?.toString?.().trim() || '';
    if (verbose) console.log(`[VERBOSE] docker-container-control: docker kill '${containerName}' failed: ${stderr || error?.message || error}`);
    return { success: false, output: error?.stdout?.toString?.() || '', error: stderr || error?.message || String(error) };
  }
}
