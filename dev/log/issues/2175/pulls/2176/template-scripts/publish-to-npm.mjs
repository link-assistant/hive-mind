#!/usr/bin/env bun

/**
 * Publish to npm using OIDC trusted publishing
 * Usage: node scripts/publish-to-npm.mjs [--should-pull] [--js-root <path>]
 *   should_pull: Optional flag to pull latest changes before publishing (for release job)
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
 * Supports both single and multi-language repository structures via a
 * configurable package root.
 */

import { appendFileSync } from 'fs';

import { getJsRoot, needsCd, parseJsRootConfig } from './js-paths.mjs';
import { isPackageVersionPublished } from './npm-registry.mjs';
import { readPackageInfo } from './package-info.mjs';
import {
  buildAuthFailureGuidance,
  isNonRetryableFailure,
} from './publish-failure-classifier.mjs';
import {
  isAlreadyPublishedError,
  publishWithRetry,
  sleep,
} from './publish-retry.mjs';

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
      .option('should-pull', {
        type: 'boolean',
        default: getenv('SHOULD_PULL', false),
        describe: 'Pull latest changes before publishing',
      })
      .option('js-root', {
        type: 'string',
        default: getenv('JS_ROOT', ''),
        describe:
          'JavaScript package root directory (auto-detected if not specified)',
      }),
});

const { shouldPull, jsRoot: jsRootArg } = config;

// Get JavaScript package root (auto-detect or use explicit config)
const jsRootConfig = jsRootArg || parseJsRootConfig();
const jsRoot = getJsRoot({ jsRoot: jsRootConfig, verbose: true });

const MAX_RETRIES = 3;
const RETRY_DELAY = 10000; // 10 seconds

// Store the original working directory to restore after cd commands
// IMPORTANT: command-stream's cd is a virtual command that calls process.chdir()
const originalCwd = process.cwd();

// Patterns that indicate publish failure in changeset output
// Guards against false positives in CI/CD output parsing.
const FAILURE_PATTERNS = [
  'packages failed to publish',
  'error occurred while publishing',
  'npm error code E',
  'npm error 404',
  'npm error 401',
  'npm error 403',
  'Access token expired',
  'ENEEDAUTH',
];

/**
 * Check if the output contains any failure patterns
 * @param {string} output - Combined stdout and stderr
 * @returns {string|null} - The matched failure pattern or null if no failure detected
 */
function detectPublishFailure(output) {
  const lowerOutput = output.toLowerCase();
  for (const pattern of FAILURE_PATTERNS) {
    if (lowerOutput.includes(pattern.toLowerCase())) {
      return pattern;
    }
  }
  return null;
}

/**
 * Verify that a package version is published on npm
 * @param {string} packageName
 * @param {string} version
 * @returns {Promise<boolean>}
 */
function verifyPublished(packageName, version) {
  return isPackageVersionPublished(packageName, version);
}

/**
 * Append to GitHub Actions output file
 * @param {string} key
 * @param {string} value
 */
function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
}

/**
 * Run changeset:publish command with output capture
 * @param {Function} shell
 * @param {string} jsRoot
 * @param {string} originalCwd
 * @returns {Promise<{result: object|null, error: Error|null}>}
 */
async function runChangesetPublish(shell, jsRoot, originalCwd) {
  try {
    // Run changeset:publish from the js directory where package.json with this script exists
    // IMPORTANT: Use .run({ capture: true }) to capture output for failure detection
    // IMPORTANT: cd is a virtual command that calls process.chdir(), so we restore after
    if (needsCd({ jsRoot })) {
      const result = await shell`cd ${jsRoot} && npm run changeset:publish`.run(
        {
          capture: true,
        }
      );
      process.chdir(originalCwd);
      return { result, error: null };
    }
    const result = await shell`npm run changeset:publish`.run({
      capture: true,
    });
    return { result, error: null };
  } catch (error) {
    // Restore cwd on error before retry
    if (needsCd({ jsRoot })) {
      process.chdir(originalCwd);
    }
    return { result: null, error };
  }
}

/**
 * Analyze publish result for failures using multi-layer detection
 * @param {object|null} publishResult - The result from runChangesetPublish
 * @param {Error|null} commandError - Error thrown by the command
 * @returns {Error|null} - Error if failure detected, null otherwise
 */
function analyzePublishResult(publishResult, commandError) {
  if (commandError) {
    return commandError;
  }

  const combinedOutput = publishResult
    ? `${publishResult.stdout || ''}\n${publishResult.stderr || ''}`
    : '';

  // Log the output for debugging
  if (combinedOutput.trim()) {
    console.log('Changeset output:', combinedOutput);
  }

  // Check for failure patterns in output (most reliable for changeset)
  const failurePattern = detectPublishFailure(combinedOutput);
  if (failurePattern) {
    console.error(`Detected publish failure: "${failurePattern}"`);
    return new Error(`Publish failed: detected "${failurePattern}" in output`);
  }

  // Check exit code (if available and non-zero)
  if (publishResult && publishResult.code !== 0) {
    console.error(`Changeset exited with code ${publishResult.code}`);
    return new Error(`Publish failed with exit code ${publishResult.code}`);
  }

  return null;
}

/**
 * Run a single publish command invocation (no verification).
 * Verification is a separate failure domain handled by publishWithRetry.
 * @param {Function} shell
 * @param {string} jsRoot
 * @param {string} originalCwd
 * @returns {Promise<{success: boolean, error: Error|null, output: string}>}
 */
async function runPublishCommand(shell, jsRoot, originalCwd) {
  const { result, error } = await runChangesetPublish(
    shell,
    jsRoot,
    originalCwd
  );
  const analysisError = analyzePublishResult(result, error);
  const output = [
    analysisError?.message || '',
    result?.stdout || '',
    result?.stderr || '',
  ].join('\n');

  if (analysisError) {
    // Mark authentication / registry-configuration failures as non-retryable so
    // the retry loop can fail fast with actionable guidance without burning
    // through MAX_RETRIES.
    if (!isAlreadyPublishedError(output) && isNonRetryableFailure(output)) {
      analysisError.nonRetryable = true;
    }
    return { success: false, error: analysisError, output };
  }

  return { success: true, error: null, output };
}

async function main() {
  try {
    if (shouldPull) {
      // Pull the latest changes we just pushed
      await $`git pull origin main`;
    }

    // Get current version
    const { name: packageName, version: currentVersion } = readPackageInfo({
      jsRoot,
    });
    console.log(`Package to publish: ${packageName}`);
    console.log(`Current version to publish: ${currentVersion}`);

    // Check if this version is already published on npm
    console.log(
      `Checking if version ${currentVersion} is already published...`
    );
    const isAlreadyPublished = await isPackageVersionPublished(
      packageName,
      currentVersion
    );

    if (isAlreadyPublished) {
      console.log(`Version ${currentVersion} is already published to npm`);
      setOutput('published', 'true');
      setOutput('published_version', currentVersion);
      setOutput('already_published', 'true');
      return;
    }

    // Version not found on npm (E404), proceed with publish
    console.log(
      `Version ${currentVersion} not found on npm, proceeding with publish...`
    );

    // Publish to npm using OIDC trusted publishing with retry logic
    // Multi-layer failure detection guards against a publish command that
    // reports success without actually publishing.
    //
    // The publish command is retried only when the publish itself failed.
    // A verification miss is handled by bounded polling and never triggers a
    // republish.
    const { success, error } = await publishWithRetry({
      publish: () => runPublishCommand($, jsRoot, originalCwd),
      verify: () => verifyPublished(packageName, currentVersion),
      maxRetries: MAX_RETRIES,
      retryDelay: RETRY_DELAY,
      sleepFn: sleep,
      log: (message) => console.log(message),
    });

    if (success) {
      setOutput('published', 'true');
      setOutput('published_version', currentVersion);
      console.log(`\u2705 Published ${packageName}@${currentVersion} to npm`);
      return;
    }

    console.error(`\u274C Publish failed: ${error.message}`);
    // Authentication / registry-configuration errors will not be fixed by
    // retrying, so print actionable guidance for the operator.
    if (error?.nonRetryable && !error?.verificationFailed) {
      console.error(buildAuthFailureGuidance(packageName));
    }
    process.exit(1);
  } catch (error) {
    // Restore cwd on error
    process.chdir(originalCwd);
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
