#!/usr/bin/env node

/**
 * Check for pending changeset files
 *
 * This script checks for pending changeset files in the .changeset directory
 * and outputs the count and status for use in GitHub Actions workflow
 * conditions. A pending changeset must declare the current package and a valid
 * bump type in changeset frontmatter; stray Markdown docs are ignored.
 *
 * Usage:
 *   node scripts/check-changesets.mjs
 *
 * Outputs (written to GITHUB_OUTPUT):
 *   - has_changesets: 'true' if there are pending changesets
 *   - changeset_count: number of changeset files found
 */

import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { getChangesetDir, getJsRoot, parseJsRootConfig } from './js-paths.mjs';
import {
  getChangesetVersionTypeRegex,
  readPackageInfo,
} from './package-info.mjs';

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
  console.log(`${name}=${value}`);
}

/**
 * Extract frontmatter from a Markdown changeset file.
 * @param {string} content
 * @returns {string | null}
 */
function extractChangesetFrontmatter(content) {
  const frontmatterMatch = content.match(
    /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
  );

  return frontmatterMatch ? frontmatterMatch[1] : null;
}

/**
 * Check whether a file name can be a changeset candidate.
 * @param {string} file
 * @returns {boolean}
 */
function isMarkdownChangesetCandidate(file) {
  return file.endsWith('.md') && file !== 'README.md';
}

/**
 * Check whether a Markdown file has valid changeset frontmatter.
 * @param {string} filePath
 * @param {RegExp} versionTypeRegex
 * @returns {boolean}
 */
function hasValidChangesetFrontmatter(filePath, versionTypeRegex) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const frontmatter = extractChangesetFrontmatter(content);

    return frontmatter !== null && versionTypeRegex.test(frontmatter);
  } catch (error) {
    console.warn(`Warning: Failed to read ${filePath}: ${error.message}`);
    return false;
  }
}

/**
 * Count changeset files in the .changeset directory
 * @param {string} changesetDir
 * @param {string} packageName
 * @returns {number} Number of changeset files found
 */
function countChangesetFiles(changesetDir, packageName) {
  if (!existsSync(changesetDir)) {
    return 0;
  }

  const versionTypeRegex = getChangesetVersionTypeRegex(packageName, {
    requireQuotes: false,
  });
  const files = readdirSync(changesetDir);
  const changesetFiles = files.filter(
    (file) =>
      isMarkdownChangesetCandidate(file) &&
      hasValidChangesetFrontmatter(join(changesetDir, file), versionTypeRegex)
  );

  return changesetFiles.length;
}

/**
 * Main function to check for changesets
 */
function checkChangesets() {
  console.log('Checking for pending changeset files...\n');

  const jsRootConfig = parseJsRootConfig();
  const jsRoot = getJsRoot({ jsRoot: jsRootConfig, verbose: true });
  const changesetDir = getChangesetDir({ jsRoot });
  const { name: packageName } = readPackageInfo({ jsRoot });

  console.log(`Package: ${packageName}`);
  console.log(`Changeset directory: ${changesetDir}`);

  const changesetCount = countChangesetFiles(changesetDir, packageName);

  console.log(`Found ${changesetCount} changeset file(s)`);

  setOutput('has_changesets', changesetCount > 0 ? 'true' : 'false');
  setOutput('changeset_count', String(changesetCount));
}

// Run the check
checkChangesets();
