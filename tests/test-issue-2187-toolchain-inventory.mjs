#!/usr/bin/env node

/**
 * Issue #2187, item A — one toolchain per language, always the newest.
 *
 * The reported host carried two Rust toolchains where the `stable` one was
 * *older* than the pinned one, an `.nvm/versions/node` holding a superseded
 * Node.js, and the same shape under `.pyenv/versions` and
 * `.sdkman/candidates/*`. Nothing in Hive Mind could even see that: the disk
 * checks look at `/tmp` and the home data dir, so gigabytes of superseded
 * toolchains were invisible.
 *
 * `toolchain-inventory.lib.mjs` answers "which installed toolchain versions are
 * superseded, and how much do they cost" from the filesystem alone — no
 * `rustc --version`, no `nvm ls`, nothing to execute. It never removes
 * anything: it reports, and for Rust channels it recommends
 * `rustup update stable` rather than deleting the channel other tools resolve
 * (`cargo +stable`, a bare `cargo`).
 *
 * The fixtures below are real directory trees, so the assertions fail for the
 * real reason (wrong classification) rather than for a refactor.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2187
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { assert as check, printSummary, getFailCount } from './test-helpers.mjs';
import { collectToolchainInventory, compareToolchainVersions, formatToolchainInventoryLines, parseRustToolchainVersion } from '../src/toolchain-inventory.lib.mjs';

const write = (filePath, contents) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
};

/** A rustup toolchain directory, with the channel manifest rustup itself writes. */
const makeRustToolchain = (home, name, version, bytes = 16) => {
  const root = path.join(home, '.rustup', 'toolchains', name);
  write(path.join(root, 'lib', 'rustlib', 'multirust-channel-manifest.toml'), `manifest-version = "2"\ndate = "2026-05-28"\n\n[pkg.cargo]\nversion = "0.97.0 (30a34c682 2026-05-25)"\n\n[pkg.rust]\nversion = "${version} (ac68faa20 2026-05-25)"\n`);
  write(path.join(root, 'bin', 'rustc'), 'x'.repeat(bytes));
};

const makeNodeVersion = (home, version, bytes = 16) => write(path.join(home, '.nvm', 'versions', 'node', version, 'bin', 'node'), 'x'.repeat(bytes));

const makePyenvVersion = (home, version, bytes = 16) => write(path.join(home, '.pyenv', 'versions', version, 'bin', 'python'), 'x'.repeat(bytes));

const makeSdkmanVersion = (home, candidate, version, bytes = 16) => write(path.join(home, '.sdkman', 'candidates', candidate, version, 'bin', candidate), 'x'.repeat(bytes));

/** The host shape issue #2187 reported, as a throwaway home directory. */
const makeHome = () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2187-toolchains-'));
  // Rust: a pinned 1.96.0 next to a `stable` that resolved to an older 1.90.0.
  makeRustToolchain(home, 'stable-x86_64-unknown-linux-gnu', '1.90.0');
  makeRustToolchain(home, '1.96.0-x86_64-unknown-linux-gnu', '1.96.0');
  write(path.join(home, '.rustup', 'settings.toml'), 'version = "12"\ndefault_toolchain = "stable-x86_64-unknown-linux-gnu"\nprofile = "default"\n\n[overrides]\n');
  // Node: the base image's v20 (still the nvm default) next to the v24 the
  // workloads need, plus a v18 nothing points at.
  makeNodeVersion(home, 'v18.20.8');
  makeNodeVersion(home, 'v20.20.2');
  makeNodeVersion(home, 'v24.20.0');
  write(path.join(home, '.nvm', 'alias', 'default'), '20\n');
  // Python and SDKMAN: same shape, one superseded version each.
  makePyenvVersion(home, '3.12.1');
  makePyenvVersion(home, '3.14.6');
  write(path.join(home, '.pyenv', 'version'), '3.14.6\n');
  makeSdkmanVersion(home, 'java', '17-tem');
  makeSdkmanVersion(home, 'java', '21-tem');
  fs.symlinkSync(path.join(home, '.sdkman', 'candidates', 'java', '21-tem'), path.join(home, '.sdkman', 'candidates', 'java', 'current'));
  return home;
};

const byName = (inventory, kind, name) => inventory.entries.find(entry => entry.kind === kind && entry.name === name);

const home = makeHome();
let inventory;
try {
  inventory = await collectToolchainInventory({ homeDir: home });
} finally {
  // The inventory reads only; the fixture is removed after the single scan.
}

// --- version comparison -----------------------------------------------------
check(compareToolchainVersions('v22.23.2', 'v9.11.2') > 0, 'compareToolchainVersions: v22.23.2 is newer than v9.11.2 (numeric, not text)');
check(compareToolchainVersions('1.90.0', '1.96.0') < 0, 'compareToolchainVersions: 1.90.0 is older than 1.96.0');
check(compareToolchainVersions('21-tem', '17-tem') > 0, 'compareToolchainVersions: SDKMAN 21-tem is newer than 17-tem');
check(compareToolchainVersions('3.14.6', '3.9.1') > 0, 'compareToolchainVersions: python 3.14.6 is newer than 3.9.1');

// --- rustup manifest parsing ------------------------------------------------
check(parseRustToolchainVersion('[pkg.cargo]\nversion = "0.97.0 (x)"\n\n[pkg.rust]\nversion = "1.96.0 (ac68faa20 2026-05-25)"\n') === '1.96.0', 'parseRustToolchainVersion: reads [pkg.rust], not the first version in the file');
check(parseRustToolchainVersion('manifest-version = "2"\n') === null, 'parseRustToolchainVersion: null when the manifest has no [pkg.rust]');

// --- Rust: the reported duplicate -------------------------------------------
const rustStable = byName(inventory, 'rust', 'stable-x86_64-unknown-linux-gnu');
const rustPinned = byName(inventory, 'rust', '1.96.0-x86_64-unknown-linux-gnu');
check(Boolean(rustStable && rustPinned), 'rust: both installed toolchains are inventoried');
check(rustStable?.version === '1.90.0', 'rust: stable resolves to the version in its channel manifest (1.90.0)');
check(rustPinned?.version === '1.96.0', 'rust: the pinned toolchain resolves to 1.96.0');
check(rustStable?.status === 'stale', 'rust: a channel older than a pinned toolchain is stale, never superseded');
check(rustStable?.reason === 'channel_behind_pinned', 'rust: stale stable is reported as channel_behind_pinned');
check(rustStable?.command === 'rustup update stable', 'rust: the fix for a stale channel is `rustup update stable`, not deleting it');
check(rustPinned?.status === 'active', 'rust: the newest pinned toolchain is active');

// --- Node: the base image lag behind the workload ---------------------------
const nodeOldest = byName(inventory, 'node', 'v18.20.8');
const nodeDefault = byName(inventory, 'node', 'v20.20.2');
const nodeNew = byName(inventory, 'node', 'v24.20.0');
check(nodeNew?.status === 'active' && nodeNew?.reason === 'newest', 'node: the newest installed version is active');
check(nodeOldest?.status === 'superseded', 'node: a version nothing points at is superseded');
check(nodeOldest?.command === 'nvm uninstall v18.20.8', 'node: superseded versions carry an `nvm uninstall` command');
check(nodeDefault?.status === 'superseded' && nodeDefault?.reason === 'default_behind_newest', 'node: the version the default alias points at is still superseded when a newer one is installed');
check(nodeDefault?.command === 'nvm alias default v24.20.0 && nvm uninstall v20.20.2', 'node: removing the default version is only proposed together with repointing the alias');
check(
  inventory.warnings.some(warning => warning.kind === 'node' && /default/i.test(warning.message) && warning.message.includes('v24.20.0')),
  'node: an nvm default alias that is not the newest version is reported as a warning'
);

// --- Python and SDKMAN ------------------------------------------------------
check(byName(inventory, 'python', '3.12.1')?.status === 'superseded', 'python: the older pyenv version is superseded');
check(byName(inventory, 'python', '3.14.6')?.status === 'active', 'python: the newest pyenv version is active');
check(byName(inventory, 'python', '3.12.1')?.command === 'pyenv uninstall -f 3.12.1', 'python: superseded versions carry a `pyenv uninstall` command');
check(byName(inventory, 'sdkman', '17-tem')?.status === 'superseded', 'sdkman: the older candidate version is superseded');
check(byName(inventory, 'sdkman', '21-tem')?.status === 'active', 'sdkman: the version `current` points at is active');
check(byName(inventory, 'sdkman', '17-tem')?.command === 'sdk uninstall java 17-tem', 'sdkman: superseded versions carry an `sdk uninstall` command');
check(!inventory.entries.some(entry => entry.kind === 'sdkman' && entry.name === 'current'), 'sdkman: the `current` symlink is not inventoried as a version of its own');

// --- totals -----------------------------------------------------------------
const supersededNames = inventory.entries.filter(entry => entry.status === 'superseded').map(entry => entry.name);
check(supersededNames.length === 4, `only the four superseded versions are counted (got ${supersededNames.join(', ') || 'none'})`);
check(inventory.supersededBytes > 0, 'superseded toolchains report the disk they occupy');
check(inventory.supersededBytes === inventory.entries.filter(entry => entry.status === 'superseded').reduce((sum, entry) => sum + entry.bytes, 0), 'supersededBytes is the sum of the superseded entries');
check(
  inventory.entries.every(entry => entry.status !== 'active' || entry.command === null),
  'active toolchains never carry a removal command'
);

const lines = formatToolchainInventoryLines(inventory);
check(
  lines.some(line => line.includes('rustup update stable')),
  'the formatted report recommends `rustup update stable`'
);
check(
  lines.some(line => line.includes('nvm uninstall v20.20.2')),
  'the formatted report lists the superseded node version'
);

// --- a single-toolchain host is clean ---------------------------------------
const cleanHome = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2187-toolchains-clean-'));
makeRustToolchain(cleanHome, 'stable-x86_64-unknown-linux-gnu', '1.96.0');
makeNodeVersion(cleanHome, 'v24.20.0');
write(path.join(cleanHome, '.nvm', 'alias', 'default'), '24.20.0\n');
const clean = await collectToolchainInventory({ homeDir: cleanHome });
check(
  clean.entries.every(entry => entry.status === 'active'),
  'a host with one version per language reports nothing superseded'
);
check(clean.supersededBytes === 0, 'a clean host reports 0 reclaimable toolchain bytes');
check(clean.warnings.length === 0, 'a clean host reports no warnings');
check(formatToolchainInventoryLines(clean).length === 0, 'a clean host formats to no report lines');

// --- a host without any of these roots ---------------------------------------
const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2187-toolchains-empty-'));
const empty = await collectToolchainInventory({ homeDir: emptyHome });
check(empty.entries.length === 0 && empty.supersededBytes === 0, 'a host with no toolchain roots inventories nothing (and does not throw)');

for (const dir of [home, cleanHome, emptyHome]) fs.rmSync(dir, { recursive: true, force: true });

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
