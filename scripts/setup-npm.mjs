#!/usr/bin/env node

/**
 * Prepare npm for OIDC trusted publishing.
 *
 * npm trusted publishing (provenance) requires npm >= 11.5.1. Node.js 20.x/22.x
 * ships with npm 10.x, so the release runner must upgrade npm first.
 *
 * Why this pins npm@11 (issue #2028, CI run 29035249489):
 *   The previous version ran `npm install -g npm@latest`. At the time of the
 *   failure `npm@latest` was 12.0.0, which has a regression (npm/cli#9722):
 *   `npm publish --provenance` crashes with
 *   "Cannot find module 'sigstore'" (MODULE_NOT_FOUND) because the sigstore
 *   dependency is not bundled. That broke every provenance publish. Pinning to
 *   the npm 11 line keeps a version that supports trusted publishing AND is not
 *   affected by the npm 12 sigstore regression. We additionally validate that
 *   the installed version is >= 11.5.1 so a bad install fails loudly here rather
 *   than silently downstream.
 *
 * Version helpers are ported from
 * link-foundation/js-ai-driven-development-pipeline-template.
 *
 * Uses only Node built-ins so it has no dependency on node_modules state.
 */

import { spawn } from 'node:child_process';

// The npm major line we install. npm 11 supports OIDC trusted publishing and is
// free of the npm 12.0.0 sigstore regression (npm/cli#9722).
export const NPM_TARGET_MAJOR = 11;
// Minimum npm version that supports OIDC trusted publishing / provenance.
export const NPM_MIN_VERSION = '11.5.1';

/**
 * Parse a semver-ish version string into numeric components.
 * @param {string} version
 * @returns {{major:number, minor:number, patch:number}}
 */
export function parseVersion(version) {
  const clean = String(version || '')
    .trim()
    .replace(/^v/, '');
  const [core] = clean.split('-'); // drop any prerelease/build suffix
  const [major = 0, minor = 0, patch = 0] = core.split('.').map(part => Number.parseInt(part, 10) || 0);
  return { major, minor, patch };
}

/**
 * Compare two version strings.
 * @param {string} a
 * @param {string} b
 * @returns {number} -1 if a<b, 0 if equal, 1 if a>b
 */
export function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (va.major !== vb.major) return va.major < vb.major ? -1 : 1;
  if (va.minor !== vb.minor) return va.minor < vb.minor ? -1 : 1;
  if (va.patch !== vb.patch) return va.patch < vb.patch ? -1 : 1;
  return 0;
}

/**
 * Return true if `version` is >= `minimum`.
 * @param {string} version
 * @param {string} minimum
 * @returns {boolean}
 */
export function isVersionAtLeast(version, minimum) {
  return compareVersions(version, minimum) >= 0;
}

/**
 * Whether an npm version supports OIDC trusted publishing and is free of the
 * npm 12 sigstore regression.
 * @param {string} version
 * @returns {boolean}
 */
export function isSupportedNpmVersion(version) {
  const { major } = parseVersion(version);
  // Reject npm 12.x (sigstore regression, npm/cli#9722) and anything below the
  // minimum that supports provenance.
  if (major >= 12) return false;
  return isVersionAtLeast(version, NPM_MIN_VERSION);
}

/**
 * Run a command, buffering output while streaming it to the parent stdio.
 * Always resolves with the real exit code.
 * @param {string} command
 * @param {string[]} args
 * @param {{spawner?: typeof spawn}} [opts]
 * @returns {Promise<{code:number, stdout:string, stderr:string, message:string}>}
 */
export const runCommand = (command, args, { spawner = spawn } = {}) =>
  new Promise(resolve => {
    const child = spawner(command, args, { stdio: ['inherit', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on('error', error => resolve({ code: 1, stdout, stderr, message: error.message }));
    child.on('close', code => resolve({ code: code ?? 1, stdout, stderr, message: '' }));
  });

/**
 * Read the installed npm version.
 * @param {(command:string, args:string[]) => Promise<{code:number, stdout:string}>} runner
 * @returns {Promise<string>}
 */
export async function getNpmVersion(runner) {
  const result = await runner('npm', ['--version']);
  return result.stdout.trim();
}

/**
 * Upgrade npm to the pinned major line and validate the result.
 * @param {object} opts
 * @param {(command:string, args:string[]) => Promise<{code:number, stdout:string, stderr:string, message?:string}>} opts.runner
 * @param {Console} [opts.logger]
 * @returns {Promise<{ok:boolean, version?:string, reason?:string}>}
 */
export async function setupNpm({ runner, logger = console }) {
  const currentVersion = await getNpmVersion(runner);
  logger.log(`Current npm version: ${currentVersion}`);

  if (isSupportedNpmVersion(currentVersion)) {
    logger.log(`npm ${currentVersion} already supports trusted publishing; no upgrade needed`);
    return { ok: true, version: currentVersion };
  }

  // Pin to the npm 11 line. Do NOT use npm@latest — it can resolve to npm 12.x
  // which has the sigstore provenance regression (npm/cli#9722).
  logger.log(`Installing npm@${NPM_TARGET_MAJOR} (avoiding npm 12 sigstore regression)...`);
  const installResult = await runner('npm', ['install', '-g', `npm@${NPM_TARGET_MAJOR}`]);
  if (installResult.code !== 0) {
    const reason = `npm install -g npm@${NPM_TARGET_MAJOR} failed with exit code ${installResult.code}`;
    logger.error(reason);
    return { ok: false, reason };
  }

  const updatedVersion = await getNpmVersion(runner);
  logger.log(`Updated npm version: ${updatedVersion}`);

  if (!isSupportedNpmVersion(updatedVersion)) {
    const reason = `Installed npm ${updatedVersion} is not a supported version for trusted publishing ` + `(need >= ${NPM_MIN_VERSION} and < 12.0.0). Aborting so the failure is visible here.`;
    logger.error(reason);
    return { ok: false, reason, version: updatedVersion };
  }

  return { ok: true, version: updatedVersion };
}

async function main() {
  const { ok, reason } = await setupNpm({ runner: runCommand });
  if (!ok) {
    console.error(`Error setting up npm: ${reason}`);
    process.exit(1);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('setup-npm.mjs');
if (isMain) {
  main().catch(error => {
    console.error('Error updating npm:', error.message);
    process.exit(1);
  });
}
