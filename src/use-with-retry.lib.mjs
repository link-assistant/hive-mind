#!/usr/bin/env node

/**
 * Retry wrapper for `use-m` package loading.
 *
 * Issue #1710: Hosted CI runners occasionally hand back a truncated/corrupt
 * global package after `npm install -g <pkg>` (the resulting `index.js` is
 * cut off mid-line). The first symptom is `import` throwing a SyntaxError
 * ("Unexpected end of input") wrapped in use-m's
 *   `Failed to import module from '<path>'.`
 * error.
 *
 * The recovery is to delete the broken install directory and ask use-m to
 * re-fetch — a clean reinstall almost always succeeds. This helper centralises
 * that retry so every call site picks it up.
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
  // Mode 2 (also seen on hosted CI): npm install completes but the package
  // tree is incomplete, so use-m can't resolve the entry point.
  const message = typeof error?.message === 'string' ? error.message : '';
  return /^Failed to resolve the path to /.test(message);
};

export const extractCorruptedFilePath = error => {
  const message = typeof error?.message === 'string' ? error.message : '';
  const importMatch = message.match(/Failed to import module from '([^']+)'/);
  if (importMatch) return importMatch[1];
  // For "Failed to resolve the path to 'pkg' from '<dir>'" the second path
  // is already the alias install directory — return it directly so callers
  // can clean it up (cleanup() handles both files and directories).
  const resolveMatch = message.match(/Failed to resolve the path to '[^']+' from '([^']+)'/);
  return resolveMatch ? resolveMatch[1] : null;
};

const defaultCleanup = async path => {
  const { rm } = await import('node:fs/promises');
  await rm(path, { recursive: true, force: true });
};
