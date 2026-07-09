#!/usr/bin/env node

/**
 * Publish to npm using OIDC trusted publishing, with reliable failure detection.
 *
 * Usage: node scripts/publish-to-npm.mjs [--should-pull]
 *   --should-pull: Pull latest changes before publishing (used by the release job)
 *
 * Why this was rewritten (issue #2028, CI run 29035249489):
 *   The previous version ran `await $\`npm run changeset:publish\`` and treated
 *   the absence of a thrown error as success. command-stream's `$` does NOT throw
 *   on a non-zero exit code (see
 *   docs/dependencies-research/command-stream-issues/), so a failed publish was
 *   reported as `published=true`. On top of that, `changeset publish` can print
 *   "packages failed to publish" while still exiting 0. The combination produced
 *   a FALSE POSITIVE release: the job went green, `published_version` was set, and
 *   the downstream Docker "Wait for NPM package" jobs then failed after 5 minutes
 *   waiting for a version that was never published.
 *
 * This version:
 *   - Runs commands via child_process.spawn so the real exit code is always
 *     observed (mirrors scripts/npm-install-with-retry.mjs, issue #1903).
 *   - Scans the combined output for known failure patterns, because
 *     `changeset publish` masks the underlying npm exit code.
 *   - Verifies the version is actually live on npm AFTER a "successful" publish.
 *   - Fast-fails non-retryable authentication/registry errors with guidance.
 *   - Exposes its core as injectable, testable functions.
 *
 * Uses only Node built-ins so it has no dependency on node_modules state.
 */

import { readFileSync, appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { detectPublishFailure, isNonRetryableFailure, buildAuthFailureGuidance } from './publish-failure-classifier.mjs';

export const PACKAGE_NAME = '@link-assistant/hive-mind';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 10000; // 10 seconds

/**
 * Sleep for the specified milliseconds.
 * @param {number} ms
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Run a command, streaming output to the parent stdio while buffering it so the
 * text can be inspected. Always resolves with the real exit code — never throws
 * on a non-zero exit (that silent-failure behaviour is exactly what caused the
 * false-positive release this script now guards against).
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{spawner?: typeof spawn}} [opts]
 * @returns {Promise<{code:number, stdout:string, stderr:string, message:string}>}
 */
export const runCommand = (command, args, { spawner = spawn } = {}) =>
  new Promise(resolve => {
    const child = spawner(command, args, { stdio: ['inherit', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on('error', error => resolve({ code: 1, stdout, stderr, message: error.message }));
    child.on('close', code => resolve({ code: code ?? 1, stdout, stderr, message: '' }));
  });

/**
 * Append a key/value pair to the GitHub Actions output file.
 * @param {string} key
 * @param {string} value
 */
export function setOutput(key, value, { appender = appendFileSync, env = process.env, logger = console } = {}) {
  const outputFile = env.GITHUB_OUTPUT;
  if (outputFile) {
    logger.log(`Setting GitHub output: ${key}=${value}`);
    appender(outputFile, `${key}=${value}\n`);
    logger.log(`Output written to ${outputFile}`);
  } else {
    logger.log(`GITHUB_OUTPUT not set, would have set: ${key}=${value}`);
  }
}

/**
 * Decide whether a publish attempt succeeded, given the runner result.
 *
 * A publish is a SUCCESS only when BOTH signals agree:
 *   - the command exited 0, AND
 *   - the combined output contains no known failure pattern.
 *
 * Both checks are required: command-stream never throws on non-zero exit, and
 * `changeset publish` can print a failure while still exiting 0.
 *
 * @param {{code:number, stdout?:string, stderr?:string, message?:string}} result
 * @returns {{ok:boolean, reason?:string, output:string, nonRetryable:boolean}}
 */
export function analyzePublishResult(result) {
  const output = `${result.stdout || ''}\n${result.stderr || ''}\n${result.message || ''}`;
  const nonRetryable = isNonRetryableFailure(output);

  if (result.code !== 0) {
    return { ok: false, reason: `exit code ${result.code}`, output, nonRetryable };
  }

  const failurePattern = detectPublishFailure(output);
  if (failurePattern) {
    return { ok: false, reason: `failure pattern "${failurePattern}" in output`, output, nonRetryable };
  }

  return { ok: true, output, nonRetryable: false };
}

/**
 * Check whether a specific version is live on the npm registry.
 * @param {(command:string, args:string[]) => Promise<{code:number}>} runner
 * @param {string} version
 * @returns {Promise<boolean>}
 */
export async function isVersionPublished(runner, version) {
  const result = await runner('npm', ['view', `${PACKAGE_NAME}@${version}`, 'version']);
  return result.code === 0;
}

/**
 * Publish with retries, multi-layer failure detection, and post-publish
 * verification against the registry.
 *
 * @param {object} opts
 * @param {(command:string, args:string[]) => Promise<{code:number, stdout?:string, stderr?:string, message?:string}>} opts.runner
 * @param {string} opts.version
 * @param {number} [opts.maxRetries]
 * @param {number} [opts.retryDelayMs]
 * @param {(ms:number)=>Promise<void>} [opts.sleeper]
 * @param {Console} [opts.logger]
 * @returns {Promise<{ok:boolean, attempt?:number, reason?:string, nonRetryable?:boolean}>}
 */
export async function publishWithRetry({ runner, version, maxRetries = DEFAULT_MAX_RETRIES, retryDelayMs = DEFAULT_RETRY_DELAY_MS, sleeper = sleep, logger = console }) {
  let lastReason = 'unknown';
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    logger.log(`Publish attempt ${attempt} of ${maxRetries}...`);
    const result = await runner('npm', ['run', 'changeset:publish']);
    const analysis = analyzePublishResult(result);

    if (analysis.ok) {
      // Never trust the publish command alone — verify the version is really on
      // the registry. This is the last line of defence against a false-positive
      // release (the exact failure mode of run 29035249489).
      logger.log(`Publish command reported success; verifying ${PACKAGE_NAME}@${version} on npm...`);
      const published = await isVersionPublished(runner, version);
      if (published) {
        logger.log(`Verified ${PACKAGE_NAME}@${version} is live on npm`);
        return { ok: true, attempt };
      }
      lastReason = 'post-publish verification failed: version not found on npm';
      logger.error(`WARNING: ${lastReason}`);
    } else {
      lastReason = analysis.reason;
      logger.error(`Publish attempt ${attempt} failed: ${analysis.reason}`);

      if (analysis.nonRetryable) {
        logger.error(buildAuthFailureGuidance(PACKAGE_NAME));
        return { ok: false, attempt, reason: analysis.reason, nonRetryable: true };
      }
    }

    if (attempt < maxRetries) {
      logger.log(`Waiting ${retryDelayMs / 1000}s before retry...`);
      await sleeper(retryDelayMs);
    }
  }

  return { ok: false, reason: lastReason, nonRetryable: false };
}

/**
 * Read the version to publish from package.json.
 * @param {string} [path]
 * @returns {string}
 */
export function readCurrentVersion(path = './package.json') {
  const packageJson = JSON.parse(readFileSync(path, 'utf8'));
  return packageJson.version;
}

/**
 * Full publish flow, with injectable dependencies for testing.
 * @param {object} opts
 * @param {(command:string, args:string[]) => Promise<{code:number, stdout?:string, stderr?:string, message?:string}>} opts.runner
 * @param {boolean} opts.shouldPull
 * @param {string} opts.version
 * @param {(key:string, value:string)=>void} [opts.output]
 * @param {(ms:number)=>Promise<void>} [opts.sleeper]
 * @param {Console} [opts.logger]
 * @returns {Promise<{published:boolean, alreadyPublished?:boolean, reason?:string}>}
 */
export async function runPublishFlow({ runner, shouldPull, version, output = setOutput, sleeper = sleep, logger = console }) {
  if (shouldPull) {
    // Pull the changes the version-bump commit just pushed.
    const pullResult = await runner('git', ['pull', 'origin', 'main']);
    if (pullResult.code !== 0) {
      throw new Error(`git pull origin main failed with exit code ${pullResult.code}`);
    }
  }

  logger.log(`Current version to publish: ${version}`);

  // Skip publishing if this version is already on npm (idempotent re-runs).
  logger.log(`Checking if version ${version} is already published...`);
  if (await isVersionPublished(runner, version)) {
    logger.log(`Version ${version} is already published to npm`);
    output('published', 'true');
    output('published_version', version);
    output('already_published', 'true');
    return { published: true, alreadyPublished: true };
  }
  logger.log(`Version ${version} not found on npm, proceeding with publish...`);

  const result = await publishWithRetry({ runner, version, sleeper, logger });
  if (result.ok) {
    output('published', 'true');
    output('published_version', version);
    logger.log(`Published ${PACKAGE_NAME}@${version} to npm`);
    return { published: true };
  }

  output('published', 'false');
  logger.error(`Failed to publish ${PACKAGE_NAME}@${version}: ${result.reason}`);
  return { published: false, reason: result.reason };
}

async function main() {
  // Parse CLI arguments using lino-arguments (loaded via use-m).
  const { ensureUseM } = await import('../src/use-m-bootstrap.lib.mjs');
  const use = await ensureUseM();
  const { makeConfig } = await use('lino-arguments');

  const config = makeConfig({
    yargs: ({ yargs, getenv }) =>
      yargs.option('should-pull', {
        type: 'boolean',
        default: getenv('SHOULD_PULL', false),
        describe: 'Pull latest changes before publishing',
      }),
  });

  const version = readCurrentVersion();
  const { published } = await runPublishFlow({
    runner: runCommand,
    shouldPull: config.shouldPull,
    version,
  });

  if (!published) {
    process.exit(1);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('publish-to-npm.mjs');
if (isMain) {
  main().catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
  });
}
