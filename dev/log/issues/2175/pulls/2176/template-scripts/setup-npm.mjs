#!/usr/bin/env node

import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Update npm for OIDC trusted publishing
 * npm trusted publishing requires npm >= 11.5.1
 * Node.js 20.x ships with npm 10.x, so we need to update
 *
 * Uses link-foundation libraries:
 * - use-m: Dynamic package loading without package.json dependencies
 * - command-stream: Modern shell command execution with streaming support
 */

export const NPM_MIN_VERSION = '11.5.1';
export const NODE_MIN_VERSION = '22.14.0';
export const NPM_TARGET_MAJOR = 11;
export const NPM_REGISTRY_METADATA_URL = 'https://registry.npmjs.org/npm';

export function parseVersion(version) {
  const match = String(version)
    .trim()
    .match(
      /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?(?:\+[0-9A-Za-z-.]+)?$/
    );

  if (!match) {
    throw new Error(`Invalid semantic version: ${version}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || '',
  };
}

export function compareVersions(leftVersion, rightVersion) {
  const left = parseVersion(leftVersion);
  const right = parseVersion(rightVersion);
  const keys = ['major', 'minor', 'patch'];

  for (const key of keys) {
    if (left[key] !== right[key]) {
      return left[key] > right[key] ? 1 : -1;
    }
  }

  if (left.prerelease === right.prerelease) {
    return 0;
  }

  if (!left.prerelease) {
    return 1;
  }

  if (!right.prerelease) {
    return -1;
  }

  return left.prerelease > right.prerelease ? 1 : -1;
}

export function isVersionAtLeast(version, minimumVersion) {
  return compareVersions(version, minimumVersion) >= 0;
}

export function isSupportedNpmVersion(version) {
  return isVersionAtLeast(version, NPM_MIN_VERSION);
}

export function isSupportedNodeVersion(version) {
  return isVersionAtLeast(version, NODE_MIN_VERSION);
}

export function selectLatestSupportedNpmRelease(metadata) {
  const releases = Object.entries(metadata?.versions || {})
    .filter(([version, release]) => {
      const parsed = parseVersion(version);
      return (
        parsed.major === NPM_TARGET_MAJOR &&
        !parsed.prerelease &&
        isSupportedNpmVersion(version) &&
        release?.dist?.tarball
      );
    })
    .sort(([leftVersion], [rightVersion]) =>
      compareVersions(rightVersion, leftVersion)
    );

  if (releases.length === 0) {
    throw new Error(
      `No npm ${NPM_TARGET_MAJOR}.x release found at or above ${NPM_MIN_VERSION}`
    );
  }

  const [version, release] = releases[0];
  return { version, tarballUrl: release.dist.tarball };
}

async function fetchNpmRegistryMetadata(fetchFn) {
  const response = await fetchFn(NPM_REGISTRY_METADATA_URL, {
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch npm registry metadata: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}

async function resolveLatestSupportedNpmRelease(fetchFn) {
  const metadata = await fetchNpmRegistryMetadata(fetchFn);
  return selectLatestSupportedNpmRelease(metadata);
}

// Update npm for OIDC trusted publishing (requires >= 11.5.1)
// Pin to npm@11 to avoid breaking changes from future major versions
//
// Known issue: Node.js 22.22.2 on GitHub Actions (ubuntu-24.04 image >= 20260329.72.1)
// ships with a broken npm 10.9.7 that is missing the 'promise-retry' module,
// causing `npm install -g` to fail with MODULE_NOT_FOUND.
// See: https://github.com/actions/runner-images/issues/13883
// See: https://github.com/nodejs/node/issues/62430
// See: https://github.com/npm/cli/issues/9151
//
// Workaround strategies in order of preference:
// 1. npm install -g npm@11 (standard approach)
// 2. curl tarball download (bypasses broken npm entirely)
// 3. npx npm@11 install (uses npx cache, bypasses arborist)
// 4. corepack as last resort

async function tryStandardInstall($) {
  await $`npm install -g npm@11`;
}

async function tryCurlTarball($, fetchFn) {
  const npmRelease = await resolveLatestSupportedNpmRelease(fetchFn);
  console.log(`Downloading npm ${npmRelease.version} tarball...`);

  const nodeDir = (
    await $`dirname $(dirname $(which node))`.run({ capture: true })
  ).stdout.trim();
  const globalNpmDir = `${nodeDir}/lib/node_modules/npm`;
  const tempNpmDir = '/tmp/setup-npm-package';

  await $`rm -rf "${tempNpmDir}" && mkdir -p "${tempNpmDir}"`;
  await $`curl -fsSL "${npmRelease.tarballUrl}" | tar xz --strip-components=1 -C "${tempNpmDir}" && rm -rf "${globalNpmDir}" && mv "${tempNpmDir}" "${globalNpmDir}"`;
}

async function tryNpxInstall($) {
  await $`npx --yes npm@11 install -g npm@11`;
}

async function tryCorepack($) {
  await $`corepack enable`;
  await $`corepack prepare npm@11 --activate`;
}

async function tryStrategy(name, fn) {
  try {
    await fn();
    return true;
  } catch (error) {
    console.warn(`Warning: ${name} failed: ${error.message}`);
    return false;
  }
}

function failUnsupportedNodeVersion(nodeVersion) {
  console.error(
    `ERROR: Node.js ${NODE_MIN_VERSION} or later is required for npm OIDC trusted publishing setup.`
  );
  console.error(`Current Node.js version is ${nodeVersion}.`);
  process.exit(1);
}

function failUnsupportedNpmVersion(npmVersion) {
  console.error(
    `ERROR: Could not update npm to >= ${NPM_MIN_VERSION} for OIDC trusted publishing.`
  );
  console.error(`Current npm version ${npmVersion} does not support OIDC.`);
  console.error('See: https://github.com/actions/runner-images/issues/13883');
  process.exit(1);
}

export async function setupNpm($, fetchFn = fetch) {
  const nodeVersion = process.version;
  console.log(`Current Node.js version: ${nodeVersion}`);

  if (!isSupportedNodeVersion(nodeVersion)) {
    failUnsupportedNodeVersion(nodeVersion);
  }

  const currentResult = await $`npm --version`.run({ capture: true });
  const currentVersion = currentResult.stdout.trim();
  console.log(`Current npm version: ${currentVersion}`);

  const strategies = [
    ['npm install -g npm@11', () => tryStandardInstall($)],
    ['curl-based tarball download', () => tryCurlTarball($, fetchFn)],
    ['npx-based install', () => tryNpxInstall($)],
    ['corepack', () => tryCorepack($)],
  ];

  let success = false;
  for (const [name, fn] of strategies) {
    console.log(`Trying ${name}...`);
    success = await tryStrategy(name, fn);
    if (success) {
      break;
    }
    console.warn(
      'This may be the Node.js 22.22.2 broken npm issue (actions/runner-images#13883).'
    );
  }

  if (!success) {
    if (isSupportedNpmVersion(currentVersion)) {
      console.log(
        'Current npm version already supports OIDC trusted publishing'
      );
    }
  }

  const updatedResult = await $`npm --version`.run({ capture: true });
  const updatedVersion = updatedResult.stdout.trim();
  console.log(`Updated npm version: ${updatedVersion}`);

  if (!isSupportedNpmVersion(updatedVersion)) {
    failUnsupportedNpmVersion(updatedVersion);
  }
}

function isMainModule() {
  return process.argv[1]
    ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false;
}

if (isMainModule()) {
  try {
    if (!isSupportedNodeVersion(process.version)) {
      failUnsupportedNodeVersion(process.version);
    }

    // Load use-m dynamically only for CLI execution, so tests can import the
    // pure version helpers without fetching dependencies or mutating npm.
    const { use } = eval(
      await (await fetch('https://unpkg.com/use-m/use.js')).text()
    );
    const { $ } = await use('command-stream');

    await setupNpm($);
  } catch (error) {
    console.error('Error updating npm:', error.message);
    process.exit(1);
  }
}
