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
