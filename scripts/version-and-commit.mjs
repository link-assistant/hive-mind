#!/usr/bin/env node
import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';

/**
 * Version packages and commit to main
 * Usage: node scripts/version-and-commit.mjs --mode <changeset|instant> [--bump-type <type>] [--description <desc>]
 *   changeset: Run changeset version
 *   instant: Run instant version bump with bump_type (patch|minor|major) and optional description
 *
 * The logic lives in scripts/version-and-commit.lib.mjs so it can be unit-tested
 * (see tests/version-and-commit-2082.test.mjs). This file only parses arguments.
 *
 * Set HIVE_MIND_CI_VERBOSE=1 to trace every command and its exit code.
 *
 * Uses link-foundation libraries:
 * - use-m: Dynamic package loading without package.json dependencies
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 */

import { appendFileSync, readdirSync } from 'node:fs';

import { isVerbose } from './run-command.lib.mjs';
import { versionAndCommit } from './version-and-commit.lib.mjs';

// Load use-m dynamically
const use = await ensureUseM();

// Import link-foundation libraries
const { makeConfig } = await use('lino-arguments');

// Parse CLI arguments using lino-arguments
const config = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs
      .option('mode', {
        type: 'string',
        default: getenv('MODE', 'changeset'),
        describe: 'Version mode: changeset or instant',
        choices: ['changeset', 'instant'],
      })
      .option('bump-type', {
        type: 'string',
        default: getenv('BUMP_TYPE', ''),
        describe: 'Version bump type for instant mode: major, minor, or patch',
      })
      .option('description', {
        type: 'string',
        default: getenv('DESCRIPTION', ''),
        describe: 'Description for instant version bump',
      }),
});

const { mode, bumpType, description } = config;

// Debug: Log parsed configuration
console.log('Parsed configuration:', {
  mode,
  bumpType,
  description: description || '(none)',
});

// Detect if positional arguments were used (common mistake)
const args = process.argv.slice(2);
if (args.length > 0 && !args[0].startsWith('--')) {
  console.error('Error: Positional arguments detected!');
  console.error('Command line arguments:', args);
  console.error('');
  console.error('This script requires named arguments (--mode, --bump-type, --description).');
  console.error('Usage:');
  console.error('  Changeset mode:');
  console.error('    node scripts/version-and-commit.mjs --mode changeset');
  console.error('  Instant mode:');
  console.error('    node scripts/version-and-commit.mjs --mode instant --bump-type <major|minor|patch> [--description <desc>]');
  console.error('');
  console.error('Examples:');
  console.error('  node scripts/version-and-commit.mjs --mode instant --bump-type patch --description "Fix bug"');
  console.error('  node scripts/version-and-commit.mjs --mode changeset');
  process.exit(1);
}

// Validation: Ensure mode is set correctly
if (mode !== 'changeset' && mode !== 'instant') {
  console.error(`Invalid mode: "${mode}". Expected "changeset" or "instant".`);
  console.error('Command line arguments:', process.argv.slice(2));
  process.exit(1);
}

// Validation: Ensure bump type is provided for instant mode
if (mode === 'instant' && !bumpType) {
  console.error('Error: --bump-type is required for instant mode');
  console.error('Usage: node scripts/version-and-commit.mjs --mode instant --bump-type <major|minor|patch> [--description <desc>]');
  process.exit(1);
}

/**
 * Append to GitHub Actions output file
 * @param {string} key
 * @param {string} value
 */
function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    console.log(`Setting GitHub output: ${key}=${value}`);
    appendFileSync(outputFile, `${key}=${value}\n`);
    console.log(`Output written to ${outputFile}`);
  } else {
    console.log(`GITHUB_OUTPUT not set, would have set: ${key}=${value}`);
  }
}

/**
 * Count changeset files (excluding README.md)
 */
function countChangesets() {
  try {
    return readdirSync('.changeset').filter(f => f.endsWith('.md') && f !== 'README.md').length;
  } catch {
    return 0;
  }
}

try {
  await versionAndCommit({
    mode,
    bumpType,
    description,
    output: setOutput,
    countChangesets,
    verbose: isVerbose(),
  });
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
