#!/usr/bin/env node

/**
 * Instant version bump script for manual releases
 * Bypasses the changeset workflow and directly updates version and changelog
 *
 * Usage: node scripts/instant-version-bump.mjs --bump-type <major|minor|patch> [--description <description>]
 *
 * Uses link-foundation libraries:
 * - use-m: Dynamic package loading without package.json dependencies
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 */

import { readFileSync, writeFileSync } from 'fs';

// Load use-m dynamically
const { use } = eval(
  await (await fetch('https://unpkg.com/use-m/use.js')).text()
);

// Import link-foundation libraries
const { $ } = await use('command-stream');
const { makeConfig } = await use('lino-arguments');

// Parse CLI arguments using lino-arguments
const config = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs
      .option('bump-type', {
        type: 'string',
        default: getenv('BUMP_TYPE', ''),
        describe: 'Version bump type: major, minor, or patch',
        choices: ['major', 'minor', 'patch'],
      })
      .option('description', {
        type: 'string',
        default: getenv('DESCRIPTION', ''),
        describe: 'Description for the version bump',
      }),
});

try {
  const { bumpType, description } = config;
  const finalDescription = description || `Manual ${bumpType} release`;

  if (!bumpType || !['major', 'minor', 'patch'].includes(bumpType)) {
    console.error(
      'Usage: node scripts/instant-version-bump.mjs --bump-type <major|minor|patch> [--description <description>]'
    );
    process.exit(1);
  }

  console.log(`\nBumping version (${bumpType})...`);

  // Get current version
  const packageJson = JSON.parse(readFileSync('package.json', 'utf-8'));
  const oldVersion = packageJson.version;
  console.log(`Current version: ${oldVersion}`);

  // Bump version using npm version (doesn't create git tag)
  await $`npm version ${bumpType} --no-git-tag-version`;

  // Get new version
  const updatedPackageJson = JSON.parse(readFileSync('package.json', 'utf-8'));
  const newVersion = updatedPackageJson.version;
  console.log(`New version: ${newVersion}`);

  // Update CHANGELOG.md
  console.log('\nUpdating CHANGELOG.md...');
  const changelogPath = 'CHANGELOG.md';
  let changelog = readFileSync(changelogPath, 'utf-8');

  // Create new changelog entry
  const newEntry = `## ${newVersion}

### ${bumpType.charAt(0).toUpperCase() + bumpType.slice(1)} Changes

- ${finalDescription}

`;

  // Insert new entry after the first heading (# Changelog or similar)
  // Look for the first ## heading and insert before it
  const firstVersionMatch = changelog.match(/^## /m);

  if (firstVersionMatch) {
    const insertPosition = firstVersionMatch.index;
    changelog =
      changelog.slice(0, insertPosition) +
      newEntry +
      changelog.slice(insertPosition);
  } else {
    // If no version headings exist, append after the main heading
    const mainHeadingMatch = changelog.match(/^# .+$/m);
    if (mainHeadingMatch) {
      const insertPosition =
        mainHeadingMatch.index + mainHeadingMatch[0].length;
      changelog = `${changelog.slice(0, insertPosition)}\n\n${newEntry}${changelog.slice(insertPosition)}`;
    } else {
      // If no headings at all, prepend
      changelog = `${newEntry}\n${changelog}`;
    }
  }

  writeFileSync(changelogPath, changelog, 'utf-8');
  console.log('CHANGELOG.md updated');

  // Synchronize package-lock.json
  console.log('\nSynchronizing package-lock.json...');
  await $`npm install --package-lock-only`;

  console.log('\nInstant version bump complete');
  console.log(`Version: ${oldVersion} -> ${newVersion}`);
} catch (error) {
  console.error('Error during instant version bump:', error.message);
  if (process.env.DEBUG) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
}
