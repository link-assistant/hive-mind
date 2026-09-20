#!/usr/bin/env node

/**
 * Check if a release is needed based on changesets and npm registry state
 *
 * This script checks:
 * 1. If there are changeset files to process
 * 2. If the current version has already been published to npm
 *
 * IMPORTANT: This script checks npm (the source of truth for JS packages),
 * NOT git tags. This is critical because:
 * - Git tags can exist without the package being published
 * - GitHub releases create tags but don't publish to npm
 * - Only npm publication means users can actually install the package
 *
 * This provides a self-healing mechanism: if a previous release attempt
 * failed or was skipped, the next push to main will detect the unpublished
 * version and trigger a release without requiring a changeset.
 *
 * Analogous to check-release-needed.rs in the Rust template.
 *
 * Supports both single-language and multi-language repository structures:
 * - Single-language: package.json in repository root
 * - Multi-language: package.json in js/ subfolder
 *
 * Usage: node scripts/check-release-needed.mjs [--js-root <path>]
 *
 * Environment variables:
 *   - HAS_CHANGESETS: 'true' if changeset files exist (from check-changesets.mjs)
 *
 * Outputs (written to GITHUB_OUTPUT):
 *   - should_release: 'true' if a release should be created
 *   - skip_bump: 'true' if version bump should be skipped (version not yet published)
 *
 * Addresses issues documented in:
 * - Issue #36: Release job silently skips when PRs merge without changesets
 */

import { appendFileSync } from 'fs';

import { getJsRoot, parseJsRootConfig } from './js-paths.mjs';
import { isPackageVersionPublished } from './npm-registry.mjs';
import { readPackageInfo } from './package-info.mjs';

const jsRootConfig = parseJsRootConfig();
const jsRoot = getJsRoot({ jsRoot: jsRootConfig, verbose: true });

/**
 * Write output to GitHub Actions output file
 * @param {string} name - Output name
 * @param {string} value - Output value
 */
function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
  console.log(`Output: ${name}=${value}`);
}

/**
 * Get the package name and version from package.json
 * @returns {{ name: string, version: string }}
 */
function getPackageInfo() {
  return readPackageInfo({ jsRoot });
}

/**
 * Check if a specific version is published on npm
 * @param {string} packageName
 * @param {string} version
 * @returns {Promise<boolean>}
 */
function checkVersionOnNpm(packageName, version) {
  return isPackageVersionPublished(packageName, version);
}

async function main() {
  const hasChangesets = process.env.HAS_CHANGESETS === 'true';
  const { name: packageName, version: currentVersion } = getPackageInfo();

  console.log(`Package: ${packageName}`);
  console.log(`Current version: ${currentVersion}`);
  console.log(`Has changesets: ${hasChangesets}`);

  if (hasChangesets) {
    console.log('Found changesets, proceeding with release');
    setOutput('should_release', 'true');
    setOutput('skip_bump', 'false');
    return;
  }

  console.log(
    `Checking if ${packageName}@${currentVersion} is published on npm...`
  );
  const isPublished = await checkVersionOnNpm(packageName, currentVersion);
  console.log(`Published on npm: ${isPublished}`);

  if (isPublished) {
    console.log(
      `No changesets and v${currentVersion} already published on npm — no release needed`
    );
    setOutput('should_release', 'false');
    setOutput('skip_bump', 'false');
  } else {
    console.log(
      `No changesets but v${currentVersion} not yet published to npm — release needed (self-healing)`
    );
    setOutput('should_release', 'true');
    setOutput('skip_bump', 'true');
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
