/**
 * Smaller and fewer container snapshots for in-place kill recoveries (#2889).
 *
 * The incident behind #2889 committed four stopped containers of 11-37 GiB
 * each, mostly Cargo `target/`, and left every original container and every
 * `start-command-resume/*` image on disk afterwards. This module holds the
 * Docker-side pieces Hive Mind can do on its own:
 *
 * - **Launch inspection.** Containers started by start-command >= 0.37.0 carry
 *   a command handoff, so `$ --resume` runs the recovery with `docker start`
 *   and commits nothing. Those need neither the snapshot queue nor a prune.
 * - **Cache pruning.** A container started with Hive Mind's fail-closed start
 *   gate can be started again safely: without the gate file its first process
 *   only waits. While it waits, regenerable build caches are deleted with
 *   `docker exec`, then the container is killed and committed without them.
 *   Only directories marked by the Cache Directory Tagging specification
 *   (Cargo writes `CACHEDIR.TAG` into `target/`) and `node_modules/.cache` are
 *   removed; directories holding sources (`.git`, `Cargo.toml`, `package.json`)
 *   never are. Containers whose gate times out, or that have a handoff, would
 *   run their original command when started, so they are never started here.
 * - **Cleanup.** Once the snapshot-derived container is running, the stopped
 *   original is redundant: its files are in the snapshot image. When the task
 *   finally finishes and its container is removed, the snapshot images of its
 *   resume chain are removed too. Neither removal is forced, so Docker refuses
 *   it while anything still uses the container or image.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2889
 * @see https://bford.info/cachedir/
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { shellQuote } from './shell-command.lib.mjs';

const execFileAsync = promisify(execFile);

/** First line of a valid `CACHEDIR.TAG` (Cache Directory Tagging specification). */
export const CACHEDIR_TAG_SIGNATURE = 'Signature: 8a477f597d28d172789f06886806bc55';
/** Where task workspaces live inside Hive Mind containers. */
export const SNAPSHOT_PRUNE_ROOTS = Object.freeze(['/tmp', '/home', '/root', '/workspace']);
/** Upper bound for one prune; the container is killed afterwards either way. */
export const SNAPSHOT_PRUNE_TIMEOUT_MS = 10 * 60 * 1000;
/** Exit status of the prune script when the start gate is no longer closed. */
const GATE_OPEN_EXIT = 3;
const GATE_MARKER = 'hive-mind-disk-baseline-';
const HANDOFF_ARGV0 = 'start-command-handoff';
const SNAPSHOT_IMAGE_PATTERN = /^start-command-resume\/[a-z0-9._-]+:\d+$/;

/**
 * What a task container runs when it is started, from its `Entrypoint` + `Cmd`.
 * @param {string[]|null} argv
 * @returns {{commandHandoff: boolean, startGate: 'fail-closed'|'timed'|null}|null}
 */
export function describeDockerTaskLaunch(argv) {
  if (!Array.isArray(argv) || argv.length === 0) return null;
  const index = argv.indexOf(HANDOFF_ARGV0);
  const commandHandoff = index > 0 && String(argv[index - 1]).includes('exec sh "$p"');
  const gate = argv.find(part => typeof part === 'string' && part.startsWith('gate=') && part.includes(GATE_MARKER));
  return { commandHandoff, startGate: gate ? (gate.includes('"$i" -lt') ? 'timed' : 'fail-closed') : null };
}

/** `docker inspect` the container's launch command; null when unavailable. */
export async function inspectDockerTaskLaunch(containerName, { run = execFileAsync, verbose = false } = {}) {
  try {
    const { stdout } = await run('docker', ['inspect', '--format', '{{json .Config}}', containerName]);
    const config = JSON.parse(stdout);
    const launch = describeDockerTaskLaunch([...(config?.Entrypoint || []), ...(config?.Cmd || [])]);
    if (verbose) console.log(`[VERBOSE] Launch of ${containerName}: ${JSON.stringify(launch)}`);
    return launch;
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] Could not inspect the launch command of ${containerName}: ${error?.message || error}`);
    return null;
  }
}

/** Only a fail-closed gate without a handoff keeps a started container idle. */
export function canPruneStoppedContainer(launch) {
  return Boolean(launch && !launch.commandHandoff && launch.startGate === 'fail-closed');
}

/**
 * The `sh` script run inside the gated container. Prints `pruned <KiB> <dir>`
 * per removed directory. With `requireGate`, it first checks that PID 1 is
 * still the gate loop, so it can never run beside the task itself.
 */
export function buildSnapshotCachePruneScript({ roots = SNAPSHOT_PRUNE_ROOTS, requireGate = true } = {}) {
  const quoted = roots.map(shellQuote).join(' ');
  const protectedDirs = ['/', ...roots].map(shellQuote).join('|');
  return [
    // The marker is assembled at run time, so this script's own command line
    // (PID 1 when it is not run through `docker exec`) never matches it.
    requireGate ? `marker="hive-mind-disk"-"baseline-"; case "$(tr '\\000' ' ' < /proc/1/cmdline 2>/dev/null)" in *"$marker"*) ;; *) echo gate-open; exit ${GATE_OPEN_EXIT} ;; esac` : null,
    `sig=${shellQuote(CACHEDIR_TAG_SIGNATURE)}`,
    `for root in ${quoted}; do`,
    '  [ -d "$root" ] || continue',
    '  find "$root" -xdev -name .git -prune -o -type f -name CACHEDIR.TAG -print 2>/dev/null',
    '  find "$root" -xdev -name .git -prune -o -type d -path \'*/node_modules/.cache\' -print -prune 2>/dev/null',
    'done | while IFS= read -r hit; do',
    '  case "$hit" in */CACHEDIR.TAG) dir=${hit%/CACHEDIR.TAG}; [ "$(head -c 43 "$hit" 2>/dev/null)" = "$sig" ] || continue ;; *) dir=$hit ;; esac',
    `  case "$dir" in ''|${protectedDirs}) continue ;; esac`,
    '  [ "${dir%/*}" = /home ] && continue',
    '  [ -d "$dir" ] || continue',
    '  [ -e "$dir/.git" ] || [ -e "$dir/Cargo.toml" ] || [ -e "$dir/package.json" ] && continue',
    '  kib=$(du -sk "$dir" 2>/dev/null | cut -f1)',
    '  rm -rf -- "$dir" && echo "pruned ${kib:-0} $dir"',
    'done',
    'exit 0',
  ]
    .filter(Boolean)
    .join('\n');
}

/** @returns {{paths: string[], freedBytes: number, gateOpen: boolean}} */
export function parseSnapshotCachePruneOutput(output) {
  const paths = [];
  let freedBytes = 0;
  let gateOpen = false;
  for (const line of String(output || '').split('\n')) {
    if (line.trim() === 'gate-open') gateOpen = true;
    const match = /^pruned (\d+) (.+)$/.exec(line);
    if (!match) continue;
    paths.push(match[2]);
    freedBytes += Number(match[1]) * 1024;
  }
  return { paths, freedBytes, gateOpen };
}

/**
 * Start a stopped, fail-closed gated container, prune its regenerable caches
 * while the gate holds it idle, and kill it again. Never throws.
 * @returns {Promise<{pruned: boolean, freedBytes: number, paths: string[], reason: string|null}>}
 */
export async function pruneStoppedContainerCaches(containerName, { launch = null, run = execFileAsync, roots = SNAPSHOT_PRUNE_ROOTS, timeoutMs = SNAPSHOT_PRUNE_TIMEOUT_MS, verbose = false } = {}) {
  const skip = reason => ({ pruned: false, freedBytes: 0, paths: [], reason });
  if (!canPruneStoppedContainer(launch)) {
    if (launch?.commandHandoff) return skip('the container has a start-command handoff and resumes without a snapshot');
    return skip(launch?.startGate === 'timed' ? 'starting the container would run its original task once the start gate times out' : 'the container was not started behind a fail-closed Hive Mind start gate');
  }
  try {
    await run('docker', ['start', containerName]);
  } catch (error) {
    return skip(`docker start failed: ${error?.message || error}`);
  }
  let parsed;
  let failure = null;
  try {
    const { stdout } = await run('docker', ['exec', containerName, 'sh', '-c', buildSnapshotCachePruneScript({ roots })], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
    parsed = parseSnapshotCachePruneOutput(stdout);
  } catch (error) {
    parsed = parseSnapshotCachePruneOutput(error?.stdout);
    failure = error?.message || String(error);
  } finally {
    await run('docker', ['kill', containerName]).catch(error => {
      console.warn(`[session-kill-resume] Could not stop ${containerName} after pruning its caches: ${error?.message || error}`);
    });
  }
  if (parsed.gateOpen) return skip('the start gate was already open, so the container was stopped without pruning');
  if (verbose) console.log(`[VERBOSE] Pruned ${parsed.paths.length} cache director${parsed.paths.length === 1 ? 'y' : 'ies'} (${parsed.freedBytes} bytes) from ${containerName}${failure ? ` before an error: ${failure}` : ''}`);
  return { pruned: parsed.paths.length > 0, freedBytes: parsed.freedBytes, paths: parsed.paths, reason: failure };
}

/**
 * Remove the stopped original once its snapshot-derived replacement runs.
 * Only a confirmed `docker-snapshot` pair qualifies; `docker rm` is not forced.
 * @returns {Promise<{removed: boolean, error: string|null}>}
 */
export async function removeReplacedResumeOriginal(result, { originalName, run = execFileAsync, verbose = false } = {}) {
  const { mode, sessionName, previousSessionName } = result || {};
  const suffix = typeof sessionName === 'string' && originalName ? sessionName.slice(originalName.length) : '';
  if (mode !== 'docker-snapshot' || !originalName || previousSessionName !== originalName || !sessionName?.startsWith(originalName) || !/^-resume-\d+$/.test(suffix)) {
    return { removed: false, error: `Kept ${originalName || '(unknown)'}: no confirmed snapshot replacement.` };
  }
  try {
    await run('docker', ['rm', originalName]);
    if (verbose) console.log(`[VERBOSE] Removed ${originalName}; its files continue in ${sessionName}`);
    return { removed: true, error: null };
  } catch (error) {
    return { removed: false, error: `Could not remove ${originalName}: ${error?.stderr || error?.message || error}` };
  }
}

/** start-command's image name for a snapshot (`buildSnapshotImageName`). */
function snapshotImageName(sessionName, attempt) {
  const sanitized = String(sessionName)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+/, '');
  return `start-command-resume/${sanitized || 'session'}:${attempt}`;
}

/** Snapshot images behind a container, newest first, from its `-resume-N` chain. */
export function snapshotImagesForContainer(containerName) {
  const images = [];
  let current = String(containerName || '');
  for (let match = /^(.+)-resume-(\d+)$/.exec(current); match; match = /^(.+)-resume-(\d+)$/.exec(current)) {
    images.push(snapshotImageName(match[1], match[2]));
    current = match[1];
  }
  return images;
}

/**
 * Remove snapshot images without force; images still in use are retained.
 * @returns {Promise<{removed: string[], retained: Array<{image: string, error: string}>}>}
 */
export async function removeSnapshotImages(images, { run = execFileAsync, verbose = false } = {}) {
  const removed = [];
  const retained = [];
  for (const image of [...new Set(images || [])].filter(ref => SNAPSHOT_IMAGE_PATTERN.test(ref))) {
    try {
      await run('docker', ['image', 'rm', image]);
      removed.push(image);
    } catch (error) {
      retained.push({ image, error: String(error?.stderr || error?.message || error).trim() });
    }
  }
  if (verbose && (removed.length || retained.length)) console.log(`[VERBOSE] Snapshot images removed: ${removed.join(', ') || 'none'}; retained: ${retained.map(item => `${item.image} (${item.error})`).join(', ') || 'none'}`);
  return { removed, retained };
}
