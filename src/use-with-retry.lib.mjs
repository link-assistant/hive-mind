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
 *   4. Node throws `ERR_MODULE_NOT_FOUND` for a file imported by the package
 *      entry point — npm left an incomplete package tree (issue #2113).
 *
 * The recovery is identical for all four: delete the broken alias install
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
 * @param {(ms: number) => Promise<void>} [options.sleep] - injectable backoff used
 *   between attempts when the global `npm install -g` itself failed.
 * @param {number} [options.backoffMs=1000] - base backoff, doubled per attempt.
 * @param {(message: string) => void} [options.log] - diagnostics sink; defaults to
 *   `console.error` when `HIVE_MIND_USE_M_DEBUG` is set, otherwise silent.
 * @returns {Promise<unknown>} the module returned by use-m.
 */
export const useWithRetry = async (use, specifier, options = {}) => {
  const attempts = options.attempts ?? 3;
  const cleanup = options.cleanup ?? defaultCleanup;
  const sleep = options.sleep ?? defaultSleep;
  const backoffMs = options.backoffMs ?? 1000;
  const log = options.log ?? defaultLog;
  const importModule = options.importModule ?? defaultImport;
  const extraArgs = options.args ?? [];
  let lastError;
  let cleanedImportPath = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await use(specifier, ...extraArgs);
    } catch (error) {
      lastError = error;
      // Node's ESM loader caches *failed* module evaluations by resolved URL.
      // Once `<alias>/src/$.mjs` has thrown a SyntaxError, re-importing the very
      // same path in this process replays that error even after the file on disk
      // has been replaced by a healthy reinstall (verified against use-m@8.14.2 —
      // see docs/case-studies/issue-2092). Deleting and reinstalling is therefore
      // necessary but not sufficient: the retry must import through a
      // cache-busting URL, which use-m has no way to do from the inside.
      if (cleanedImportPath && extractCorruptedFilePath(error) === cleanedImportPath) {
        try {
          const recovered = await importModule(cleanedImportPath, attempt);
          log(`use('${specifier}') recovered via a cache-busted import of ${cleanedImportPath}`);
          return recovered;
        } catch (reimportError) {
          log(`cache-busted import of ${cleanedImportPath} also failed: ${reimportError?.message}`);
        }
      }
      const retryable = isCorruptInstallError(error) || isTransientInstallError(error);
      if (attempt === attempts || !retryable) {
        log(`use('${specifier}') failed on attempt ${attempt}/${attempts} and will not be retried: ${error?.message}`);
        throw error;
      }
      log(`use('${specifier}') failed on attempt ${attempt}/${attempts}: ${error?.message} — retrying`);
      // Mode 4 (issue #2092): `npm install -g` itself failed (network blip,
      // registry 5xx, DinD DNS not up yet). There is nothing to delete; just
      // back off and let npm try again.
      if (isTransientInstallError(error)) {
        await sleep(backoffMs * 2 ** (attempt - 1));
        continue;
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
          await cleanup(resolveAliasDir(corruptedPath));
          // Remember the file so the next attempt can bypass Node's poisoned
          // module cache if use-m hands us the same path again.
          cleanedImportPath = /Failed to import module from '/.test(error?.message ?? '') ? corruptedPath : null;
        } catch {
          // Best-effort cleanup; fall through to retry regardless.
        }
      }
    }
  }
  // Unreachable — the loop either returns or throws.
  throw lastError;
};

/**
 * Mode 4 (issue #2092): use-m's own `npm install -g <pkg>` step failed, so no
 * package tree exists yet — `Failed to install command-stream@latest globally
 * into '/home/box/.nvm/.../node_modules'.` This is transient in Docker-in-Docker
 * runs where the registry (or DNS) is briefly unreachable, so retry with backoff.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export const isTransientInstallError = error => {
  const message = typeof error?.message === 'string' ? error.message : '';
  return /^Failed to install .+ globally into /.test(message);
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
  // Mode 4 (issue #2113): the installed entry point exists, but one of the
  // files it imports does not. Restrict this to use-m's import wrapper so an
  // unrelated application-level ERR_MODULE_NOT_FOUND is not retried.
  const message = typeof error?.message === 'string' ? error.message : '';
  if (/^Failed to import module from '/.test(message) && cause?.code === 'ERR_MODULE_NOT_FOUND') return true;
  // Mode 2 (also seen on hosted CI): npm install completes but the package
  // tree is incomplete, so use-m can't resolve the entry point.
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

/**
 * Walk a corrupted path up to the use-m alias install directory.
 *
 * Issue #2092: the failing file can be nested several levels deep inside the
 * package (`.../command-stream-v-latest/src/$.mjs`). Removing only its parent
 * directory (`.../src`) leaves a half-package on disk whose package.json still
 * resolves, so the retry re-imports the same broken tree. Walking up to the
 * `<pkg>-v-<version>` alias segment removes the whole install instead.
 *
 * Falls back to the immediate parent directory when no alias segment is found.
 *
 * @param {string} corruptedPath - file or directory path from the error message.
 * @returns {string} directory to delete before retrying.
 */
export const resolveAliasDir = corruptedPath => {
  const segments = corruptedPath.split('/');
  const isAlias = segment => /-v-(latest|\d[^/]*)$/.test(segment);
  for (let index = segments.length - 1; index >= 0; index--) {
    if (isAlias(segments[index])) return segments.slice(0, index + 1).join('/');
  }
  return segments.slice(0, -1).join('/') || corruptedPath;
};

const defaultCleanup = async path => {
  const { rm } = await import('node:fs/promises');
  await rm(path, { recursive: true, force: true });
};

// Cache-busting import: a query string makes Node treat the URL as a distinct
// module, so the freshly reinstalled file is evaluated instead of the cached
// SyntaxError from the corrupt one.
const defaultImport = async (filePath, attempt) => {
  const { pathToFileURL } = await import('node:url');
  return import(`${pathToFileURL(filePath).href}?use-m-retry=${attempt}`);
};

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Off by default so normal runs stay quiet; issue #2092 showed that when the
// loader dies there is no trace of which specifier or attempt failed.
const defaultLog = message => {
  if (process.env.HIVE_MIND_USE_M_DEBUG) console.error(`[use-m] ${message}`);
};

const USE_RETRY_WRAPPED = Symbol.for('hive-mind.use-with-retry.wrapped');

/**
 * Wrap a raw use-m `use` function so that *every* call site inherits the
 * corrupt-install recovery above (issue #2092).
 *
 * Before this, only the handful of call sites that explicitly imported
 * `useWithRetry` (config/queue-config/lino) were protected, while ~40 other
 * modules called `await use('command-stream')` directly and crashed with
 * `Failed to import module from '.../command-stream-v-latest/src/$.mjs'.`
 * whenever the global npm install was truncated.
 *
 * The wrapper is idempotent: wrapping an already-wrapped function returns it
 * unchanged, so repeated `ensureUseM()` calls don't nest retries.
 *
 * @param {Function} use - raw use-m loader.
 * @param {object} [options] - forwarded to useWithRetry (attempts, cleanup).
 * @returns {Function} retry-wrapped loader.
 */
export const wrapUseWithRetry = (use, options = {}) => {
  if (typeof use !== 'function' || use[USE_RETRY_WRAPPED]) return use;
  const wrapped = (specifier, ...args) => useWithRetry(use, specifier, { ...options, args });
  Object.defineProperty(wrapped, USE_RETRY_WRAPPED, { value: true });
  return wrapped;
};
