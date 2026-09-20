#!/usr/bin/env bun

/**
 * Instant version bump script for manual releases
 * Bypasses the changeset workflow and directly updates version and changelog
 *
 * Usage: node scripts/instant-version-bump.mjs --bump-type <major|minor|patch> [--description <description>] [--js-root <path>]
 *
 * Configuration:
 * - CLI: --js-root <path> to explicitly set JavaScript root
 * - Environment: JS_ROOT=<path>
 *
 * Uses link-foundation libraries:
 * - use-m: Dynamic package loading without package.json dependencies
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 *
 * Addresses issues documented in:
 * - Issue #21: Supporting both single and multi-language repository structures
 * - Reference: link-assistant/agent PR #112 (--legacy-peer-deps fix)
 * - Reference: link-assistant/agent PR #114 (configurable package root)
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  getJsRoot,
  getPackageJsonPath,
  needsCd,
  parseJsRootConfig,
} from './js-paths.mjs';

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
      })
      .option('js-root', {
        type: 'string',
        default: getenv('JS_ROOT', ''),
        describe:
          'JavaScript package root directory (auto-detected if not specified)',
      }),
});

// Store the original working directory to restore after cd commands
// IMPORTANT: command-stream's cd is a virtual command that calls process.chdir()
const originalCwd = process.cwd();

try {
  const { bumpType, description, jsRoot: jsRootArg } = config;

  // Get JavaScript package root (auto-detect or use explicit config)
  const jsRootConfig = jsRootArg || parseJsRootConfig();
  const jsRoot = getJsRoot({ jsRoot: jsRootConfig, verbose: true });

  const finalDescription = description || `Manual ${bumpType} release`;

  if (!bumpType || !['major', 'minor', 'patch'].includes(bumpType)) {
    console.error(
      'Usage: node scripts/instant-version-bump.mjs --bump-type <major|minor|patch> [--description <description>] [--js-root <path>]'
    );
    process.exit(1);
  }

  console.log(`\nBumping version (${bumpType})...`);

  // Get current version
  const packageJsonPath = getPackageJsonPath({ jsRoot });
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const oldVersion = packageJson.version;
  console.log(`Current version: ${oldVersion}`);

  // Bump version using npm version (doesn't create git tag)
  // IMPORTANT: cd is a virtual command that calls process.chdir(), so we restore after
  if (needsCd({ jsRoot })) {
    await $`cd ${jsRoot} && npm version ${bumpType} --no-git-tag-version`;
    process.chdir(originalCwd);
  } else {
    await $`npm version ${bumpType} --no-git-tag-version`;
  }

  // Get new version
  const updatedPackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const newVersion = updatedPackageJson.version;
  console.log(`New version: ${newVersion}`);

  // Update CHANGELOG.md
  console.log('\nUpdating CHANGELOG.md...');
  const changelogPath =
    jsRoot === '.' ? 'CHANGELOG.md' : join(jsRoot, 'CHANGELOG.md');
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
  console.log('✅ CHANGELOG.md updated');

  // Synchronize package-lock.json
  console.log('\nSynchronizing package-lock.json...');

  // Use --legacy-peer-deps to handle peer dependency conflicts
  // This addresses npm ERESOLVE errors documented in issue #111 / PR #112
  // IMPORTANT: cd is a virtual command that calls process.chdir(), so we restore after
  if (needsCd({ jsRoot })) {
    await $`cd ${jsRoot} && npm install --package-lock-only --legacy-peer-deps`;
    process.chdir(originalCwd);
  } else {
    await $`npm install --package-lock-only --legacy-peer-deps`;
  }

  console.log('\n✅ Instant version bump complete');
  console.log(`Version: ${oldVersion} → ${newVersion}`);
} catch (error) {
  // Restore cwd on error
  process.chdir(originalCwd);
  console.error('Error during instant version bump:', error.message);
  if (process.env.DEBUG) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
}
