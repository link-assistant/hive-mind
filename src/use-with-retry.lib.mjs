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
 *   5. use-m's self-heal throws `Failed to remove corrupt npm alias ...`
 *      because a concurrent filesystem mutation made recursive removal fail
 *      with a retryable code such as `ENOTEMPTY` (issue #2113).
 *
 * The recovery is identical for all five: delete the broken alias install
 * directory and ask use-m to re-fetch. A clean reinstall almost always
 * succeeds. This helper centralises that retry so every call site picks
 * it up.
 */

const ALIAS_CLEANUP_ERROR = /^Failed to remove (?:corrupt|incomplete) npm alias '([^']+)'\.$/;
const RETRYABLE_RM_CODES = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM']);

// `use-m` otherwise resolves every bare specifier through npm's mutable
// `latest` tag at runtime. command-stream@0.19.0 changing its CommonJS entry
// point broke unchanged Hive Mind commits in issue #2150. Keep every runtime
// dependency reproducible; explicit versions and subpaths remain untouched.
export const USE_M_PACKAGE_VERSIONS = Object.freeze({
  '@dotenvx/dotenvx': '2.21.0',
  'command-stream': '0.18.0',
  getenv: '2.0.0',
  'links-notation': '0.13.0',
  'lino-arguments': '0.3.0',
  telegraf: '4.16.3',
  yargs: '17.7.2',
  zx: '8.8.5',
});

export const pinUseMSpecifier = specifier => {
  const version = USE_M_PACKAGE_VERSIONS[specifier];
  return version ? `${specifier}@${version}` : specifier;
};

/**
 * Undo Node 24's CommonJS namespace wrapper when `use-m` returns it verbatim.
 *
 * Node 23+ exposes `module.exports` as a synthetic named export alongside the
 * default export. use-m@8.15.0 does not classify that key as namespace
 * metadata, so a CommonJS package with no real named exports is returned as an
 * object instead of its `module.exports` value. Requiring object identity keeps
 * real ESM namespaces and unusual hybrid modules intact.
 *
 * @param {unknown} loaded
 * @param {object} [options]
 * @param {string} [options.specifier]
 * @param {(message: string) => void} [options.log]
 * @returns {unknown}
 */
export const normalizeCommonJsNamespace = (loaded, options = {}) => {
  if (loaded && typeof loaded === 'object' && Object.hasOwn(loaded, 'default') && Object.hasOwn(loaded, 'module.exports') && loaded.default === loaded['module.exports']) {
    options.log?.(`use('${options.specifier ?? 'unknown'}') normalized Node's CommonJS namespace marker`);
    return loaded.default;
  }
  return loaded;
};

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
  const requestedSpecifier = specifier;
  specifier = pinUseMSpecifier(specifier);
  const attempts = options.attempts ?? 3;
  const cleanup = options.cleanup ?? defaultCleanup;
  const sleep = options.sleep ?? defaultSleep;
  const backoffMs = options.backoffMs ?? 1000;
  const log = options.log ?? defaultLog;
  const importModule = options.importModule ?? defaultImport;
  const installWithoutBinLinks = options.installWithoutBinLinks ?? defaultInstallWithoutBinLinks;
  const extraArgs = options.args ?? [];
  if (requestedSpecifier !== specifier) log(`use('${requestedSpecifier}') pinned to '${specifier}'`);
  let lastError;
  let cleanedImportPath = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const loaded = await use(specifier, ...extraArgs);
      return normalizeCommonJsNamespace(loaded, { specifier, log });
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
          return normalizeCommonJsNamespace(recovered, { specifier, log });
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
      // npm gives every global alias the package's original executable names.
      // When a pinned alias replaces use-m's former `-v-latest` alias, packages
      // such as zx collide on `/bin/zx` even though both module directories can
      // coexist. use-m only imports the package and does not need its CLI link,
      // so finish the pinned install without bin links and retry the import.
      if (requestedSpecifier !== specifier && isBinLinkInstallConflict(error)) {
        const details = extractFailedInstallDetails(error);
        try {
          await installWithoutBinLinks({ specifier, globalRoot: details?.globalRoot, error });
          log(`use('${specifier}') repaired npm's alias bin-link collision`);
          continue;
        } catch (repairError) {
          log(`use('${specifier}') could not repair npm's alias bin-link collision: ${repairError?.message}`);
        }
      }
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
        } catch (cleanupError) {
          // Best-effort cleanup; fall through to retry regardless.
          log(`cleanup of ${resolveAliasDir(corruptedPath)} failed: ${cleanupError?.message}`);
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

export const extractFailedInstallDetails = error => {
  const message = typeof error?.message === 'string' ? error.message : '';
  const match = message.match(/^Failed to install (.+?) globally into '([^']+)'(?:\.| after\b)/);
  return match ? { specifier: match[1], globalRoot: match[2] } : null;
};

export const isBinLinkInstallConflict = error => {
  if (!extractFailedInstallDetails(error)) return false;
  // use-m may aggregate all npm attempts into the outer message instead of
  // preserving stderr on the final cause, so inspect both levels.
  const causeText = [error?.message, error?.cause?.message, error?.cause?.stderr, error?.cause?.stdout, error?.cause?.cause?.message, error?.cause?.cause?.stderr].filter(Boolean).join('\n');
  return /\bEEXIST\b/.test(causeText) && /(?:File exists|file already exists|\/bin\/|\\bin\\)/i.test(causeText);
};

const installErrorText = error => [error?.message, error?.stderr, error?.stdout, error?.cause?.message, error?.cause?.stderr, error?.cause?.stdout, error?.cause?.cause?.message, error?.cause?.cause?.stderr].filter(Boolean).join('\n');

export const extractConflictingBinPath = error => {
  const match = installErrorText(error).match(/(?:^|\n)npm error path ([^\r\n]+)/);
  return match?.[1]?.trim() ?? null;
};

export const aliasForUseMSpecifier = specifier => {
  const match = specifier.match(/^(@[^/]+\/[^@/]+|[^@/]+)@(.+)$/);
  if (!match) throw new Error(`Expected an exact npm package specifier, got '${specifier}'`);
  const [, packageName, version] = match;
  return `${packageName.replace('@', '').replace('/', '-')}-v-${version}`;
};

export const npmPrefixForGlobalRoot = globalRoot => {
  if (!globalRoot) return null;
  const normalized = globalRoot.replaceAll('\\', '/').replace(/\/$/, '');
  if (normalized.endsWith('/lib/node_modules')) return normalized.slice(0, -'/lib/node_modules'.length);
  if (normalized.endsWith('/node_modules')) return normalized.slice(0, -'/node_modules'.length);
  return null;
};

export const installAliasWithoutBinLinks = async ({ specifier, globalRoot, error, runner, readlink } = {}) => {
  const alias = aliasForUseMSpecifier(specifier);
  const prefix = npmPrefixForGlobalRoot(globalRoot);
  const binPath = extractConflictingBinPath(error);
  if (!prefix || !binPath) throw new Error('Cannot safely identify the conflicting use-m package binary');
  const { dirname, resolve, sep } = await import('node:path');
  const readSymbolicLink = readlink ?? (await import('node:fs/promises')).readlink;
  const target = resolve(dirname(binPath), await readSymbolicLink(binPath));
  const [packageName] = specifier.match(/^(@[^/]+\/[^@/]+|[^@/]+)@(.+)$/)?.slice(1) ?? [];
  const aliasPrefix = `${packageName?.replace('@', '').replace('/', '-')}-v-`;
  const normalizedRoot = resolve(globalRoot);
  if (!packageName || !target.startsWith(`${normalizedRoot}${sep}${aliasPrefix}`)) {
    throw new Error(`Refusing to replace ${binPath}; it is not owned by a use-m alias for ${packageName ?? specifier}`);
  }
  // npm 11 still checks an existing global executable even with
  // --no-bin-links. --force is safe here only because the symlink target was
  // verified above as another version alias managed by use-m for this package.
  const args = ['install', '-g', '--force', '--no-bin-links', `${alias}@npm:${specifier}`];
  if (prefix) args.push('--prefix', prefix);
  if (runner) return runner('npm', args);
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  return promisify(execFile)('npm', args);
};

const defaultInstallWithoutBinLinks = installAliasWithoutBinLinks;

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
  // Mode 5 (issue #2113): use-m@8.14.3 added its own alias self-heal, but its
  // recursive rm used Node's default maxRetries=0, so a concurrent mutation
  // escaped as ENOTEMPTY (or another rm-retry code). use-m@8.14.4 fixed this
  // upstream (use-m #68) by giving removePackageAlias its own retry budget.
  // The downstream guard is deliberately kept: the bootstrap can still land on
  // an older use-m (a pinned CDN fallback, a preinstalled global, or a cached
  // bundle), and even 8.14.4 rethrows this exact wrapper once its own budget is
  // exhausted — in which case a fresh removal plus reinstall is still the right
  // recovery.
  if (ALIAS_CLEANUP_ERROR.test(message) && RETRYABLE_RM_CODES.has(cause?.code)) return true;
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
  if (invalidConfigMatch) return invalidConfigMatch[1];
  // Mode 5 (issue #2113): use-m already reports the whole alias directory.
  const cleanupMatch = message.match(ALIAS_CLEANUP_ERROR);
  return cleanupMatch ? cleanupMatch[1] : null;
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

export const removeAliasWithRetry = async (path, options = {}) => {
  const remove = options.rm ?? (await import('node:fs/promises')).rm;
  const maxRetries = options.maxRetries ?? 5;
  const retryDelay = options.retryDelay ?? 100;
  await remove(path, { recursive: true, force: true, maxRetries, retryDelay });
};

const defaultCleanup = removeAliasWithRetry;

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
// Issue #2113: both failing runs attached to the issue were started with
// `--verbose` and still produced zero loader diagnostics, so the log showed the
// final crash without a single line about which specifier, attempt or alias was
// involved. `--verbose` now opts into the same trace as HIVE_MIND_USE_M_DEBUG.
const defaultLog = message => {
  if (process.env.HIVE_MIND_USE_M_DEBUG || process.argv.includes('--verbose')) {
    console.error(`[use-m] ${message}`);
  }
};

export const USE_RETRY_WRAPPED = Symbol.for('hive-mind.use-with-retry.wrapped');

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
