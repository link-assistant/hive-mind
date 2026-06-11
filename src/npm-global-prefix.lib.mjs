#!/usr/bin/env node

/**
 * Ensure npm's global install directory is writable before `use-m` runs.
 *
 * Issue #1897: `use-m` loads runtime dependencies (command-stream, getenv,
 * yargs, …) by shelling out to `npm install -g <alias>@npm:<pkg>@latest`.
 * npm installs into the global prefix reported by `npm root -g`. When the
 * CLI is launched with a system-wide Node.js whose global `node_modules`
 * directory is owned by root (e.g. `/opt/node-v24.16.0-linux-x64/lib/node_modules`),
 * the install fails with `EACCES: permission denied` and the whole process
 * crashes at the very first `use()` call with an unhandled error:
 *
 *   Error: Failed to install command-stream@latest globally.
 *     ... npm error code EACCES
 *     ... npm error syscall rename
 *     ... npm error path /opt/node-.../lib/node_modules/command-stream-v-latest
 *
 * This commonly happens when the package was installed with one runtime
 * (e.g. `bun add -g`, which writes to a user-owned `~/.bun/...`) but launched
 * under a system Node whose global prefix needs root.
 *
 * The fix mirrors npm's own documented recommendation for EACCES errors:
 * point the global prefix at a user-writable directory. We detect the
 * non-writable prefix up front and redirect `npm_config_prefix` (which both
 * `npm install -g` and `npm root -g` honour) to `~/.npm-global`, so use-m's
 * install succeeds without sudo. When the prefix is already writable we do
 * nothing — the common case stays a no-op with no extra `npm` spawn.
 */

import { access, mkdir } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Derive the likely global `node_modules` path from the Node binary location
 * without spawning npm. For a standard POSIX layout the node binary lives at
 * `<prefix>/bin/node` and global packages at `<prefix>/lib/node_modules`.
 *
 * @param {string} execPath - Absolute path to the running node binary.
 * @returns {string} Candidate global `node_modules` directory.
 */
export const deriveGlobalNodeModules = execPath => join(dirname(dirname(execPath)), 'lib', 'node_modules');

/**
 * Check whether a directory is writable, walking up to the nearest existing
 * ancestor when the leaf does not yet exist (npm would create it on install).
 *
 * @param {string} startDir - Directory to test.
 * @param {(path: string, mode: number) => Promise<void>} accessFn - fs.access.
 * @returns {Promise<boolean>}
 */
export const isPathWritable = async (startDir, accessFn = access) => {
  let current = startDir;
  for (;;) {
    try {
      await accessFn(current, fsConstants.W_OK);
      return true;
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        const parent = dirname(current);
        if (parent === current) return false; // reached filesystem root
        current = parent;
        continue;
      }
      // EACCES / EPERM / anything else → treat as not writable.
      return false;
    }
  }
};

const queryNpmRoot = async runner => {
  try {
    const { stdout } = await runner('npm root -g');
    const value = String(stdout).trim();
    return value || null;
  } catch {
    return null;
  }
};

/**
 * Detect a non-writable npm global prefix and, if found, redirect global
 * installs to a user-writable directory by setting `npm_config_prefix`.
 *
 * Idempotent and dependency-injectable for tests. Returns an object describing
 * what happened: `{ changed: boolean, reason: string, prefix?, previousRoot? }`.
 *
 * @param {object} [options]
 * @param {Record<string, string>} [options.env=process.env] - Environment to mutate.
 * @param {string} [options.execPath=process.execPath] - Running node binary path.
 * @param {string} [options.platform=process.platform] - OS platform.
 * @param {string} [options.home] - User home directory.
 * @param {Function} [options.accessFn=fs.access]
 * @param {Function} [options.mkdirFn=fs.mkdir]
 * @param {Function} [options.runner=execAsync] - Runs a shell command, returns {stdout}.
 * @param {(message: string) => void} [options.log] - Informational logger.
 * @returns {Promise<{changed: boolean, reason: string, prefix?: string, previousRoot?: string, error?: Error}>}
 */
export const ensureWritableNpmGlobalPrefix = async (options = {}) => {
  const { env = process.env, execPath = process.execPath, platform = process.platform, home = homedir(), accessFn = access, mkdirFn = mkdir, runner = execAsync, log = () => {}, isBunRuntime = typeof Bun !== 'undefined', isDenoRuntime = typeof Deno !== 'undefined' } = options;

  // Windows' global layout differs (`<prefix>/node_modules`, AppData), and the
  // EACCES scenario this guards against is POSIX-specific. Skip to avoid false
  // positives that would needlessly relocate the prefix.
  if (platform === 'win32') return { changed: false, reason: 'win32' };

  // This workaround only protects use-m's Node/npm resolver. Bun and Deno use
  // different install paths and should not have npm configuration changed.
  if (isBunRuntime) return { changed: false, reason: 'bun-runtime' };
  if (isDenoRuntime) return { changed: false, reason: 'deno-runtime' };

  // Respect an explicitly configured prefix — the user (or a parent process)
  // already chose where global installs go.
  if (env.npm_config_prefix || env.NPM_CONFIG_PREFIX) return { changed: false, reason: 'preset' };

  // Fast path: derive the likely global node_modules from the node binary and
  // check writability without spawning npm. Most installs land here.
  const derived = deriveGlobalNodeModules(execPath);
  if (await isPathWritable(derived, accessFn)) {
    return { changed: false, reason: 'writable' };
  }

  // The cheap heuristic says non-writable. Confirm against the authoritative
  // path npm/use-m actually use before changing anything (handles custom prefixes).
  const authoritative = (await queryNpmRoot(runner)) || derived;
  if (await isPathWritable(authoritative, accessFn)) {
    return { changed: false, reason: 'writable' };
  }

  // Global prefix is genuinely not writable by the current user (issue #1897).
  if (!home) {
    return { changed: false, reason: 'no-home' };
  }

  const prefix = join(home, '.npm-global');
  try {
    // npm installs into `<prefix>/lib/node_modules`; create it so the very
    // first `npm install -g` does not have to.
    await mkdirFn(join(prefix, 'lib', 'node_modules'), { recursive: true });
  } catch (error) {
    return { changed: false, reason: 'mkdir-failed', error };
  }

  env.npm_config_prefix = prefix;
  // Make globally-installed binaries from the new prefix resolvable too.
  const binDir = join(prefix, 'bin');
  const pathParts = String(env.PATH || '').split(':');
  if (!pathParts.includes(binDir)) {
    env.PATH = env.PATH ? `${binDir}:${env.PATH}` : binDir;
  }

  log(`ℹ️  npm global directory (${authoritative}) is not writable; redirecting global installs to ${prefix} (issue #1897).`);
  return { changed: true, reason: 'redirected', prefix, previousRoot: authoritative };
};
