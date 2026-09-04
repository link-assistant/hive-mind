/**
 * Inventory of the multi-version toolchain roots on the host (issue #2187).
 *
 * The reported image carried two Rust toolchains — a pinned `1.96.0` and a
 * `stable` that had been cached at an *older* release — plus a superseded
 * Node.js under `.nvm/versions/node`. Both are pure duplication: gigabytes that
 * nothing runs, in directories no Hive Mind disk check ever looked at (`/tmp`
 * and the agent data home were the only things measured), so the disk gate
 * could only ever say "there is no space" and never "here is space you are not
 * using".
 *
 * This module answers the second question. It is *read-only by design*:
 *
 *   - nothing here deletes anything; every entry carries the command an
 *     operator would run, and the caller decides;
 *   - a Rust *channel* (`stable`, `beta`, `nightly`) is never reported as
 *     removable even when it is behind a pinned toolchain, because `cargo
 *     +stable`, `rustup run stable` and a bare `cargo` on a `rustup default
 *     stable` host all resolve through it. The recommendation is
 *     `rustup update stable` — make it genuinely current, rather than delete it
 *     and break the resolution;
 *   - the classification reads the filesystem only (rustup's own channel
 *     manifest, nvm's alias file, pyenv's `version` file, SDKMAN's `current`
 *     symlink). Nothing is executed, so it is safe to call from a disk-space
 *     diagnostic and it works inside a container whose toolchains are not on
 *     PATH.
 *
 * The upstream duplication is tracked in link-foundation/box#112; this module
 * is what makes it visible on hosts that already have it.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2187
 */

import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { formatBytes } from './cleanup.lib.mjs';
import { measureDiskUsageBytes } from './disk-usage.lib.mjs';

const execFileAsync = promisify(execFile);

/**
 * Upper bound on directory entries visited while sizing toolchains. A rustup
 * toolchain is ~1.4 GB across tens of thousands of files, and this runs inside a
 * logging path, so the walk is capped and the result reported as a lower bound.
 */
export const TOOLCHAIN_USAGE_ENTRY_LIMIT = 60_000;

/** `stable`, `beta`, `nightly`, optionally dated and/or host-triple suffixed. */
const RUST_CHANNEL_RE = /^(stable|beta|nightly)(-\d{4}-\d{2}-\d{2})?(-.+)?$/;

/**
 * Compare two version-ish strings the way `sort -V` does: numeric runs compare
 * numerically, so `v22.23.2` beats `v9.11.2` and `21-tem` beats `17-tem`.
 * Lexicographic comparison gets both backwards.
 *
 * @returns {number} negative when `a` is older, positive when `a` is newer
 */
export const compareToolchainVersions = (a, b) => {
  const chunks = value =>
    String(value ?? '')
      .replace(/^v/i, '')
      .split(/([0-9]+)/)
      .filter(part => part !== '');
  const left = chunks(a);
  const right = chunks(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumeric = /^[0-9]+$/.test(leftPart);
    const rightNumeric = /^[0-9]+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const difference = Number(leftPart) - Number(rightPart);
      if (difference !== 0) return difference < 0 ? -1 : 1;
      continue;
    }
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
  }
  return 0;
};

/**
 * The release a rustup toolchain actually holds, read from the channel manifest
 * rustup writes next to it (`lib/rustlib/multirust-channel-manifest.toml`).
 *
 * The `[pkg.rust]` section is the one that carries the `1.96.0` release number;
 * `[pkg.cargo]` right above it carries cargo's own `0.97.0`, which is why this
 * anchors on the section instead of taking the first `version =` in the file.
 *
 * @param {string} manifest
 * @returns {string|null}
 */
export const parseRustToolchainVersion = manifest => {
  const match = String(manifest ?? '').match(/^\[pkg\.rust\]\s*\r?\n(?:[^[]*?\r?\n)??\s*version\s*=\s*"([^"\s]+)/m);
  return match ? match[1] : null;
};

const readOptionalFile = async (fileSystem, filePath) => {
  try {
    return String(await fileSystem.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
};

/** Immediate children of `directory`, split into real directories and symlinks. */
const listChildren = async (fileSystem, directory) => {
  let names;
  try {
    names = await fileSystem.readdir(directory);
  } catch {
    return [];
  }
  const statPath = fileSystem.lstat ? fileSystem.lstat.bind(fileSystem) : fileSystem.stat.bind(fileSystem);
  const children = [];
  for (const entry of names) {
    const name = typeof entry === 'string' ? entry : entry?.name;
    if (!name || name.startsWith('.')) continue;
    const childPath = path.join(directory, name);
    let stats;
    try {
      stats = await statPath(childPath);
    } catch {
      continue;
    }
    const symlink = typeof stats.isSymbolicLink === 'function' && stats.isSymbolicLink();
    if (!symlink && !stats.isDirectory()) continue;
    children.push({ name, path: childPath, symlink });
  }
  return children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
};

/**
 * Disk occupied by one toolchain directory.
 *
 * @returns {Promise<{bytes: number, truncated: boolean}>}
 */
export const measureToolchainBytes = async (targetPath, options = {}) => measureDiskUsageBytes(targetPath, { entryLimit: TOOLCHAIN_USAGE_ENTRY_LIMIT, ...options });

const makeEntry = ({ kind, root, child, version, candidate = null }) => ({
  kind,
  root,
  name: child.name,
  path: child.path,
  version,
  candidate,
  status: 'active',
  reason: 'newest',
  supersededBy: null,
  bytes: 0,
  command: null,
});

const newestOf = entries => entries.reduce((newest, entry) => (newest === null || compareToolchainVersions(entry.version, newest.version) > 0 ? entry : newest), null);

/** Rust: channels are updated, pinned duplicates are what can be removed. */
const inventoryRust = async ({ rustupHome, fileSystem, warnings }) => {
  const root = path.join(rustupHome, 'toolchains');
  const children = (await listChildren(fileSystem, root)).filter(child => !child.symlink);
  if (children.length === 0) return [];
  const settings = (await readOptionalFile(fileSystem, path.join(rustupHome, 'settings.toml'))) || '';
  const defaultToolchain = settings.match(/^\s*default_toolchain\s*=\s*"([^"]+)"/m)?.[1] || null;
  const entries = [];
  for (const child of children) {
    const manifest = await readOptionalFile(fileSystem, path.join(child.path, 'lib', 'rustlib', 'multirust-channel-manifest.toml'));
    const version = parseRustToolchainVersion(manifest) || (/^[0-9]/.test(child.name) ? child.name.split('-')[0] : null);
    entries.push(makeEntry({ kind: 'rust', root, child, version }));
  }
  const newest = newestOf(entries.filter(entry => entry.version));
  for (const entry of entries) {
    const channel = entry.name.match(RUST_CHANNEL_RE);
    const behind = newest && entry.version && compareToolchainVersions(entry.version, newest.version) < 0;
    if (channel && behind) {
      // Never propose deleting a channel: `cargo +stable`, `rustup run stable`
      // and a bare `cargo` on a `rustup default stable` host all resolve
      // through it. Making it current removes the duplication instead.
      const channelName = `${channel[1]}${channel[2] || ''}`;
      entry.status = 'stale';
      entry.reason = 'channel_behind_pinned';
      entry.supersededBy = newest.name;
      entry.command = `rustup update ${channelName}`;
      warnings.push({
        kind: 'rust',
        message: `rustup channel ${channelName} is ${entry.version}, older than the installed ${newest.version} — run \`rustup update ${channelName}\` so one toolchain serves both`,
      });
      continue;
    }
    if (defaultToolchain && entry.name === defaultToolchain) {
      entry.reason = 'default';
      continue;
    }
    if (newest && entry.name === newest.name) {
      entry.reason = 'newest';
      continue;
    }
    if (channel) {
      entry.reason = 'channel';
      continue;
    }
    entry.status = 'superseded';
    entry.reason = 'superseded_by_newer';
    entry.supersededBy = newest?.name || null;
    entry.command = `rustup toolchain uninstall ${entry.name}`;
  }
  return entries;
};

/** Node.js: nvm's `default` alias decides what every login shell runs. */
const inventoryNode = async ({ nvmDir, fileSystem, warnings }) => {
  const root = path.join(nvmDir, 'versions', 'node');
  const children = (await listChildren(fileSystem, root)).filter(child => !child.symlink);
  if (children.length === 0) return [];
  const entries = children.map(child => makeEntry({ kind: 'node', root, child, version: child.name.replace(/^v/, '') }));
  const newest = newestOf(entries);
  const alias = ((await readOptionalFile(fileSystem, path.join(nvmDir, 'alias', 'default'))) || '').trim();
  // The alias may be an exact version (`24.20.0`), a `v`-prefixed one, or a
  // partial version (`20`), which nvm resolves to the newest match.
  const aliasMatches = alias ? entries.filter(entry => entry.version === alias.replace(/^v/, '') || entry.version.startsWith(`${alias.replace(/^v/, '')}.`)) : [];
  const defaultEntry = newestOf(aliasMatches);
  for (const entry of entries) {
    if (newest && entry.name === newest.name) {
      entry.reason = 'newest';
      continue;
    }
    entry.status = 'superseded';
    entry.supersededBy = newest?.name || null;
    if (defaultEntry && entry.name === defaultEntry.name) {
      // Removing the version the default alias resolves to would leave every
      // login shell without a node, so the only honest recommendation is the
      // pair: repoint the alias first, then remove. That is exactly what the
      // hive-mind image layer does at build time (issue #2187 item C).
      entry.reason = 'default_behind_newest';
      entry.command = `nvm alias default ${newest.name} && nvm uninstall ${entry.name}`;
      continue;
    }
    entry.reason = 'superseded_by_newer';
    entry.command = `nvm uninstall ${entry.name}`;
  }
  if (defaultEntry && newest && defaultEntry.name !== newest.name) {
    // This is issue #2187 item C seen from the host: the image's default node
    // is older than an installed one, so every task that needs the newer
    // runtime downloads it again into /tmp.
    warnings.push({
      kind: 'node',
      message: `nvm default alias resolves to ${defaultEntry.name} while ${newest.name} is installed — tasks needing the newer runtime download it again on every run`,
    });
  }
  return entries;
};

/** Python: pyenv's `version` file is the global selection. */
const inventoryPython = async ({ pyenvRoot, fileSystem }) => {
  const root = path.join(pyenvRoot, 'versions');
  const children = (await listChildren(fileSystem, root)).filter(child => !child.symlink);
  if (children.length === 0) return [];
  const entries = children.map(child => makeEntry({ kind: 'python', root, child, version: child.name }));
  const newest = newestOf(entries);
  const globalVersions = new Set(
    ((await readOptionalFile(fileSystem, path.join(pyenvRoot, 'version'))) || '')
      .split(/\s+/)
      .map(value => value.trim())
      .filter(Boolean)
  );
  for (const entry of entries) {
    if (newest && entry.name === newest.name) {
      entry.reason = 'newest';
      continue;
    }
    if (globalVersions.has(entry.name)) {
      entry.reason = 'global';
      continue;
    }
    entry.status = 'superseded';
    entry.reason = 'superseded_by_newer';
    entry.supersededBy = newest?.name || null;
    entry.command = `pyenv uninstall -f ${entry.name}`;
  }
  return entries;
};

/** SDKMAN: each candidate has its own `current` symlink. */
const inventorySdkman = async ({ sdkmanDir, fileSystem }) => {
  const candidatesRoot = path.join(sdkmanDir, 'candidates');
  const candidates = (await listChildren(fileSystem, candidatesRoot)).filter(child => !child.symlink);
  const entries = [];
  for (const candidate of candidates) {
    const children = await listChildren(fileSystem, candidate.path);
    const versions = children.filter(child => !child.symlink && child.name !== 'current');
    if (versions.length === 0) continue;
    let currentName;
    try {
      currentName = path.basename(String(await fileSystem.readlink(path.join(candidate.path, 'current'))));
    } catch {
      // No `current` symlink for this candidate — nothing is selected.
      currentName = null;
    }
    const candidateEntries = versions.map(child => makeEntry({ kind: 'sdkman', root: candidate.path, child, version: child.name, candidate: candidate.name }));
    const newest = newestOf(candidateEntries);
    for (const entry of candidateEntries) {
      if (currentName && entry.name === currentName) {
        entry.reason = 'current';
        continue;
      }
      if (newest && entry.name === newest.name) {
        entry.reason = 'newest';
        continue;
      }
      entry.status = 'superseded';
      entry.reason = 'superseded_by_newer';
      entry.supersededBy = currentName || newest?.name || null;
      entry.command = `sdk uninstall ${candidate.name} ${entry.name}`;
    }
    entries.push(...candidateEntries);
  }
  return entries;
};

/**
 * Classify every installed toolchain version under the multi-version roots.
 *
 * @param {Object} [options]
 * @param {string} [options.homeDir] - home directory to scan (defaults to `os.homedir()`)
 * @param {Object} [options.env] - environment read for `NVM_DIR`/`RUSTUP_HOME`/`PYENV_ROOT`/`SDKMAN_DIR`; defaults to `process.env` only when `homeDir` is not given
 * @param {boolean} [options.measure=true] - measure the bytes each version occupies
 * @returns {Promise<{entries: Array, warnings: Array, supersededBytes: number, supersededCount: number, staleBytes: number, truncated: boolean}>}
 */
export const collectToolchainInventory = async ({ homeDir = null, env = null, fileSystem = fsPromises, exec = execFileAsync, measure = true, entryLimit = TOOLCHAIN_USAGE_ENTRY_LIMIT } = {}) => {
  const home = homeDir || os.homedir();
  // `NVM_DIR`, `RUSTUP_HOME`, `PYENV_ROOT` and `SDKMAN_DIR` describe the roots of
  // the *running* environment. They are honoured when scanning that environment
  // and deliberately ignored when the caller names a different home, so an
  // explicit `homeDir` scans exactly that tree (and a test fixture is not
  // silently redirected at the host's real toolchains).
  const environment = env || (homeDir ? {} : process.env);
  const resolveRoot = (variable, fallback) => {
    const configured = String(environment?.[variable] || '').trim();
    return configured || path.join(home, fallback);
  };
  const warnings = [];
  const entries = [...(await inventoryRust({ rustupHome: resolveRoot('RUSTUP_HOME', '.rustup'), fileSystem, warnings })), ...(await inventoryNode({ nvmDir: resolveRoot('NVM_DIR', '.nvm'), fileSystem, warnings })), ...(await inventoryPython({ pyenvRoot: resolveRoot('PYENV_ROOT', '.pyenv'), fileSystem })), ...(await inventorySdkman({ sdkmanDir: resolveRoot('SDKMAN_DIR', '.sdkman'), fileSystem }))];
  let truncated = false;
  if (measure) {
    for (const entry of entries) {
      const measured = await measureToolchainBytes(entry.path, { exec, fileSystem, entryLimit });
      entry.bytes = measured.bytes;
      truncated = truncated || measured.truncated;
    }
  }
  const sumBytes = status => entries.filter(entry => entry.status === status).reduce((sum, entry) => sum + entry.bytes, 0);
  return {
    entries,
    warnings,
    supersededCount: entries.filter(entry => entry.status === 'superseded').length,
    supersededBytes: sumBytes('superseded'),
    staleBytes: sumBytes('stale'),
    truncated,
  };
};

/** Human-readable form of the reasons produced by {@link collectToolchainInventory}. */
export const describeToolchainReason = reason =>
  ({
    newest: 'newest installed version',
    default: 'selected as the default',
    global: 'selected as the global version',
    current: 'selected by the `current` symlink',
    channel: 'resolvable channel',
    channel_behind_pinned: 'channel is behind a pinned toolchain',
    superseded_by_newer: 'superseded by a newer installed version',
    default_behind_newest: 'the default selection is older than an installed version',
  })[reason] || reason;

/**
 * Report lines for the disk diagnostics. Empty when every toolchain root holds
 * exactly one current version — the state issue #2187 asks the image to reach.
 *
 * @param {object} inventory result of {@link collectToolchainInventory}
 * @returns {Array<string>}
 */
export const formatToolchainInventoryLines = inventory => {
  const actionable = (inventory?.entries || []).filter(entry => entry.status !== 'active');
  if (actionable.length === 0) return [];
  const lines = [`   🧰 Superseded toolchains: ${formatBytes(inventory.supersededBytes)} removable, ${formatBytes(inventory.staleBytes)} stale (removal is never automatic)`];
  for (const entry of actionable) {
    const supersededBy = entry.supersededBy ? `, ${entry.status === 'stale' ? 'behind' : 'superseded by'} ${entry.supersededBy}` : '';
    lines.push(`      ${entry.kind} ${entry.name} — ${formatBytes(entry.bytes)}${supersededBy}: ${entry.command}`);
  }
  for (const warning of inventory.warnings || []) lines.push(`      ⚠️  ${warning.message}`);
  return lines;
};

export default {
  collectToolchainInventory,
  measureToolchainBytes,
  compareToolchainVersions,
  describeToolchainReason,
  formatToolchainInventoryLines,
  parseRustToolchainVersion,
  TOOLCHAIN_USAGE_ENTRY_LIMIT,
};
