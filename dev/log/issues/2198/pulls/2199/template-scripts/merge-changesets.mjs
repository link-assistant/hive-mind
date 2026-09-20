#!/usr/bin/env bun

/**
 * Merge multiple changeset files into a single changeset
 *
 * Key behavior:
 * - Combines all pending changesets into a single changeset file
 * - Uses the highest version bump type (major > minor > patch)
 * - Preserves all descriptions in chronological order (by file modification time)
 * - Removes the individual changeset files after merging
 * - Does nothing if there's only one or no changesets
 * - Fails if any changeset cannot be parsed
 *
 * This script is run before `changeset version` to ensure a clean release
 * even when multiple PRs have merged before a release cycle.
 */

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  statSync,
} from 'fs';
import { join } from 'path';

import { getChangesetDir, getJsRoot, parseJsRootConfig } from './js-paths.mjs';
import {
  formatChangesetHeader,
  getChangesetVersionTypeRegex,
  readPackageInfo,
} from './package-info.mjs';

// Version bump type priority (higher number = higher priority)
const BUMP_PRIORITY = {
  patch: 1,
  minor: 2,
  major: 3,
};

/**
 * Generate a random changeset file name (similar to what @changesets/cli does)
 * @returns {string}
 */
function generateChangesetName() {
  const adjectives = [
    'bright',
    'calm',
    'cool',
    'cyan',
    'dark',
    'fast',
    'gold',
    'good',
    'green',
    'happy',
    'kind',
    'loud',
    'neat',
    'nice',
    'pink',
    'proud',
    'quick',
    'red',
    'rich',
    'safe',
    'shy',
    'soft',
    'sweet',
    'tall',
    'warm',
    'wise',
    'young',
  ];
  const nouns = [
    'apple',
    'bird',
    'book',
    'car',
    'cat',
    'cloud',
    'desk',
    'dog',
    'door',
    'fish',
    'flower',
    'frog',
    'grass',
    'house',
    'key',
    'lake',
    'leaf',
    'moon',
    'mouse',
    'owl',
    'park',
    'rain',
    'river',
    'rock',
    'sea',
    'star',
    'sun',
    'tree',
    'wave',
    'wind',
  ];

  const randomAdjective =
    adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];

  return `${randomAdjective}-${randomNoun}`;
}

/**
 * Parse a changeset file and extract its metadata
 * @param {string} filePath
 * @param {string} packageName
 * @returns {{type: string, description: string, mtime: Date}}
 */
function parseChangeset(filePath, packageName) {
  let content;
  let stats;

  try {
    content = readFileSync(filePath, 'utf-8');
    stats = statSync(filePath);
  } catch (error) {
    throw new Error(`Failed to read ${filePath}: ${error.message}`);
  }

  // Extract version type - support both quoted and unquoted package names
  const versionTypeRegex = getChangesetVersionTypeRegex(packageName, {
    requireQuotes: false,
  });
  const versionTypeMatch = content.match(versionTypeRegex);

  if (!versionTypeMatch) {
    throw new Error(
      `Could not parse version type from ${filePath}. Expected a changeset header like ${formatChangesetHeader(
        packageName,
        'patch'
      )} with version type major, minor, or patch.`
    );
  }

  // Extract description
  const parts = content.split('---');
  const description =
    parts.length >= 3 ? parts.slice(2).join('---').trim() : '';

  return {
    type: versionTypeMatch[1],
    description,
    mtime: stats.mtime,
  };
}

/**
 * Get the highest priority bump type
 * @param {string[]} types
 * @returns {string}
 */
function getHighestBumpType(types) {
  let highest = 'patch';
  for (const type of types) {
    if (BUMP_PRIORITY[type] > BUMP_PRIORITY[highest]) {
      highest = type;
    }
  }
  return highest;
}

/**
 * Create a merged changeset file
 * @param {string} type
 * @param {string[]} descriptions
 * @param {string} packageName
 * @returns {string}
 */
function createMergedChangeset(type, descriptions, packageName) {
  const combinedDescription = descriptions.join('\n\n');

  return `---
${formatChangesetHeader(packageName, type)}
---

${combinedDescription}
`;
}

function main() {
  console.log('Checking for multiple changesets to merge...');
  const jsRootConfig = parseJsRootConfig();
  const jsRoot = getJsRoot({ jsRoot: jsRootConfig, verbose: true });
  const changesetDir = getChangesetDir({ jsRoot });
  const { name: packageName } = readPackageInfo({ jsRoot });
  console.log(`Package: ${packageName}`);

  // Get all changeset files
  const changesetFiles = readdirSync(changesetDir).filter(
    (file) => file.endsWith('.md') && file !== 'README.md'
  );

  console.log(`Found ${changesetFiles.length} changeset file(s)`);

  // If 0 or 1 changesets, nothing to merge
  if (changesetFiles.length <= 1) {
    console.log('No merging needed (0 or 1 changeset found)');
    return;
  }

  console.log('Multiple changesets found, merging...');
  changesetFiles.forEach((file) => console.log(`  - ${file}`));

  // Parse all changesets
  const parsedChangesets = [];
  for (const file of changesetFiles) {
    const filePath = join(changesetDir, file);
    const parsed = parseChangeset(filePath, packageName);
    if (parsed) {
      parsedChangesets.push({
        file,
        filePath,
        ...parsed,
      });
    }
  }

  if (parsedChangesets.length === 0) {
    console.error('Error: No valid changesets could be parsed');
    process.exit(1);
  }

  // Sort by modification time (oldest first) to preserve chronological order
  parsedChangesets.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

  // Determine the highest bump type
  const bumpTypes = parsedChangesets.map((c) => c.type);
  const highestBumpType = getHighestBumpType(bumpTypes);

  console.log(`\nMerge summary:`);
  console.log(`  Bump types found: ${[...new Set(bumpTypes)].join(', ')}`);
  console.log(`  Using highest: ${highestBumpType}`);

  // Collect descriptions in chronological order
  const descriptions = parsedChangesets
    .filter((c) => c.description)
    .map((c) => c.description);

  console.log(`  Descriptions to merge: ${descriptions.length}`);

  // Create merged changeset content
  const mergedContent = createMergedChangeset(
    highestBumpType,
    descriptions,
    packageName
  );

  // Generate a unique name for the merged changeset
  const mergedFileName = `merged-${generateChangesetName()}.md`;
  const mergedFilePath = join(changesetDir, mergedFileName);

  // Write the merged changeset
  writeFileSync(mergedFilePath, mergedContent);
  console.log(`\nCreated merged changeset: ${mergedFileName}`);

  // Remove the original changeset files
  console.log('\nRemoving original changeset files:');
  for (const changeset of parsedChangesets) {
    unlinkSync(changeset.filePath);
    console.log(`  Removed: ${changeset.file}`);
  }

  console.log('\nChangeset merge completed successfully');
  console.log(`\nMerged changeset content:\n${mergedContent}`);
}

try {
  main();
} catch (error) {
  console.error(`::error::${error.message}`);
  if (process.env.DEBUG) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
}
