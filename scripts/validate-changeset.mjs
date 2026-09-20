#!/usr/bin/env node

/**
 * Validate changeset for CI - ensures exactly one valid changeset is added by the PR
 *
 * Key behavior:
 * - Only checks changeset files ADDED by the current PR (not pre-existing ones)
 * - Uses git diff to compare PR head against base branch
 * - Validates that the PR adds exactly one changeset with proper format
 */

import { execSync } from 'child_process';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const PACKAGE_NAME = '@link-assistant/hive-mind';

/**
 * Get changeset files added in the current PR using git diff
 * @returns {string[]} Array of added changeset file names
 */
function getAddedChangesetFiles() {
  const changesetDir = '.changeset';

  // Try to get PR context from environment variables (GitHub Actions)
  const baseSha = process.env.GITHUB_BASE_SHA || process.env.BASE_SHA;
  const headSha = process.env.GITHUB_HEAD_SHA || process.env.HEAD_SHA;

  // If we have explicit SHAs, use them
  if (baseSha && headSha) {
    console.log(`Comparing ${baseSha}...${headSha}`);
    try {
      // Ensure we have the base commit
      try {
        execSync(`git cat-file -e ${baseSha}`, { stdio: 'ignore' });
      } catch {
        // Try to fetch the base commit if not available locally
        console.log('Base commit not available locally, attempting fetch...');
        try {
          execSync(`git fetch origin ${baseSha}`, { stdio: 'inherit' });
        } catch {
          // If that fails, try fetching all
          execSync(`git fetch origin`, { stdio: 'inherit' });
        }
      }

      const diffOutput = execSync(`git diff --name-status ${baseSha} ${headSha}`, {
        encoding: 'utf-8',
      });

      const addedChangesets = [];
      for (const line of diffOutput.trim().split('\n')) {
        if (!line) continue;
        const [status, filePath] = line.split('\t');
        // Only count files that were Added (A) in the changeset directory
        if (status === 'A' && filePath.startsWith(`${changesetDir}/`) && filePath.endsWith('.md') && !filePath.endsWith('README.md')) {
          addedChangesets.push(filePath.replace(`${changesetDir}/`, ''));
        }
      }
      return addedChangesets;
    } catch (error) {
      console.log(`Git diff with explicit SHAs failed: ${error.message}`);
      // Fall through to alternative detection
    }
  }

  // Try GitHub PR context (available in pull_request events)
  const prBase = process.env.GITHUB_BASE_REF;
  if (prBase) {
    console.log(`Comparing against base branch: ${prBase}`);
    try {
      // Fetch the base branch to ensure we have it
      try {
        execSync(`git fetch origin ${prBase}`, { stdio: 'inherit' });
      } catch {
        // Ignore fetch errors, we might already have it
      }

      const diffOutput = execSync(`git diff --name-status origin/${prBase}...HEAD`, {
        encoding: 'utf-8',
      });

      const addedChangesets = [];
      for (const line of diffOutput.trim().split('\n')) {
        if (!line) continue;
        const [status, filePath] = line.split('\t');
        if (status === 'A' && filePath.startsWith(`${changesetDir}/`) && filePath.endsWith('.md') && !filePath.endsWith('README.md')) {
          addedChangesets.push(filePath.replace(`${changesetDir}/`, ''));
        }
      }
      return addedChangesets;
    } catch (error) {
      console.log(`Git diff with base ref failed: ${error.message}`);
    }
  }

  // Fallback: If we can't determine the diff, check all changesets in directory
  // This maintains backward compatibility for local development
  console.log('Warning: Could not determine PR diff, checking all changesets in directory');
  if (!existsSync(changesetDir)) {
    return [];
  }

  const allChangesets = readdirSync(changesetDir).filter(file => file.endsWith('.md') && file !== 'README.md');

  return allChangesets;
}

/**
 * Validate a single changeset file
 * @param {string} filePath Full path to the changeset file
 * @returns {{valid: boolean, type?: string, description?: string, error?: string}}
 */
function validateChangesetFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');

    // Check if changeset has a valid type (major, minor, or patch)
    const versionTypeRegex = new RegExp(`^['"]${PACKAGE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]:\\s+(major|minor|patch)`, 'm');
    const versionTypeMatch = content.match(versionTypeRegex);

    if (!versionTypeMatch) {
      return {
        valid: false,
        error: `Changeset must specify a version type: major, minor, or patch\nExpected format:\n---\n'${PACKAGE_NAME}': patch\n---\n\nYour description here`,
      };
    }

    // Extract description (everything after the closing ---) and check it's not empty
    const parts = content.split('---');
    if (parts.length < 3) {
      return {
        valid: false,
        error: "Changeset must include a description of the changes (after the closing '---')",
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

  // Get changeset files added in this PR
  const addedChangesetFiles = getAddedChangesetFiles();
  const changesetCount = addedChangesetFiles.length;

  console.log(`Found ${changesetCount} changeset file(s) added by this PR`);
  if (changesetCount > 0) {
    console.log('Added changesets:');
    addedChangesetFiles.forEach(file => console.log(`  - ${file}`));
  }

  // Ensure exactly one changeset file was added
  if (changesetCount === 0) {
    console.error("::error::No changeset found in this PR. Please add a changeset by running 'npm run changeset' and commit the result.");
    process.exit(1);
  } else if (changesetCount > 1) {
    console.error(`::error::Multiple changesets found in this PR (${changesetCount}). Each PR should add exactly ONE changeset.`);
    console.error('::error::Found changeset files added by this PR:');
    addedChangesetFiles.forEach(file => console.error(`  ${file}`));
    console.error('\n::error::Please combine these into a single changeset or remove the extras.');
    process.exit(1);
  }

  // Validate the single changeset file
  const changesetFile = join('.changeset', addedChangesetFiles[0]);
  console.log(`Validating changeset: ${changesetFile}`);

  const validation = validateChangesetFile(changesetFile);

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
