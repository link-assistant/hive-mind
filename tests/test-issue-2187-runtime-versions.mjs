#!/usr/bin/env node

/**
 * Issue #2187, items A and C — the images must ship ONE current runtime per
 * language, not a stale one plus whatever each task downloads for itself.
 *
 * The Box base installs Node.js 20 (`nvm install 20` in box's
 * ubuntu/24.04/js/install.sh), while this package declares `engines.node >= 24`,
 * so tasks were downloading their own node/bun into /tmp on every run. The
 * hive-mind layer now installs a pinned current Node.js and Bun and deletes the
 * superseded node version instead of stacking a second copy next to it.
 *
 * What is pinned here:
 *   - the pinned node satisfies package.json `engines.node`;
 *   - all three Dockerfiles pin the same versions (they are built from the same
 *     branch and must not drift);
 *   - `nvm alias default` is repointed, because ~/.bashrc sources nvm.sh and the
 *     default alias would otherwise keep activating the old runtime regardless
 *     of the PATH symlink;
 *   - the prune loop is EXTRACTED from the Dockerfile and executed against a
 *     fixture nvm root, so it is verified to leave exactly the pinned version;
 *   - scripts/verify-docker-image.sh enforces the same engines floor at image
 *     verification time.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2187
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert as check, printSummary, getFailCount } from './test-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const DOCKERFILES = ['Dockerfile', 'Dockerfile.dind', 'coolify/Dockerfile'];

const read = relativePath => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const packageJson = JSON.parse(read('package.json'));
const enginesNodeFloor = Number(String(packageJson.engines?.node || '').match(/(\d+)/)?.[1]);

check(Number.isInteger(enginesNodeFloor), `package.json declares an engines.node floor (${packageJson.engines?.node})`);

const pins = new Map();

for (const dockerfile of DOCKERFILES) {
  const source = read(dockerfile);
  const nodeVersion = source.match(/^ARG HIVE_MIND_NODE_VERSION=(\S+)$/m)?.[1];
  const bunVersion = source.match(/^ARG HIVE_MIND_BUN_VERSION=(\S+)$/m)?.[1];
  pins.set(dockerfile, { nodeVersion, bunVersion, source });

  check(/^\d+\.\d+\.\d+$/.test(nodeVersion || ''), `${dockerfile}: pins an exact Node.js version (${nodeVersion})`);
  check(/^\d+\.\d+\.\d+$/.test(bunVersion || ''), `${dockerfile}: pins an exact Bun version (${bunVersion})`);
  check(Number(String(nodeVersion).split('.')[0]) >= enginesNodeFloor, `${dockerfile}: pinned Node.js ${nodeVersion} satisfies engines.node >= ${enginesNodeFloor}`);

  // ~/.bashrc sources nvm.sh, which activates the `default` alias. Installing a
  // newer node without moving the alias leaves interactive shells (and the
  // image verification script, which sources nvm.sh too) on the old runtime.
  check(new RegExp(String.raw`nvm alias default "\$\{HIVE_MIND_NODE_VERSION\}"`).test(source), `${dockerfile}: repoints the nvm default alias at the pinned version`);

  // Bun is installed over the inherited binary rather than beside it.
  check(source.includes('bash -s "bun-v${HIVE_MIND_BUN_VERSION}"'), `${dockerfile}: installs the pinned Bun version`);
}

const [firstDockerfile, ...otherDockerfiles] = DOCKERFILES;
for (const dockerfile of otherDockerfiles) {
  check(pins.get(dockerfile).nodeVersion === pins.get(firstDockerfile).nodeVersion, `${dockerfile}: pins the same Node.js version as ${firstDockerfile}`);
  check(pins.get(dockerfile).bunVersion === pins.get(firstDockerfile).bunVersion, `${dockerfile}: pins the same Bun version as ${firstDockerfile}`);
}

/**
 * Extract the `for version_dir in ...; do ... done` prune loop and run it
 * against a throwaway nvm root, returning the versions that survived.
 */
const runPruneLoop = (source, nodeVersion, versions) => {
  const loop = source.match(/for version_dir in "\$NVM_DIR"\/versions\/node\/\*; do[\s\S]*?\n\s*done/)?.[0];
  if (!loop) return null;

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2187-prune-'));
  try {
    const nodeRoot = path.join(root, 'versions', 'node');
    for (const version of versions) fs.mkdirSync(path.join(nodeRoot, version, 'bin'), { recursive: true });
    const script = `set -e\nNVM_DIR=${JSON.stringify(root)}\nHIVE_MIND_NODE_VERSION=${JSON.stringify(nodeVersion)}\n${loop}\n`;
    execFileSync('bash', ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return fs.readdirSync(nodeRoot).sort();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

for (const dockerfile of DOCKERFILES) {
  const { source, nodeVersion } = pins.get(dockerfile);
  const survivors = runPruneLoop(source, nodeVersion, ['v20.20.2', 'v22.23.2', `v${nodeVersion}`]);
  check(survivors !== null, `${dockerfile}: has a superseded-node prune loop`);
  if (survivors === null) continue;
  check(survivors.length === 1 && survivors[0] === `v${nodeVersion}`, `${dockerfile}: prune loop keeps only v${nodeVersion} (kept: ${survivors.join(', ') || 'nothing'})`);

  // A root that already holds just the pinned version must survive untouched.
  const untouched = runPruneLoop(source, nodeVersion, [`v${nodeVersion}`]);
  check(untouched.length === 1 && untouched[0] === `v${nodeVersion}`, `${dockerfile}: prune loop is a no-op when only the pinned version is installed`);
}

/**
 * Extract the loop that records the base image's global npm packages and run it
 * against a fixture `lib/node_modules`, returning the specs it collected.
 *
 * This is the riskiest part of the runtime swap: the inherited `playwright` must
 * be re-installed at its EXACT version, because ~/.cache/ms-playwright holds
 * only the browser builds matching it. An unpinned re-install would leave the
 * CLI expecting browsers the image does not have.
 */
const runGlobalPackageScan = (source, packages) => {
  const loop = source.match(/for package_json in "\$PREVIOUS_GLOBAL_LIB"[\s\S]*?\n\s*done/)?.[0];
  if (!loop) return null;

  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2187-globals-'));
  try {
    for (const [name, version] of Object.entries(packages)) {
      const dir = path.join(lib, ...name.split('/'));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version }));
    }
    const script = `set -e\nPREVIOUS_GLOBAL_LIB=${JSON.stringify(lib)}\nGLOBAL_SPECS=""\n${loop}\necho "$GLOBAL_SPECS"\n`;
    return execFileSync('bash', ['-c', script], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean).sort();
  } finally {
    fs.rmSync(lib, { recursive: true, force: true });
  }
};

for (const dockerfile of DOCKERFILES) {
  const { source } = pins.get(dockerfile);
  const specs = runGlobalPackageScan(source, {
    npm: '11.19.0',
    corepack: '0.36.0',
    playwright: '1.58.2',
    '@playwright/test': '1.58.2',
    '@puppeteer/browsers': '2.10.10',
  });
  check(specs !== null, `${dockerfile}: has a global-npm-package scan`);
  if (specs === null) continue;
  check(specs.join(' ') === '@playwright/test@1.58.2 @puppeteer/browsers@2.10.10 playwright@1.58.2', `${dockerfile}: re-installs inherited globals at their exact versions (got: ${specs.join(' ')})`);
  check(!specs.some(spec => spec.startsWith('npm@') || spec.startsWith('corepack@')), `${dockerfile}: does not re-install node's bundled npm/corepack`);
  check(runGlobalPackageScan(source, {}).length === 0, `${dockerfile}: collects nothing when the base has no global packages`);
}

// The image verification script enforces the same floor inside the built image.
const verifyScript = read('scripts/verify-docker-image.sh');
const verifyFloor = Number(verifyScript.match(/^MIN_NODE_MAJOR=(\d+)$/m)?.[1]);
check(verifyFloor === enginesNodeFloor, `scripts/verify-docker-image.sh MIN_NODE_MAJOR (${verifyFloor}) matches engines.node floor (${enginesNodeFloor})`);
check(/versions under \$\{NVM_NODE_ROOT\}|INSTALLED_NODE_VERSIONS/.test(verifyScript), 'scripts/verify-docker-image.sh counts installed Node.js versions');

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
