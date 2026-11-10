/**
 * Default shared Claude credential authority (issue #3785, 2026-11-01 review).
 *
 * Native Claude 2.1.316 serializes OAuth refresh with two locks that live next
 * to the credential file, not inside it:
 *
 *   - `<credentialDir>/.oauth_refresh.lock` (proper-lockfile, 60 s stale), and
 *   - the legacy `${realpath(credentialDir)}.lock` sibling directory.
 *
 * It also opens `.credentials.json` with `O_NOFOLLOW`, so a symlink cannot
 * redirect it. A file-only bind of `~/.claude/.credentials.json` therefore
 * shares the token bytes but not the refresh locks: two containers refresh
 * the same single-use refresh token concurrently, one wins, the other gets
 * `invalid_grant`, clears the tokens on disk and every peer is logged out.
 *
 * The default authority moves the credential file into a dedicated directory
 * inside the already host-backed configuration home
 * (`<config>/.hive-mind-auth/claude`) and selects it with Claude's own
 * `CLAUDE_SECURESTORAGE_CONFIG_DIR`. Docker tasks receive the *parent*
 * (`<config>/.hive-mind-auth`), so the credential file, the in-directory lock
 * and the legacy sibling lock are the same host objects in the root container
 * and in every task. Configuration, plugins and capabilities stay private.
 *
 * `HIVE_MIND_CLAUDE_AUTH_AUTHORITY=conventional` is the explicit opt-out: the
 * legacy file-only projection is kept and does not share refresh locks.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { resolveClaudeConfigDirectory } from './claude-paths.lib.mjs';

export const CLAUDE_AUTH_AUTHORITY_MODE = 'HIVE_MIND_CLAUDE_AUTH_AUTHORITY';
export const CLAUDE_AUTHORITY_PARENT_NAME = '.hive-mind-auth';
export const CLAUDE_AUTHORITY_NAME = 'claude';
export const CLAUDE_SUPERSEDED_NAME = '.hive-mind-auth-superseded';
const CREDENTIALS = '.credentials.json';
const REFRESH_LOCK = '.oauth_refresh.lock';
// Same staleness proper-lockfile uses inside the native CLI.
const LOCK_STALE_MS = 60_000;
const SELECTOR = 'CLAUDE_SECURESTORAGE_CONFIG_DIR';

export class ClaudeAuthAuthorityError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ClaudeAuthAuthorityError';
    this.code = code;
  }
}

const modeOf = env => {
  const value = env[CLAUDE_AUTH_AUTHORITY_MODE];
  if (value === undefined || value === '' || value === 'shared') return 'shared';
  if (value === 'conventional') return 'conventional';
  throw new ClaudeAuthAuthorityError(`${CLAUDE_AUTH_AUTHORITY_MODE} must be "shared" or "conventional".`, 'invalid-mode');
};

export const claudeAuthorityOptedOut = (env = process.env) => modeOf(env) === 'conventional';

/** `<config>/.hive-mind-auth` — the directory Docker tasks receive. */
export const defaultClaudeAuthorityParent = (env = process.env, homeDir = os.homedir()) => path.join(resolveClaudeConfigDirectory(env, homeDir), CLAUDE_AUTHORITY_PARENT_NAME);
/** `<config>/.hive-mind-auth/claude` — the selected native credential directory. */
export const defaultClaudeAuthorityHome = (env = process.env, homeDir = os.homedir()) => path.join(defaultClaudeAuthorityParent(env, homeDir), CLAUDE_AUTHORITY_NAME);
/** The reserved nested authority is the only credential root allowed inside a configuration home. */
export const isReservedClaudeAuthority = (root, configurationHome) => typeof root === 'string' && typeof configurationHome === 'string' && root === path.join(configurationHome, CLAUDE_AUTHORITY_PARENT_NAME, CLAUDE_AUTHORITY_NAME);

const statOrNull = async (target, io) => {
  try {
    return await io.lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

const ownedPrivateDirectory = async (target, io, { create, tighten = true }) => {
  let info = await statOrNull(target, io);
  if (!info && create) {
    await io.mkdir(target, { mode: 0o700 }).catch(error => {
      if (error.code !== 'EEXIST') throw error;
    });
    info = await statOrNull(target, io);
  }
  if (!info) return false;
  if (!info.isDirectory() || info.isSymbolicLink() || (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new ClaudeAuthAuthorityError(`Claude credential authority directory ${target} is not a private directory owned by this user.`, 'unsafe-directory');
  if (tighten && (info.mode & 0o077) !== 0) await io.chmod(target, 0o700);
  return true;
};

const credentialFile = async (target, io) => {
  const info = await statOrNull(target, io);
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink()) throw new ClaudeAuthAuthorityError(`Claude credential file ${target} is not a regular file.`, 'unsafe-file');
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new ClaudeAuthAuthorityError(`Claude credential file ${target} is not owned by this user.`, 'unsafe-file');
  const raw = await io.readFile(target);
  let parsed;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    parsed = null;
  }
  const oauth = parsed?.claudeAiOauth;
  return { path: target, info, raw, parsed, usable: Boolean(oauth && typeof oauth === 'object' && (typeof oauth.refreshToken === 'string' ? oauth.refreshToken : oauth.accessToken)) };
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** mkdir-based lock compatible with the native CLI's proper-lockfile refresh lock. */
async function acquireRefreshLock(directory, io, { attempts, delayMs, now }) {
  const lock = path.join(directory, REFRESH_LOCK);
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await io.mkdir(lock, { mode: 0o700 });
      return async () => {
        await io.rm(lock, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const held = await statOrNull(lock, io);
      if (held && now() - held.mtimeMs > LOCK_STALE_MS) {
        await io.rm(lock, { recursive: true, force: true });
        continue;
      }
      if (attempt + 1 < attempts) await sleep(delayMs);
    }
  }
  throw new ClaudeAuthAuthorityError(`Claude OAuth refresh is in progress (${lock}); retry when it finishes.`, 'refresh-busy');
}

async function supersede(file, configurationHome, label, io, now) {
  const directory = path.join(configurationHome, CLAUDE_SUPERSEDED_NAME);
  await ownedPrivateDirectory(directory, io, { create: true });
  const target = path.join(directory, `claude-${label}-${new Date(now()).toISOString().replace(/[:.]/gu, '-')}.json`);
  await io.rename(file.path, target);
  return target;
}

const rename = async (io, source, target) => {
  try {
    await io.rename(source, target);
  } catch (error) {
    if (error.code === 'EXDEV') throw new ClaudeAuthAuthorityError('Claude credentials cannot move into the shared authority across filesystems; keep the credential directory and the configuration home on one host-backed volume.', 'cross-device');
    throw error;
  }
};

/**
 * Reconcile the conventional credential file with the default authority.
 * Runs under both native refresh locks so no refresh observes a half-move.
 * Returns which action was taken; never picks an obsolete copy silently.
 */
async function reconcile({ configurationHome, home, io, now, lockAttempts, lockDelayMs }) {
  const legacyPath = path.join(configurationHome, CREDENTIALS);
  const canonicalPath = path.join(home, CREDENTIALS);
  const parent = path.dirname(home);
  await ownedPrivateDirectory(parent, io, { create: true });
  await ownedPrivateDirectory(home, io, { create: true });
  const releaseLegacy = await acquireRefreshLock(configurationHome, io, { attempts: lockAttempts, delayMs: lockDelayMs, now });
  try {
    const releaseCanonical = await acquireRefreshLock(home, io, { attempts: lockAttempts, delayMs: lockDelayMs, now });
    try {
      const legacy = await credentialFile(legacyPath, io);
      const canonical = await credentialFile(canonicalPath, io);
      if (!legacy) return { action: canonical ? 'kept' : 'empty' };
      if ((legacy.info.mode & 0o077) !== 0) await io.chmod(legacyPath, 0o600);
      if (!canonical) {
        await rename(io, legacyPath, canonicalPath);
        return { action: 'migrated' };
      }
      if (legacy.raw.equals(canonical.raw) || (legacy.parsed && isDeepStrictEqual(legacy.parsed, canonical.parsed))) {
        await io.unlink(legacyPath);
        return { action: 'deduplicated' };
      }
      if (!legacy.usable) return { action: 'kept', superseded: await supersede(legacy, configurationHome, 'conventional', io, now) };
      if (!canonical.usable || legacy.info.mtimeMs > canonical.info.mtimeMs) {
        // A newer login written to the conventional path (e.g. `claude /login`
        // in the root shell without the selector) replaces the older authority.
        const superseded = await supersede(canonical, configurationHome, 'authority', io, now);
        await rename(io, legacyPath, canonicalPath);
        return { action: 'adopted-newer-login', superseded };
      }
      throw new ClaudeAuthAuthorityError(`Conflicting Claude credentials: ${legacyPath} differs from the newer shared authority ${canonicalPath}. Move the obsolete file away (or log in again) so only one authority remains.`, 'conflict');
    } finally {
      await releaseCanonical();
    }
  } finally {
    await releaseLegacy();
  }
}

/**
 * Select the shared Claude authority for this process and its children.
 *
 * - `establish: true` (Docker task preparation) migrates a conventional
 *   credential file into the authority;
 * - `establish: false` (direct runs, /limits) only adopts an authority that
 *   already exists, after reconciling a newer conventional login into it.
 *
 * The selector is written to `env` (and to `process.env` when `env` is it).
 * Custom selectors and the `conventional` opt-out are left untouched.
 */
export async function ensureClaudeAuthAuthority({ env = process.env, homeDir = os.homedir(), establish = false, io = fs, now = Date.now, lockAttempts = 20, lockDelayMs = 250, verbose = false } = {}) {
  if (modeOf(env) === 'conventional') return { mode: 'conventional', reason: 'opt-out' };
  if (env.HIVE_MIND_CLAUDE_AUTH_IDENTITY !== undefined) return { mode: 'admitted' };
  const configurationHome = resolveClaudeConfigDirectory(env, homeDir);
  const home = defaultClaudeAuthorityHome(env, homeDir);
  if (env[SELECTOR] !== undefined && env[SELECTOR] !== home) return { mode: 'custom' };
  if (!path.isAbsolute(configurationHome) || path.normalize(configurationHome) !== configurationHome) throw new ClaudeAuthAuthorityError('Claude configuration home must be an absolute normalized path for the shared authority.', 'unsafe-directory');
  const existing = await credentialFile(path.join(home, CREDENTIALS), io);
  const legacy = await statOrNull(path.join(configurationHome, CREDENTIALS), io);
  if (!existing && !legacy) {
    if (env[SELECTOR] === home) return { mode: 'shared', home, action: 'empty' };
    return { mode: 'conventional', reason: 'no-credentials' };
  }
  if (!existing && !establish && env[SELECTOR] !== home) return { mode: 'conventional', reason: 'not-established' };
  // Only a recognizable native OAuth record is moved; anything else stays where
  // the operator put it and keeps the conventional projection.
  if (!existing && !(await credentialFile(path.join(configurationHome, CREDENTIALS), io))?.parsed?.claudeAiOauth) return { mode: 'conventional', reason: 'unrecognized-credentials' };
  if (!(await ownedPrivateDirectory(configurationHome, io, { create: false, tighten: false }))) return { mode: 'conventional', reason: 'no-configuration-home' };
  const result = legacy ? await reconcile({ configurationHome, home, io, now, lockAttempts, lockDelayMs }) : { action: 'kept' };
  env[SELECTOR] = home;
  if (verbose) console.log(`[VERBOSE] claude-auth-authority: ${result.action}${result.superseded ? ' (superseded copy preserved privately)' : ''}`);
  return { mode: 'shared', home, ...result };
}

/** Credential directory /limits should read, following an adopted authority. */
export async function resolveClaudeAuthorityCredentialsPath({ env = process.env, homeDir = os.homedir(), io = fs } = {}) {
  try {
    await ensureClaudeAuthAuthority({ env, homeDir, establish: false, io, lockAttempts: 1 });
  } catch {
    // /limits reports the auth state it can read; conflicts surface at launch.
  }
  if (env[SELECTOR] !== undefined) return path.join((env[SELECTOR] || path.join(homeDir, '.claude')).normalize('NFC'), CREDENTIALS);
  const configurationHome = resolveClaudeConfigDirectory(env, homeDir);
  // A reconcile that could not run now (busy lock, conflict) still reads the
  // established authority rather than an obsolete conventional copy.
  const authority = path.join(defaultClaudeAuthorityHome(env, homeDir), CREDENTIALS);
  let shared;
  try {
    shared = !claudeAuthorityOptedOut(env);
  } catch {
    shared = false;
  }
  if (shared && (await statOrNull(authority, io).catch(() => null))) return authority;
  return path.join(configurationHome, CREDENTIALS);
}
