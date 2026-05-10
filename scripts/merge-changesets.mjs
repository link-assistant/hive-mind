#!/usr/bin/env node

/**
 * Harmonize multiple changeset files for a clean release
 *
 * Key behavior:
 * - Keeps each changeset as a SEPARATE file so @changesets/cli produces separate bullet items
 * - Promotes all changesets to the highest version bump type (major > minor > patch)
 * - Does nothing if there's only one or no changesets
 *
 * Previously this script merged all descriptions into a single changeset file,
 * which caused @changesets/cli to produce a single bullet entry with all text
 * merged together. See: docs/case-studies/issue-1452/
 *
 * This script is run before `changeset version` to ensure a clean release
 * even when multiple PRs have merged before a release cycle.
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';

const PACKAGE_NAME = '@link-assistant/hive-mind';
const CHANGESET_DIR = '.changeset';

// Version bump type priority (higher number = higher priority)
const BUMP_PRIORITY = {
  patch: 1,
  minor: 2,
  major: 3,
};

/**
 * Parse a changeset file and extract its metadata
 * @param {string} filePath
 * @returns {{type: string, description: string, mtime: Date} | null}
 */
function parseChangeset(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const stats = statSync(filePath);

    // Extract version type
    const versionTypeRegex = new RegExp(`^['"]${PACKAGE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]:\\s+(major|minor|patch)`, 'm');
    const versionTypeMatch = content.match(versionTypeRegex);

    if (!versionTypeMatch) {
      console.warn(`Warning: Could not parse version type from ${filePath}, skipping`);
      return null;
    }

    // Extract description (everything after the second ---)
    const parts = content.split('---');
    const description = parts.length >= 3 ? parts.slice(2).join('---').trim() : '';

    return {
      type: versionTypeMatch[1],
      description,
      mtime: stats.mtime,
      rawContent: content,
    };
  } catch (error) {
    console.warn(`Warning: Failed to parse ${filePath}: ${error.message}`);
    return null;
  }
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
 * Create a changeset file content with the given type and description
 * @param {string} type
 * @param {string} description
 * @returns {string}
 */
function createChangesetContent(type, description) {
  return `---
'${PACKAGE_NAME}': ${type}
---

${description}
`;
}

function main() {
  console.log('Checking for multiple changesets to harmonize...');

  // Get all changeset files
  const changesetFiles = readdirSync(CHANGESET_DIR).filter(file => file.endsWith('.md') && file !== 'README.md');

  console.log(`Found ${changesetFiles.length} changeset file(s)`);

  // If 0 or 1 changesets, nothing to harmonize
  if (changesetFiles.length <= 1) {
    console.log('No harmonization needed (0 or 1 changeset found)');
    return;
  }

  console.log('Multiple changesets found, harmonizing bump types...');
  changesetFiles.forEach(file => console.log(`  - ${file}`));

  // Parse all changesets
  const parsedChangesets = [];
  for (const file of changesetFiles) {
    const filePath = join(CHANGESET_DIR, file);
    const parsed = parseChangeset(filePath);
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

  // Determine the highest bump type
  const bumpTypes = parsedChangesets.map(c => c.type);
  const highestBumpType = getHighestBumpType(bumpTypes);
  const allSameType = bumpTypes.every(t => t === highestBumpType);

  console.log(`\nHarmonize summary:`);
  console.log(`  Bump types found: ${[...new Set(bumpTypes)].join(', ')}`);
  console.log(`  Highest bump type: ${highestBumpType}`);
  console.log(`  Changeset count: ${parsedChangesets.length}`);

  if (allSameType) {
    console.log('\nAll changesets already have the same bump type. No changes needed.');
    console.log('Each changeset will produce a separate entry in the changelog.');
    return;
  }

  // Promote changesets that have a lower bump type to the highest
  console.log(`\nPromoting changesets to ${highestBumpType}...`);

  for (const changeset of parsedChangesets) {
    if (changeset.type !== highestBumpType) {
      const newContent = createChangesetContent(highestBumpType, changeset.description);
      writeFileSync(changeset.filePath, newContent);
      console.log(`  Promoted ${changeset.file}: ${changeset.type} -> ${highestBumpType}`);
    } else {
      console.log(`  Kept ${changeset.file}: already ${highestBumpType}`);
    }
  }

  console.log('\nChangeset harmonization completed successfully');
  console.log(`Each of the ${parsedChangesets.length} changesets will produce a separate entry in the changelog.`);
}

main();
