#!/usr/bin/env node
import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';
import { pinnedVariantSpecs, waitUntilInstallable } from './npm-installable.lib.mjs';
import { runCommand, sleep } from './publish-to-npm.mjs';

/**
 * Wait for NPM package availability
 * Usage: node scripts/wait-for-npm.mjs --release-version <version>
 *   release-version: Version number to wait for (e.g., 1.0.0)
 *
 * This script waits for a specific version of @link-assistant/hive-mind
 * to become available on the npm registry. This is necessary because there
 * can be a delay between publishing and availability. Both the version metadata
 * and the tarball download must succeed (issue #2404), and so must every native
 * variant version the package pins as an optional dependency (issue #4055).
 * HIVE_MIND_PUBLISH_VERBOSE=true shows the raw `npm view` output.
 *
 * Uses link-foundation libraries:
 * - use-m: Dynamic package loading without package.json dependencies
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 */

const PACKAGE_NAME = '@link-assistant/hive-mind';

// Load use-m dynamically
const use = await ensureUseM();

// Import link-foundation libraries
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

console.log(`Waiting for NPM package ${PACKAGE_NAME}@${version} to become available...`);

const quiet = process.env.HIVE_MIND_PUBLISH_VERBOSE !== 'true';
const options = { runner: runCommand, sleeper: sleep, attempts: maxAttempts, delayMs: sleepTime * 1000, maxDelayMs: sleepTime * 1000, quiet };
if ((await waitUntilInstallable([`${PACKAGE_NAME}@${version}`], options)).length) {
  console.error(`Package ${PACKAGE_NAME}@${version} did not become available after ${maxAttempts * sleepTime} seconds`);
  process.exit(1);
}
console.log(`Package ${PACKAGE_NAME}@${version} is now available on NPM!`);

// Issue #4055 (F9): npm and Bun silently skip an optional dependency they cannot
// resolve yet, so the image would install without its native Codex variant and
// fail in install-native-codex.mjs. Wait for every variant this version pins.
const pinned = await runCommand('npm', ['view', `${PACKAGE_NAME}@${version}`, 'optionalDependencies', '--json'], { quiet });
let optionalDependencies = {};
try {
  optionalDependencies = pinned.code === 0 && pinned.stdout.trim() ? JSON.parse(pinned.stdout) : {};
} catch {
  console.error(`Could not read the optional dependencies of ${PACKAGE_NAME}@${version}: ${pinned.stdout}`);
  process.exit(1);
}
const variants = pinnedVariantSpecs(PACKAGE_NAME, optionalDependencies);
if (variants.length) {
  console.log(`Waiting for the ${variants.length} native variant versions ${PACKAGE_NAME}@${version} pins: ${variants.join(', ')}`);
  const missing = await waitUntilInstallable(variants, options);
  if (missing.length) {
    console.error(`::error title=native variant not installable::${missing.join(', ')} did not become installable after ${maxAttempts * sleepTime} seconds; an image built now would lack it.`);
    process.exit(1);
  }
}
