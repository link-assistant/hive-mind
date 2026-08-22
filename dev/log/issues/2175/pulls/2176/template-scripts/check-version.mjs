#!/usr/bin/env node

/**
 * Check for manual version modifications in package.json
 *
 * This script prevents manual version changes in pull requests.
 * Versions should only be changed by the CI/CD pipeline using changesets.
 *
 * Key behavior:
 * - For PRs: compares PR head against base branch to detect version changes
 * - Skips check for automated release PRs (changeset-release/* branches)
 * - Fails the build if manual version changes are detected
 *
 * Usage:
 *   node scripts/check-version.mjs
 *
 * Environment variables (set by GitHub Actions):
 *   - GITHUB_HEAD_REF: Branch name of the PR head
 *   - GITHUB_BASE_REF: Branch name of the PR base
 *
 * Exit codes:
 *   - 0: No manual version changes detected (or skipped for release PRs)
 *   - 1: Manual version changes detected
 */

import { execSync } from 'child_process';

/**
 * Execute a shell command and return trimmed output
 * @param {string} command - The command to execute
 * @returns {string} - The trimmed command output
 */
function exec(command) {
  try {
    return execSync(command, { encoding: 'utf-8' }).trim();
  } catch (error) {
    console.error(`Error executing command: ${command}`);
    console.error(error.message);
    return '';
  }
}

/**
 * Check if this is an automated release PR that should skip version check
 * @returns {boolean} True if version check should be skipped
 */
function shouldSkipVersionCheck() {
  const headRef = process.env.GITHUB_HEAD_REF || '';

  // Skip check for automated release PRs created by changeset
  const skipPatterns = ['changeset-release/', 'changeset-manual-release-'];

  for (const pattern of skipPatterns) {
    if (headRef.startsWith(pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Get the version diff from package.json
 * @returns {string} The version diff line if found, empty string otherwise
 */
function getVersionDiff() {
  const baseRef = process.env.GITHUB_BASE_REF || 'main';

  // Get the diff for package.json, looking for added lines with "version"
  const diffCommand = `git diff origin/${baseRef}...HEAD -- package.json`;
  const diff = exec(diffCommand);

  if (!diff) {
    return '';
  }

  // Look for added lines (starting with +) containing "version"
  // Match pattern: +"version": "x.y.z"
  const versionChangePattern = /^\+\s*"version"\s*:\s*"[^"]+"/m;
  const match = diff.match(versionChangePattern);

  return match ? match[0] : '';
}

/**
 * Main function to check for version changes
 */
function checkVersion() {
  console.log('Checking for manual version changes in package.json...\n');

  // Check if we should skip the version check
  if (shouldSkipVersionCheck()) {
    const headRef = process.env.GITHUB_HEAD_REF || '';
    console.log(`Skipping version check for automated release PR: ${headRef}`);
    process.exit(0);
  }

  // Get the version diff
  const versionDiff = getVersionDiff();

  if (versionDiff) {
    console.error('::error::Manual version change detected in package.json');
    console.error('');
    console.error(
      'Version changes in package.json are prohibited in pull requests.'
    );
    console.error(
      'Versions are managed automatically by the CI/CD pipeline using changesets.'
    );
    console.error('');
    console.error('To request a release:');
    console.error(
      '  1. Add a changeset file describing your changes (npx changeset)'
    );
    console.error(
      '  2. The release workflow will automatically bump the version when merged'
    );
    console.error('');
    console.error('Detected change:');
    console.error(versionDiff);
    process.exit(1);
  }

  console.log('No manual version changes detected - check passed');
  process.exit(0);
}

// Run the check
checkVersion();
