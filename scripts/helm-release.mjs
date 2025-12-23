#!/usr/bin/env node

/**
 * Helm chart release script
 * Usage: node scripts/helm-release.mjs --release-version <version>
 *   release-version: Version number (e.g., 1.0.0)
 *
 * This script packages and publishes the Helm chart to the gh-pages branch.
 * It expects Helm to be installed and Git to be configured.
 *
 * Uses link-foundation libraries:
 * - use-m: Dynamic package loading without package.json dependencies
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 */

import { readFileSync, writeFileSync } from 'fs';

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
      }),
});

const { releaseVersion: version, helmRepoUrl, githubActor } = config;

if (!version) {
  console.error('Error: Version is required');
  console.error('Usage: node scripts/helm-release.mjs --release-version <version>');
  process.exit(1);
}

const CHART_PATH = 'helm/hive-mind/Chart.yaml';

try {
  console.log(`Releasing Helm chart version ${version}...`);

  // Configure Git
  await $`git config user.name "${githubActor}"`;
  await $`git config user.email "${githubActor}@users.noreply.github.com"`;

  // Update Chart.yaml with new version
  console.log(`Updating Chart.yaml to version ${version}...`);
  let chartContent = readFileSync(CHART_PATH, 'utf8');
  chartContent = chartContent.replace(/^appVersion: .*/m, `appVersion: "${version}"`);
  chartContent = chartContent.replace(/^version: .*/m, `version: ${version}`);
  writeFileSync(CHART_PATH, chartContent);
  console.log('Updated Chart.yaml:');
  console.log(readFileSync(CHART_PATH, 'utf8'));

  // Lint the chart
  console.log('');
  console.log('Linting Helm chart...');
  await $`helm lint helm/hive-mind`;

  // Package the chart
  console.log('');
  console.log('Packaging Helm chart...');
  await $`mkdir -p .helm-packages`;
  await $`helm package helm/hive-mind -d .helm-packages`;
  await $`ls -la .helm-packages/`;

  // Ensure gh-pages branch exists
  console.log('');
  console.log('Checking gh-pages branch...');
  const branchCheckResult = await $`git ls-remote --exit-code --heads origin gh-pages`.run({ capture: true });

  if (branchCheckResult.code !== 0) {
    console.log('Creating gh-pages branch...');
    await $`git checkout --orphan gh-pages`;
    await $`git reset --hard`;
    await $`git commit --allow-empty -m "Initialize gh-pages branch for Helm charts"`;
    await $`git push origin gh-pages`;
    await $`git checkout -`;
  }

  // Checkout gh-pages branch
  console.log('');
  console.log('Checking out gh-pages branch...');
  await $`git fetch origin gh-pages:gh-pages`;
  await $`git checkout gh-pages`;

  // Update Helm repository index
  console.log('');
  console.log('Updating Helm repository index...');
  await $`cp .helm-packages/*.tgz .`;
  await $`helm repo index . --url "${helmRepoUrl}"`;
  console.log('Index updated:');
  console.log(readFileSync('index.yaml', 'utf8'));

  // Commit and push
  console.log('');
  console.log('Committing and pushing to gh-pages...');
  await $`git add -f *.tgz index.yaml`;

  const commitResult = await $`git commit -m "Release Helm chart version ${version}"`.run({ capture: true });
  if (commitResult.code !== 0) {
    console.log('No changes to commit');
  }

  await $`git push origin gh-pages`;

  // Switch back
  console.log('');
  console.log('Switching back to previous branch...');
  await $`git checkout -`;

  console.log('');
  console.log(`Helm chart version ${version} released successfully!`);
} catch (error) {
  console.error('Error releasing Helm chart:', error.message);
  process.exit(1);
}
