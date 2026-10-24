/**
 * Shared access to the `$` CLI (start-command, link-foundation/start).
 *
 * Extracted from src/isolation-runner.lib.mjs (issue #2189) so the resume/attach
 * wrappers added for `start-command@0.33.0` can reach the same lazily-loaded
 * `command-stream` `$` and the same PATH lookup without importing the runner —
 * which would create a cycle — and without duplicating either.
 *
 * @see https://github.com/link-foundation/start
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 */

import { ensureUseM } from './use-m-bootstrap.lib.mjs';
import { runProbe, STATUS_PROBE_TIMEOUT_MS } from './status-probes.lib.mjs';

/** The message every wrapper reports when `$` is not installed. */
export const START_COMMAND_MISSING_ERROR = '`$` (start-command) binary not found on PATH. Install link-foundation/start.';

let commandStreamDollarPromise = null;

/**
 * Lazily load `command-stream`'s `$` template tag.
 *
 * Cached across calls; a failed load clears the cache so a transient failure
 * (a cold `use-m` fetch, say) does not poison every later call.
 *
 * @returns {Promise<Function>} The `$` template tag
 */
export async function getCommandStreamDollar() {
  if (!commandStreamDollarPromise) {
    commandStreamDollarPromise = (async () => {
      if (typeof globalThis.use === 'undefined') {
        await ensureUseM();
      }
      const { $ } = await globalThis.use('command-stream');
      return $;
    })();
  }
  try {
    return await commandStreamDollarPromise;
  } catch (error) {
    commandStreamDollarPromise = null;
    throw error;
  }
}

// Issue #3614: `findStartCommandBinary()` ran `which $` through command-stream's
// login shell (`sh -l -c`) before every `$ --status`, `$ --list` and launch —
// a process pair per status check. The answer only changes when PATH or the
// installation changes, so a found path is kept for as long as PATH is the
// same, and a miss is re-checked after a minute (an operator may install `$`
// while the bot runs).
const START_COMMAND_MISS_TTL_MS = 60_000;
let startCommandBinaryCache = null; // { pathEnv, value, at }
let startCommandBinaryInflight = null; // { pathEnv, promise }

/** Look `$` up on the bot's own PATH without starting a process. */
async function findExecutableOnPath(name, pathEnv) {
  const { access, constants } = await import('node:fs/promises');
  const path = await import('node:path');
  for (const dir of String(pathEnv || '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not in this directory.
    }
  }
  return null;
}

async function lookupStartCommandBinary(pathEnv) {
  const direct = await findExecutableOnPath('$', pathEnv);
  if (direct) return direct;
  // A login shell can add directories (~/.bun/bin) the bot's PATH lacks, so a
  // miss is confirmed the way it always was. This runs at most once a minute.
  try {
    const $ = await getCommandStreamDollar();
    const result = await $({ mirror: false })`which $`;
    const resolved = result.stdout?.toString().trim() || '';
    return resolved || null;
  } catch {
    return null;
  }
}

/**
 * Find the `$` CLI binary path.
 *
 * Cached per PATH value (issue #3614); concurrent callers share one lookup.
 *
 * @returns {Promise<string|null>} Path to the `$` binary, or null when absent
 */
export async function findStartCommandBinary() {
  const pathEnv = process.env.PATH || '';
  const cached = startCommandBinaryCache;
  if (cached && cached.pathEnv === pathEnv && (cached.value || Date.now() - cached.at < START_COMMAND_MISS_TTL_MS)) {
    return cached.value;
  }
  if (startCommandBinaryInflight?.pathEnv === pathEnv) return startCommandBinaryInflight.promise;
  const promise = lookupStartCommandBinary(pathEnv);
  const record = { pathEnv, promise };
  startCommandBinaryInflight = record;
  try {
    const value = await promise;
    startCommandBinaryCache = { pathEnv, value, at: Date.now() };
    return value;
  } finally {
    if (startCommandBinaryInflight === record) startCommandBinaryInflight = null;
  }
}

/** Forget the cached `$` path (tests, and after an in-process install). */
export function resetStartCommandBinaryCacheForTests() {
  startCommandBinaryCache = null;
  startCommandBinaryInflight = null;
  startCommandNeedsLoginShell = false;
}

/**
 * Run a read-only `$` query (`--status`, `--list`) without a shell.
 *
 * Issue #3614: command-stream runs every command as `/bin/sh -l -c …`, so each
 * status check cost a login shell on top of `$` itself. The binary is run
 * directly; only when that cannot start it (exit 127: `#!/usr/bin/env bun`
 * with bun only on a login shell's PATH) does it fall back to command-stream,
 * and the fallback is remembered for the rest of the process.
 *
 * @param {string} binPath - Path from findStartCommandBinary()
 * @param {string[]} args
 * @param {{run?: Function}} [options]
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export async function runStartCommandQuery(binPath, args, { run = runProbe } = {}) {
  if (!startCommandNeedsLoginShell) {
    const direct = await run(binPath, args);
    if (direct.code !== 127) return direct;
    startCommandNeedsLoginShell = true;
  }
  const $ = await getCommandStreamDollar();
  const result = await $({ mirror: false, signal: AbortSignal.timeout(STATUS_PROBE_TIMEOUT_MS) })`${binPath} ${args}`;
  return { code: Number.isFinite(result.code) ? result.code : 0, stdout: result.stdout?.toString() || '', stderr: result.stderr?.toString() || '' };
}
let startCommandNeedsLoginShell = false;

const VERSION_PROBE_TIMEOUT_MS = 30_000;
let startCommandVersionPromise = null;

/**
 * Parse the first line of `$ --version` (`start-command version: 0.35.0`).
 *
 * @param {string} output - `$ --version` stdout
 * @returns {string|null} The semver version, or null when it is not reported
 */
export function parseStartCommandVersion(output) {
  const match = /start-command version:\s*v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(String(output || ''));
  return match ? match[1] : null;
}

/**
 * The installed `$` version, probed once per process and cached.
 *
 * Feature gates use it to choose between behaviours that differ across
 * start-command releases (issue #2408: a snapshot resume only keeps the
 * container's CPU/RAM limits from 0.35.0, start#176). A failed probe is not
 * cached, and resolves to null so callers take their conservative path.
 *
 * @param {Object} [options]
 * @param {boolean} [options.verbose]
 * @returns {Promise<string|null>}
 */
export async function getStartCommandVersion({ verbose = false } = {}) {
  if (!startCommandVersionPromise) {
    startCommandVersionPromise = (async () => {
      const binPath = await findStartCommandBinary();
      if (!binPath) return null;
      const { execFile } = await import('node:child_process');
      const stdout = await new Promise(resolve => {
        execFile(binPath, ['--version'], { timeout: VERSION_PROBE_TIMEOUT_MS, encoding: 'utf8' }, (error, out) => resolve(error && !out ? '' : out || ''));
      });
      return parseStartCommandVersion(stdout);
    })();
  }
  const version = await startCommandVersionPromise;
  if (!version) startCommandVersionPromise = null;
  if (verbose) console.log(`[VERBOSE] start-command: installed $ version ${version || '(unknown)'}`);
  return version;
}

/** Forget the cached version (tests, and after an in-process upgrade). */
export function resetStartCommandVersionCacheForTests() {
  startCommandVersionPromise = null;
}
