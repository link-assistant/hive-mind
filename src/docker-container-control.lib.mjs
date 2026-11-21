/**
 * Small Docker container-control helpers shared by task startup and monitoring.
 * Kept separate from the isolation runner so a resource-limit stop does not
 * need to load the complete runner and all of its task-launch dependencies.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { findStartCommandBinary, getCommandStreamDollar, START_COMMAND_MISSING_ERROR } from './start-command-cli.lib.mjs';
import { TASK_PAUSE_MARKER } from './task-pause-marker.lib.mjs';

const run = promisify(execFile);
const CONTROL_TIMEOUT_MS = 40_000;

export async function inspectDockerContainerState(containerName, verbose = false) {
  if (!containerName) return null;
  try {
    const { stdout } = await run('docker', ['inspect', '--type', 'container', '--format', '{{.State.Status}} {{.State.Paused}}', '--', containerName], { timeout: CONTROL_TIMEOUT_MS });
    const [state, paused] = stdout.trim().split(/\s+/);
    return paused === 'true' ? 'paused' : state || null;
  } catch (error) {
    const diagnostic = error.stderr?.trim() || error.message;
    if (/no such (?:object|container)/i.test(diagnostic)) return 'removed';
    if (verbose) console.log(`[VERBOSE] Docker state unavailable for ${containerName}: ${diagnostic}`);
    return null;
  }
}

// Keep start-command's execution record and Docker state in sync.
async function controlDockerPause(verb, identifier, { requestedBy, reason, verbose = false } = {}) {
  const binary = await findStartCommandBinary();
  if (!binary) return { success: false, error: START_COMMAND_MISSING_ERROR };
  const args = [verb, identifier, '--output-format', 'json'];
  if (verb === '--pause') {
    if (requestedBy) args.push('--paused-by', requestedBy);
    if (reason) args.push('--pause-reason', reason);
  }
  try {
    const { stdout } = await run(binary, args, { timeout: CONTROL_TIMEOUT_MS });
    const result = JSON.parse(stdout);
    return { ...result, success: true };
  } catch (error) {
    const diagnostic = error.stderr?.trim() || error.message;
    if (verbose) console.log(`[VERBOSE] ${verb} ${identifier}: ${diagnostic}`);
    return { success: false, error: diagnostic };
  }
}

export const pauseDockerSession = (identifier, options) => controlDockerPause('--pause', identifier, options);
export const unpauseDockerSession = (identifier, options) => controlDockerPause('--unpause', identifier, options);

/** Copy the marker without executing inside a frozen container. */
export async function markDockerTaskForStop(containerName) {
  const dir = await mkdtemp(join(tmpdir(), 'hive-mind-stop-'));
  try {
    const marker = join(dir, 'retain');
    await writeFile(marker, '');
    await run('docker', ['cp', marker, `${containerName}:${TASK_PAUSE_MARKER}`], { timeout: CONTROL_TIMEOUT_MS });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Issue #3278: a hung daemon fails the kill instead of blocking the caller forever.
const DOCKER_KILL_TIMEOUT_MS = 120_000;

/** Stop a Docker task without removing it, preserving completion diagnostics. */
export async function killDockerContainer(containerName, verbose = false) {
  if (!containerName) return { success: false, output: '', error: 'missing container name' };
  try {
    const $ = await getCommandStreamDollar();
    const result = await $({ mirror: false, signal: AbortSignal.timeout(DOCKER_KILL_TIMEOUT_MS) })`docker kill ${containerName}`;
    const output = result.stdout?.toString() || result.stderr?.toString() || '';
    if (verbose) console.log(`[VERBOSE] docker-container-control: docker kill '${containerName}' succeeded`);
    return { success: true, output, error: null };
  } catch (error) {
    const stderr = error?.stderr?.toString?.().trim() || '';
    if (verbose) console.log(`[VERBOSE] docker-container-control: docker kill '${containerName}' failed: ${stderr || error?.message || error}`);
    return { success: false, output: error?.stdout?.toString?.() || '', error: stderr || error?.message || String(error) };
  }
}
