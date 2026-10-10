/**
 * In-place command handoff for Docker task containers (issue #2889).
 *
 * `$ --resume <id> -- <command>` can only run a *new* command against a stopped
 * container by committing that container's whole filesystem to an image
 * (start-command's `docker-snapshot` mode). For a Rust or Node build that is
 * tens of gigabytes per container: the commit loads the CPU for half an hour,
 * the original container and its snapshot then coexist on disk, and several
 * kill recoveries started by one OOM event filled the Docker data root.
 *
 * `$ --resume <id>` *without* a command restarts the same container with
 * `docker start` instead: no copy, the same writable layer, the same HostConfig
 * (so `docker update` CPU/RAM limits survive). What it re-runs is the command
 * the container was created with, so every Hive Mind task container is now
 * created with a short prefix that looks for a handoff file first:
 *
 *     h='/tmp/hive-mind-resume-command-<token>'; if [ -f "$h" ]; then exec sh "$h"; fi; <original command>
 *
 * Before resuming, Hive Mind writes the recovery command to that file with
 * `docker cp`, which works on stopped containers, and only then runs
 * `$ --resume <id>`. The first start finds no file and runs the task (through
 * its start gate); a restart finds the file and runs the recovery command,
 * skipping a gate that would otherwise wait for a file that no longer exists.
 * The file is kept, so a later restart runs the latest recovery command rather
 * than the original task. start-command uses the same `docker cp` + entrypoint
 * selector technique for its own `--on-kill-resume` recovery marker.
 *
 * The handoff path is read back from the container's own `Config.Cmd`, so a
 * container created before this prefix existed is recognised as "no handoff"
 * and takes the snapshot path, which is guarded separately (see
 * `./docker-resume-snapshot-guard.lib.mjs`).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2889
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getCommandStreamDollar } from './start-command-cli.lib.mjs';

/** Directory and name prefix of every handoff file inside a task container. */
export const DOCKER_RESUME_HANDOFF_PATH_PREFIX = '/tmp/hive-mind-resume-command-';

const HANDOFF_TOKEN_RE = /^[A-Za-z0-9._-]+$/;
const HANDOFF_PREFIX_RE = /h='(\/tmp\/hive-mind-resume-command-[A-Za-z0-9._-]+)'; if \[ -f "\$h" \]; then exec sh "\$h"; fi;/;

function shellQuote(value) {
  const stringValue = String(value);
  if (stringValue === '') return "''";
  return `'${stringValue.replaceAll("'", "'\\''")}'`;
}

/**
 * Shell form of `<command> <args...>`, quoted the way task containers are launched.
 *
 * @param {string} command
 * @param {string[]} [args]
 * @returns {string}
 */
export function buildShellCommandLine(command, args = []) {
  return [command, ...args].map(shellQuote).join(' ');
}

/**
 * Handoff file path for a container token (the Hive Mind session id at launch).
 *
 * @param {string|null} token
 * @returns {string|null} Null when the token is missing or not path-safe
 */
export function buildDockerResumeHandoffPath(token) {
  const text = String(token || '');
  return HANDOFF_TOKEN_RE.test(text) ? `${DOCKER_RESUME_HANDOFF_PATH_PREFIX}${text}` : null;
}

/**
 * Prefix a container command with the handoff check. The original command runs
 * unchanged when no handoff file has been written.
 *
 * @param {string} command - Shell command the container is created with
 * @param {string|null} token - Path-safe token naming the handoff file
 * @returns {string}
 */
export function withDockerResumeHandoff(command, token) {
  const handoffPath = buildDockerResumeHandoffPath(token);
  if (!handoffPath) return command;
  return `h=${shellQuote(handoffPath)}; if [ -f "$h" ]; then exec sh "$h"; fi; ${command}`;
}

/**
 * Find the handoff path in a container's command (`docker inspect` `Config.Cmd`,
 * as a JSON array or plain text).
 *
 * @param {string|string[]|null} cmd
 * @returns {string|null} Null for containers created without the handoff prefix
 */
export function parseDockerResumeHandoffPath(cmd) {
  let text = Array.isArray(cmd) ? cmd.join(' ') : String(cmd || '');
  if (!Array.isArray(cmd)) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) text = parsed.join(' ');
    } catch {
      // Plain text, not inspect JSON.
    }
  }
  const match = HANDOFF_PREFIX_RE.exec(text);
  return match ? match[1] : null;
}

/**
 * Content of the handoff file: one `exec` of the recovery command.
 *
 * @param {string} command - Shell-quoted recovery command (never the Telegram display form)
 * @returns {string}
 */
export function buildDockerResumeHandoffScript(command) {
  return `# Written by Hive Mind before \`docker start\` resumed this container (issue #2889).\nexec ${command}\n`;
}

/**
 * Docker container that currently runs a tracked session's work.
 *
 * A session launched by Hive Mind lives in a container named after its session
 * id. A recovery that restarted the *same* container is tracked under its
 * execution UUID (the original key belongs to the killed session's report), so
 * the container name is recorded separately; Docker probes, kills and removals
 * must use it rather than the tracking key.
 *
 * @param {Object|null} sessionInfo
 * @param {string|null} [sessionName]
 * @returns {string|null}
 */
export function getDockerTaskContainerName(sessionInfo, sessionName = null) {
  return sessionInfo?.containerName || sessionInfo?.sessionId || sessionName || null;
}

function describeError(error) {
  return error?.stderr?.toString?.().trim() || error?.message || String(error);
}

/** command-stream resolves on a non-zero exit; turn that into a thrown error. */
function checked(result) {
  const code = Number.isFinite(result?.code) ? result.code : 0;
  if (code !== 0) throw new Error(result?.stderr?.toString?.().trim() || `exit code ${code}`);
  return result;
}

/**
 * Read the handoff path from a container's creation command.
 *
 * @param {string} containerName
 * @param {Object} [options]
 * @param {boolean} [options.verbose]
 * @param {Function} [options.getDollar] - Test seam returning a command-stream `$`
 * @returns {Promise<string|null>} Null when unsupported or uninspectable
 */
export async function readDockerResumeHandoffPath(containerName, { verbose = false, getDollar = getCommandStreamDollar } = {}) {
  if (!containerName) return null;
  try {
    const $ = await getDollar();
    const result = checked(await $({ mirror: false })`docker inspect -f ${'{{json .Config.Cmd}}'} ${containerName}`);
    const handoffPath = parseDockerResumeHandoffPath(result.stdout?.toString() || '');
    if (verbose) console.log(`[VERBOSE] docker-resume-handoff: '${containerName}' ${handoffPath ? `accepts a resume handoff at ${handoffPath}` : 'was created without a resume handoff'}`);
    return handoffPath;
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] docker-resume-handoff: could not inspect '${containerName}': ${describeError(error)}`);
    return null;
  }
}

/**
 * Write the recovery command into a (stopped) container's handoff file.
 *
 * @param {string} containerName
 * @param {string} handoffPath - From readDockerResumeHandoffPath()
 * @param {string} command - Shell-quoted recovery command
 * @param {Object} [options]
 * @param {boolean} [options.verbose]
 * @param {Function} [options.getDollar] - Test seam returning a command-stream `$`
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
export async function writeDockerResumeHandoff(containerName, handoffPath, command, { verbose = false, getDollar = getCommandStreamDollar } = {}) {
  if (!containerName || !handoffPath || !command) return { success: false, error: 'missing container, handoff path or command' };
  let dir = null;
  try {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-mind-resume-handoff-'));
    const file = path.join(dir, 'command.sh');
    await fs.writeFile(file, buildDockerResumeHandoffScript(command), { mode: 0o644 });
    const $ = await getDollar();
    checked(await $({ mirror: false })`docker cp ${file} ${`${containerName}:${handoffPath}`}`);
    if (verbose) console.log(`[VERBOSE] docker-resume-handoff: wrote the recovery command to ${containerName}:${handoffPath}`);
    return { success: true, error: null };
  } catch (error) {
    const message = describeError(error);
    if (verbose) console.log(`[VERBOSE] docker-resume-handoff: could not write ${containerName}:${handoffPath}: ${message}`);
    return { success: false, error: message };
  } finally {
    if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Remove a container only if it is not running (`docker rm` without `-f`), so
 * a container that was restarted in the meantime is never killed by cleanup.
 *
 * @param {string} containerName
 * @param {Object} [options]
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
export async function removeStoppedDockerContainer(containerName, { verbose = false, getDollar = getCommandStreamDollar } = {}) {
  if (!containerName) return { success: false, error: 'missing container name' };
  try {
    const $ = await getDollar();
    checked(await $({ mirror: false })`docker rm ${containerName}`);
    if (verbose) console.log(`[VERBOSE] docker-resume-handoff: removed stopped container '${containerName}'`);
    return { success: true, error: null };
  } catch (error) {
    const message = describeError(error);
    if (verbose) console.log(`[VERBOSE] docker-resume-handoff: could not remove '${containerName}': ${message}`);
    return { success: false, error: message };
  }
}

/**
 * Untag snapshot images a finished task no longer needs. Docker refuses while a
 * container still uses an image, which is the desired outcome for a kept one.
 *
 * @param {string[]} images
 * @param {Object} [options]
 * @returns {Promise<{removed: string[], failed: Array<{image: string, error: string}>}>}
 */
export async function removeDockerSnapshotImages(images, { verbose = false, getDollar = getCommandStreamDollar } = {}) {
  const removed = [];
  const failed = [];
  for (const image of [...new Set((Array.isArray(images) ? images : []).filter(Boolean))].reverse()) {
    try {
      const $ = await getDollar();
      checked(await $({ mirror: false })`docker rmi ${image}`);
      removed.push(image);
      if (verbose) console.log(`[VERBOSE] docker-resume-handoff: removed snapshot image '${image}'`);
    } catch (error) {
      failed.push({ image, error: describeError(error) });
      if (verbose) console.log(`[VERBOSE] docker-resume-handoff: could not remove snapshot image '${image}': ${describeError(error)}`);
    }
  }
  return { removed, failed };
}

/**
 * Adjust the killed session's container completion action once its recovery
 * is known. The recovery owns the snapshot images from here on; a container it
 * restarted with `docker start` must not be removed (even under
 * `HIVE_MIND_KEEP_TASK_CONTAINER=never`), and a snapshotted original that was
 * already removed must not be reported as kept.
 *
 * @param {Object|null} action - From buildDockerTaskContainerCompletionAction()
 * @param {Object|null} recovery - From recoverKilledSession()
 * @returns {Object|null} The same action, adjusted in place
 */
export function settleDockerTaskContainerActionAfterRecovery(action, recovery) {
  if (!action?.applies || !recovery?.resumed) return action;
  action.snapshotImages = [];
  if (recovery.containerReused || recovery.originalContainerRemoved) {
    action.shouldRemove = false;
    action.extraSection = '';
  }
  return action;
}
