#!/usr/bin/env node

/**
 * Helm chart release script
 * Usage: node scripts/helm-release.mjs --release-version <version>
 *   release-version: Version number (e.g., 1.0.0)
 *
 * This script packages and publishes the Helm chart to the gh-pages branch.
 * It expects Helm to be installed and Git to be configured.
 *
 * The logic lives in scripts/helm-release.lib.mjs so it can be unit-tested
 * (see tests/helm-release-2082.test.mjs). This file only parses arguments.
 *
 * Set HIVE_MIND_CI_VERBOSE=1 to trace every command and its exit code.
 */

import { isVerbose } from './run-command.lib.mjs';
import { releaseHelmChart } from './helm-release.lib.mjs';

import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';

const use = await ensureUseM();
const { makeConfig } = await use('lino-arguments');

// Note: Using --release-version instead of --version to avoid conflict with yargs' built-in --version flag
const config = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs
      .option('release-version', {
        type: 'string',
        default: getenv('VERSION', ''),
        describe: 'Version number (e.g., 1.0.0)',
      })
      .option('helm-repo-url', {
        type: 'string',
        default: getenv('HELM_REPO_URL', 'https://link-assistant.github.io/hive-mind'),
        describe: 'Helm repository URL',
      })
      .option('github-actor', {
        type: 'string',
        default: getenv('GITHUB_ACTOR', 'github-actions'),
        describe: 'GitHub username for Git commits',
      })
      .option('verbose', {
        type: 'boolean',
        default: isVerbose(),
        describe: 'Trace every command and its exit code',
      }),
});

const { releaseVersion: version, helmRepoUrl, githubActor, verbose } = config;

if (!version) {
  console.error('Error: Version is required');
  console.error('Usage: node scripts/helm-release.mjs --release-version <version>');
  process.exit(1);
}

try {
  await releaseHelmChart({ version, helmRepoUrl, githubActor, verbose });
} catch (error) {
  console.error('Error releasing Helm chart:', error.message);
  process.exit(1);
}
