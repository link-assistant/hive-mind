#!/usr/bin/env node

/**
 * Validate changeset for CI - ensures exactly one valid changeset exists
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const PACKAGE_NAME = '@link-assistant/hive-mind';

try {
  // Count changeset files (excluding README.md and config.json)
  const changesetDir = '.changeset';
  const changesetFiles = readdirSync(changesetDir).filter(
    (file) => file.endsWith('.md') && file !== 'README.md'
  );

  const changesetCount = changesetFiles.length;
  console.log(`Found ${changesetCount} changeset file(s)`);

  // Ensure exactly one changeset file exists
  if (changesetCount === 0) {
    console.error(
      "::error::No changeset found. Please add a changeset by running 'npm run changeset' and commit the result."
    );
    process.exit(1);
  } else if (changesetCount > 1) {
    console.error(
      `::error::Multiple changesets found (${changesetCount}). Each PR should have exactly ONE changeset.`
    );
    console.error('::error::Found changeset files:');
    changesetFiles.forEach((file) => console.error(`  ${file}`));
    process.exit(1);
  }

  // Get the changeset file
  const changesetFile = join(changesetDir, changesetFiles[0]);
  console.log(`Validating changeset: ${changesetFile}`);

  // Read the changeset file
  const content = readFileSync(changesetFile, 'utf-8');

  // Check if changeset has a valid type (major, minor, or patch)
  const versionTypeRegex = new RegExp(
    `^['"]${PACKAGE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]:\\s+(major|minor|patch)`,
    'm'
  );
  if (!versionTypeRegex.test(content)) {
    console.error(
      '::error::Changeset must specify a version type: major, minor, or patch'
    );
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
    console.error(
      '::error::Changeset must include a description of the changes'
    );
    console.error(
      "::error::The description should appear after the closing '---' in the changeset file"
    );
    console.error(`::error::Current content of ${changesetFile}:`);
    console.error(content);
    process.exit(1);
  }

  const description = parts.slice(2).join('---').trim();
  if (!description) {
    console.error(
      '::error::Changeset must include a description of the changes'
    );
    console.error(
      "::error::The description should appear after the closing '---' in the changeset file"
    );
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
