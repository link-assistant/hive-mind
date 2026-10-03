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

/**
 * Find the `$` CLI binary path.
 *
 * @returns {Promise<string|null>} Path to the `$` binary, or null when absent
 */
export async function findStartCommandBinary() {
  try {
    const $ = await getCommandStreamDollar();
    const result = await $({ mirror: false })`which $`;
    const resolved = result.stdout?.toString().trim() || '';
    return resolved || null;
  } catch {
    return null;
  }
}

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
