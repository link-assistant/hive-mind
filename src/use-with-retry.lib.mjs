#!/usr/bin/env node

/**
 * Retry wrapper for `use-m` package loading.
 *
 * Issue #1710: Hosted CI runners occasionally hand back a truncated or
 * partially-installed global package after `npm install -g <pkg>`. Three
 * surface symptoms have been observed:
 *
 *   1. `import` throws a SyntaxError ("Unexpected end of input") wrapped
 *      in use-m's `Failed to import module from '<path>'.` — the file on
 *      disk is cut off mid-line.
 *   2. use-m throws `Failed to resolve the path to '<pkg>' from '<dir>'`
 *      — the install completed without error but the package tree is
 *      missing files that the `main`/`exports` entry depends on.
 *   3. Node throws `Invalid package config <dir>/package.json.` with
 *      `code: 'ERR_INVALID_PACKAGE_CONFIG'` — the package.json itself
 *      is corrupt/truncated and cannot even be parsed (issue #1712).
 *
 * The recovery is identical for all three: delete the broken alias install
 * directory and ask use-m to re-fetch. A clean reinstall almost always
 * succeeds. This helper centralises that retry so every call site picks
 * it up.
 */

/**
 * @param {(specifier: string) => Promise<unknown>} use - the use-m loader.
 * @param {string} specifier - the npm specifier to load (e.g. `'getenv'`).
 * @param {object} [options]
 * @param {number} [options.attempts=3] - total attempts including the first try.
 * @param {(path: string) => Promise<void>} [options.cleanup] - injectable cleanup
 *   for the corrupted install directory (defaults to recursive `rm`).
 * @returns {Promise<unknown>} the module returned by use-m.
 */
export const useWithRetry = async (use, specifier, options = {}) => {
  const attempts = options.attempts ?? 3;
  const cleanup = options.cleanup ?? defaultCleanup;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await use(specifier);
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isCorruptInstallError(error)) {
        throw error;
      }
      const corruptedPath = extractCorruptedFilePath(error);
      if (corruptedPath) {
        try {
          // Two failure modes:
          //   * "Failed to import module from '<file>'" — corruptedPath is a file
          //     inside the use-m alias dir (e.g. /.../getenv-v-latest/index.js).
          //   * "Failed to resolve the path to 'pkg' from '<dir>'" — corruptedPath
          //     is the alias dir itself (e.g. /.../links-notation-v-latest).
          // For files, walk up to the alias dir; otherwise remove the dir as-is.
          const { dirname } = await import('node:path');
          const target = corruptedPath.endsWith('-v-latest') || /-v-\d/.test(corruptedPath) ? corruptedPath : dirname(corruptedPath);
          await cleanup(target);
        } catch {
          // Best-effort cleanup; fall through to retry regardless.
        }
      }
    }
  }
  // Unreachable — the loop either returns or throws.
  throw lastError;
};

export const isCorruptInstallError = error => {
  const cause = error?.cause;
  if (cause instanceof SyntaxError) return true;
  const causeMessage = typeof cause?.message === 'string' ? cause.message : '';
  if (/Unexpected end of input|Unexpected token/.test(causeMessage)) return true;
  // Mode 3 (issue #1712): package.json itself is corrupt — Node refuses to
  // even parse it and throws ERR_INVALID_PACKAGE_CONFIG before use-m's own
  // resolve/import logic gets a chance to run.
  if (error?.code === 'ERR_INVALID_PACKAGE_CONFIG') return true;
  if (cause?.code === 'ERR_INVALID_PACKAGE_CONFIG') return true;
  // Mode 2 (also seen on hosted CI): npm install completes but the package
  // tree is incomplete, so use-m can't resolve the entry point.
  const message = typeof error?.message === 'string' ? error.message : '';
  if (/^Failed to resolve the path to /.test(message)) return true;
  // Fallback string match for ERR_INVALID_PACKAGE_CONFIG (in case the error
  // bubbles through use-m without preserving the `code` property).
  return /^Invalid package config /.test(message);
};

export const extractCorruptedFilePath = error => {
  const message = typeof error?.message === 'string' ? error.message : '';
  const importMatch = message.match(/Failed to import module from '([^']+)'/);
  if (importMatch) return importMatch[1];
  // For "Failed to resolve the path to 'pkg' from '<dir>'" the second path
  // is already the alias install directory — return it directly so callers
  // can clean it up (cleanup() handles both files and directories).
  const resolveMatch = message.match(/Failed to resolve the path to '[^']+' from '([^']+)'/);
  if (resolveMatch) return resolveMatch[1];
  // Mode 3 (issue #1712): "Invalid package config <dir>/package.json." —
  // extract the package.json path so the caller's cleanup() walks up to
  // the alias dir.
  const invalidConfigMatch = message.match(/Invalid package config (\S+?package\.json)/);
  return invalidConfigMatch ? invalidConfigMatch[1] : null;
};

const defaultCleanup = async path => {
  const { rm } = await import('node:fs/promises');
  await rm(path, { recursive: true, force: true });
};
