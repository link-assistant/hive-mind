#!/usr/bin/env node

/**
 * Wait for NPM package availability
 * Usage: node scripts/wait-for-npm.mjs --release-version <version>
 *   release-version: Version number to wait for (e.g., 1.0.0)
 *
 * This script waits for a specific version of @link-assistant/hive-mind
 * to become available on the npm registry. This is necessary because there
 * can be a delay between publishing and availability.
 *
 * Uses link-foundation libraries:
 * - use-m: Dynamic package loading without package.json dependencies
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 */

const PACKAGE_NAME = '@link-assistant/hive-mind';

// Load use-m dynamically
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Import link-foundation libraries
const { $ } = await use('command-stream');
const { makeConfig } = await use('lino-arguments');

// Parse CLI arguments using lino-arguments
// Note: Using --release-version instead of --version to avoid conflict with yargs' built-in --version flag
const config = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs
      .option('release-version', {
        type: 'string',
        default: getenv('VERSION', ''),
        describe: 'Version number to wait for (e.g., 1.0.0)',
      })
      .option('max-attempts', {
        type: 'number',
        default: getenv('MAX_ATTEMPTS', 30),
        describe: 'Maximum number of attempts to check npm',
      })
      .option('sleep-time', {
        type: 'number',
        default: getenv('SLEEP_TIME', 10),
        describe: 'Seconds to wait between attempts',
      }),
});

const { releaseVersion: version, maxAttempts, sleepTime } = config;

if (!version) {
  console.error('Error: Version is required');
  console.error('Usage: node scripts/wait-for-npm.mjs --release-version <version>');
  process.exit(1);
}

/**
 * Sleep for specified seconds
 * @param {number} seconds
 */
function sleep(seconds) {
  return new Promise(resolve => globalThis.setTimeout(resolve, seconds * 1000));
}

console.log(`Waiting for NPM package ${PACKAGE_NAME}@${version} to become available...`);

for (let i = 1; i <= maxAttempts; i++) {
  console.log(`Attempt ${i}/${maxAttempts}: Checking NPM registry...`);

  try {
    const result = await $`npm view "${PACKAGE_NAME}@${version}" version`.run({ capture: true });

    if (result.code === 0) {
      console.log(`Package ${PACKAGE_NAME}@${version} is now available on NPM!`);
      process.exit(0);
    }
  } catch (_error) {
    // Package not found yet, continue waiting
  }

  if (i < maxAttempts) {
    console.log(`Package not yet available, waiting ${sleepTime} seconds...`);
    await sleep(sleepTime);
  }
}

console.error(`Package ${PACKAGE_NAME}@${version} did not become available after ${maxAttempts * sleepTime} seconds`);
process.exit(1);
