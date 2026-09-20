#!/usr/bin/env bun

/**
 * Validate changeset for CI - ensures exactly one valid changeset is added by the PR
 *
 * Key behavior:
 * - Only checks changeset files ADDED by the current PR (not pre-existing ones)
 * - Uses git diff to compare PR head against base branch
 * - Validates that the PR adds exactly one changeset with proper format
 * - Falls back to checking all changesets for local development
 */

import { execSync } from 'child_process';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

import { getChangesetDir, getJsRoot, parseJsRootConfig } from './js-paths.mjs';
import {
  getChangesetVersionTypeRegex,
  readPackageInfo,
} from './package-info.mjs';

/**
 * Ensure a git commit is available locally, fetching if necessary
 * @param {string} sha The commit SHA to check
 */
function ensureCommitAvailable(sha) {
  try {
    execSync(`git cat-file -e ${sha}`, { stdio: 'ignore' });
  } catch {
    console.log('Base commit not available locally, attempting fetch...');
    try {
      execSync(`git fetch origin ${sha}`, { stdio: 'inherit' });
    } catch {
      execSync(`git fetch origin`, { stdio: 'inherit' });
    }
  }
}

/**
 * Parse git diff output and extract added changeset files
 * @param {string} diffOutput Output from git diff --name-status
 * @param {string} changesetDir Path to the changeset directory
 * @returns {string[]} Array of added changeset file names
 */
function parseAddedChangesets(diffOutput, changesetDir) {
  const addedChangesets = [];
  const changesetGitPath = changesetDir
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  for (const line of diffOutput.trim().split('\n')) {
    if (!line) {
      continue;
    }
    const [status, filePath] = line.split('\t');
    if (
      status === 'A' &&
      filePath.startsWith(`${changesetGitPath}/`) &&
      filePath.endsWith('.md') &&
      !filePath.endsWith('README.md')
    ) {
      addedChangesets.push(filePath.replace(`${changesetGitPath}/`, ''));
    }
  }
  return addedChangesets;
}

/**
 * Try to get changesets using explicit SHA comparison
 * @param {string} baseSha Base commit SHA
 * @param {string} headSha Head commit SHA
 * @param {string} changesetDir Path to the changeset directory
 * @returns {string[] | null} Array of changeset files or null if failed
 */
function tryExplicitShaComparison(baseSha, headSha, changesetDir) {
  console.log(`Comparing ${baseSha}...${headSha}`);
  try {
    ensureCommitAvailable(baseSha);
    const diffOutput = execSync(
      `git diff --name-status ${baseSha} ${headSha}`,
      { encoding: 'utf-8' }
    );
    return parseAddedChangesets(diffOutput, changesetDir);
  } catch (error) {
    console.log(`Git diff with explicit SHAs failed: ${error.message}`);
    return null;
  }
}

/**
 * Try to get changesets using base branch comparison
 * @param {string} prBase Base branch name
 * @param {string} changesetDir Path to the changeset directory
 * @returns {string[] | null} Array of changeset files or null if failed
 */
function tryBaseBranchComparison(prBase, changesetDir) {
  console.log(`Comparing against base branch: ${prBase}`);
  try {
    try {
      execSync(`git fetch origin ${prBase}`, { stdio: 'inherit' });
    } catch {
      // Ignore fetch errors, we might already have it
    }
    const diffOutput = execSync(
      `git diff --name-status origin/${prBase}...HEAD`,
      { encoding: 'utf-8' }
    );
    return parseAddedChangesets(diffOutput, changesetDir);
  } catch (error) {
    console.log(`Git diff with base ref failed: ${error.message}`);
    return null;
  }
}

/**
 * Fallback: get all changesets in directory
 * @param {string} changesetDir Path to the changeset directory
 * @returns {string[]} Array of all changeset file names
 */
function getAllChangesets(changesetDir) {
  console.log(
    'Warning: Could not determine PR diff, checking all changesets in directory'
  );
  if (!existsSync(changesetDir)) {
    return [];
  }
  return readdirSync(changesetDir).filter(
    (file) => file.endsWith('.md') && file !== 'README.md'
  );
}

/**
 * Get changeset files added in the current PR using git diff
 * @param {string} changesetDir Path to the changeset directory
 * @returns {string[]} Array of added changeset file names
 */
function getAddedChangesetFiles(changesetDir) {
  const baseSha = process.env.GITHUB_BASE_SHA || process.env.BASE_SHA;
  const headSha = process.env.GITHUB_HEAD_SHA || process.env.HEAD_SHA;

  // Try explicit SHAs first
  if (baseSha && headSha) {
    const result = tryExplicitShaComparison(baseSha, headSha, changesetDir);
    if (result !== null) {
      return result;
    }
  }

  // Try base branch comparison
  const prBase = process.env.GITHUB_BASE_REF;
  if (prBase) {
    const result = tryBaseBranchComparison(prBase, changesetDir);
    if (result !== null) {
      return result;
    }
  }

  // Fallback to checking all changesets
  return getAllChangesets(changesetDir);
}

/**
 * Validate a single changeset file
 * @param {string} filePath Full path to the changeset file
 * @param {string} packageName
 * @returns {{valid: boolean, type?: string, description?: string, error?: string}}
 */
function validateChangesetFile(filePath, packageName) {
  try {
    const content = readFileSync(filePath, 'utf-8');

    // Check if changeset has a valid type (major, minor, or patch)
    const versionTypeRegex = getChangesetVersionTypeRegex(packageName);
    const versionTypeMatch = content.match(versionTypeRegex);

    if (!versionTypeMatch) {
      return {
        valid: false,
        error: `Changeset must specify a version type: major, minor, or patch\nExpected format:\n---\n'${packageName}': patch\n---\n\nYour description here`,
      };
    }

    // Extract description (everything after the closing ---) and check it's not empty
    const parts = content.split('---');
    if (parts.length < 3) {
      return {
        valid: false,
        error:
          "Changeset must include a description of the changes (after the closing '---')",
      };
    }

    const description = parts.slice(2).join('---').trim();
    if (!description) {
      return {
        valid: false,
        error: 'Changeset must include a non-empty description of the changes',
      };
    }

    return {
      valid: true,
      type: versionTypeMatch[1],
      description,
    };
  } catch (error) {
    return {
      valid: false,
      error: `Failed to read changeset file: ${error.message}`,
    };
  }
}

try {
  console.log('Validating changesets added by this PR...');
  const jsRootConfig = parseJsRootConfig();
  const jsRoot = getJsRoot({ jsRoot: jsRootConfig, verbose: true });
  const changesetDir = getChangesetDir({ jsRoot });
  const { name: packageName } = readPackageInfo({ jsRoot });
  console.log(`Package: ${packageName}`);

  // Get changeset files added in this PR
  const addedChangesetFiles = getAddedChangesetFiles(changesetDir);
  const changesetCount = addedChangesetFiles.length;

  console.log(`Found ${changesetCount} changeset file(s) added by this PR`);
  if (changesetCount > 0) {
    console.log('Added changesets:');
    addedChangesetFiles.forEach((file) => console.log(`  - ${file}`));
  }

  // Ensure exactly one changeset file was added
  if (changesetCount === 0) {
    console.error(
      "::error::No changeset found in this PR. Please add a changeset by running 'npm run changeset' and commit the result."
    );
    process.exit(1);
  } else if (changesetCount > 1) {
    console.error(
      `::error::Multiple changesets found in this PR (${changesetCount}). Each PR should add exactly ONE changeset.`
    );
    console.error('::error::Found changeset files added by this PR:');
    addedChangesetFiles.forEach((file) => console.error(`  ${file}`));
    console.error(
      '\n::error::Please combine these into a single changeset or remove the extras.'
    );
    process.exit(1);
  }

  // Validate the single changeset file
  const changesetFile = join(changesetDir, addedChangesetFiles[0]);
  console.log(`Validating changeset: ${changesetFile}`);

  const validation = validateChangesetFile(changesetFile, packageName);

  if (!validation.valid) {
    console.error(`::error::${validation.error}`);
    console.error(`\nFile content of ${changesetFile}:`);
    try {
      console.error(readFileSync(changesetFile, 'utf-8'));
    } catch {
      console.error('(could not read file)');
    }
    process.exit(1);
  }

  console.log('Changeset validation passed');
  console.log(`   Type: ${validation.type}`);
  console.log(`   Description: ${validation.description}`);
} catch (error) {
  console.error('Error during changeset validation:', error.message);
  if (process.env.DEBUG) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
}
