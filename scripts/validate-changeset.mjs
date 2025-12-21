#!/usr/bin/env node

/**
 * Validate changeset for CI - ensures exactly one valid changeset exists in this PR
 *
 * This script compares against the base branch to find changesets added by this PR,
 * not the total count of changesets in the merge result.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const PACKAGE_NAME = '@link-assistant/hive-mind';

/**
 * Get changesets that were added in this PR (compared to base branch)
 */
function getAddedChangesets() {
  const changesetDir = '.changeset';

  // Get all current changeset files (excluding README.md and config.json)
  const currentChangesets = readdirSync(changesetDir).filter(file => file.endsWith('.md') && file !== 'README.md');

  // Try to get the base branch from GitHub Actions environment
  const baseBranch = process.env.GITHUB_BASE_REF;

  if (!baseBranch) {
    // Not in a PR context, just validate all changesets
    console.log('Not in PR context (GITHUB_BASE_REF not set), validating all changesets');
    return currentChangesets;
  }

  console.log(`Comparing against base branch: ${baseBranch}`);

  try {
    // Get changesets that exist on the base branch
    const baseChangesetsRaw = execSync(`git ls-tree -r --name-only origin/${baseBranch} -- .changeset/`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const baseChangesets = baseChangesetsRaw
      .split('\n')
      .map(f => f.replace('.changeset/', ''))
      .filter(f => f.endsWith('.md') && f !== 'README.md');

    console.log(`Base branch changesets: ${baseChangesets.join(', ') || '(none)'}`);

    // Find changesets that are new in this PR
    const addedChangesets = currentChangesets.filter(f => !baseChangesets.includes(f));

    console.log(`Changesets added in this PR: ${addedChangesets.join(', ') || '(none)'}`);

    return addedChangesets;
  } catch (error) {
    console.log(`Warning: Could not compare with base branch: ${error.message}`);
    console.log('Falling back to validating all current changesets');
    return currentChangesets;
  }
}

try {
  // Get changesets added by this PR
  const addedChangesets = getAddedChangesets();
  const changesetCount = addedChangesets.length;

  console.log(`Found ${changesetCount} changeset(s) added in this PR`);

  // Ensure exactly one changeset was added
  if (changesetCount === 0) {
    console.error("::error::No changeset found. Please add a changeset by running 'npm run changeset' and commit the result.");
    process.exit(1);
  } else if (changesetCount > 1) {
    console.error(`::error::Multiple changesets found (${changesetCount}). Each PR should have exactly ONE changeset.`);
    console.error('::error::Found changeset files:');
    addedChangesets.forEach(file => console.error(`  ${file}`));
    process.exit(1);
  }

  // Get the changeset file
  const changesetFile = join('.changeset', addedChangesets[0]);
  console.log(`Validating changeset: ${changesetFile}`);

  // Read the changeset file
  const content = readFileSync(changesetFile, 'utf-8');

  // Check if changeset has a valid type (major, minor, or patch)
  const versionTypeRegex = new RegExp(`^['"]${PACKAGE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]:\\s+(major|minor|patch)`, 'm');
  if (!versionTypeRegex.test(content)) {
    console.error('::error::Changeset must specify a version type: major, minor, or patch');
    console.error(`::error::Expected format in ${changesetFile}:`);
    console.error('::error::---');
    console.error(`::error::'${PACKAGE_NAME}': patch`);
    console.error('::error::---');
    console.error('::error::');
    console.error('::error::Your description here');
    console.error('\nFile content:');
    console.error(content);
    process.exit(1);
  }

  // Extract description (everything after the closing ---) and check it's not empty
  const parts = content.split('---');
  if (parts.length < 3) {
    console.error('::error::Changeset must include a description of the changes');
    console.error("::error::The description should appear after the closing '---' in the changeset file");
    console.error(`::error::Current content of ${changesetFile}:`);
    console.error(content);
    process.exit(1);
  }

  const description = parts.slice(2).join('---').trim();
  if (!description) {
    console.error('::error::Changeset must include a description of the changes');
    console.error("::error::The description should appear after the closing '---' in the changeset file");
    console.error(`::error::Current content of ${changesetFile}:`);
    console.error(content);
    process.exit(1);
  }

  // Extract version type
  const versionTypeMatch = content.match(versionTypeRegex);
  const versionType = versionTypeMatch ? versionTypeMatch[1] : 'unknown';

  console.log('Changeset validation passed');
  console.log(`   Type: ${versionType}`);
  console.log(`   Description: ${description}`);
} catch (error) {
  console.error('Error during changeset validation:', error.message);
  if (process.env.DEBUG) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
}
