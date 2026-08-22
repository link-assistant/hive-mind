/**
 * Helm chart release logic, with injectable dependencies so it is testable.
 *
 * Why this was rewritten (issue #2082, finding F1):
 *   The previous implementation ran every git command as a bare
 *   `await $\`...\`` using command-stream, whose `$` does NOT throw on a
 *   non-zero exit code. The wrapping try/catch could therefore never fire.
 *
 *   In production `git checkout gh-pages` aborted ("Your local changes to the
 *   following files would be overwritten by checkout: helm/hive-mind/Chart.yaml")
 *   because gh-pages also carries the repository tree and the script had just
 *   rewritten Chart.yaml. The failure was swallowed, the script kept running on
 *   `main`, committed the index onto main, pushed an unchanged gh-pages ref
 *   ("Everything up-to-date"), and printed "released successfully!". The public
 *   Helm repository stayed at 0.38.8 (2025-12-11) for ~7 months of green builds.
 *
 * This version:
 *   - Runs every command through `runStrict`, restoring `set -e` semantics.
 *   - Publishes from an isolated `git worktree` instead of switching branches
 *     in the dirty release checkout, removing the failure at its source.
 *   - Copies the archive next to index.yaml so its download URL resolves.
 *   - Verifies the pushed index really contains the released version, so any
 *     future regression is a red build rather than a silent no-op.
 *
 * Uses only Node built-ins so it has no dependency on node_modules state.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { runCommand, runStrict } from './run-command.lib.mjs';

/** Git's well-known hash of the empty tree, used to create an orphan branch without a checkout. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export const DEFAULT_CHART_DIR = 'helm/hive-mind';
export const DEFAULT_PACKAGE_DIR = '.helm-packages';
export const DEFAULT_WORKTREE_DIR = '.helm-gh-pages';
export const PUBLISH_BRANCH = 'gh-pages';

/**
 * Read the chart name out of a Chart.yaml document.
 * @param {string} chartYaml
 * @returns {string}
 */
export function parseChartName(chartYaml) {
  const match = chartYaml.match(/^name:\s*(\S+)/m);
  if (!match) {
    throw new Error('Could not determine chart name from Chart.yaml');
  }
  return match[1];
}

/**
 * Set `version` and `appVersion` in a Chart.yaml document.
 * @param {string} chartYaml
 * @param {string} version
 * @returns {string}
 */
export function updateChartVersion(chartYaml, version) {
  return chartYaml.replace(/^appVersion: .*/m, `appVersion: "${version}"`).replace(/^version: .*/m, `version: ${version}`);
}

/**
 * Whether a Helm repository index lists the given chart version.
 *
 * Matches only standalone `version:` keys, so `apiVersion:` and `appVersion:`
 * cannot produce a false positive.
 *
 * @param {string} indexYaml
 * @param {string} version
 * @returns {boolean}
 */
export function indexContainsVersion(indexYaml, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*-?\\s*version:\\s*["']?${escaped}["']?\\s*$`, 'm').test(indexYaml);
}

/**
 * Package and publish the Helm chart to the gh-pages branch.
 *
 * @param {object} opts
 * @param {string} opts.version
 * @param {string} opts.helmRepoUrl
 * @param {string} opts.githubActor
 * @param {string} [opts.chartDir]
 * @param {string} [opts.packageDir]
 * @param {string} [opts.worktreeDir]
 * @param {typeof runCommand} [opts.runner] Soft runner; failures become throws via runStrict.
 * @param {object} [opts.fs] Injectable filesystem (readFileSync/writeFileSync/existsSync/copyFileSync/mkdirSync/rmSync).
 * @param {Console} [opts.logger]
 * @param {boolean} [opts.verbose]
 * @returns {Promise<{published: boolean, version: string, chartName: string, archive: string}>}
 */
export async function releaseHelmChart({ version, helmRepoUrl, githubActor, chartDir = DEFAULT_CHART_DIR, packageDir = DEFAULT_PACKAGE_DIR, worktreeDir = DEFAULT_WORKTREE_DIR, runner = runCommand, fs = { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync, rmSync }, logger = console, verbose = false }) {
  if (!version) {
    throw new Error('Version is required');
  }

  const strict = (command, args) => runStrict(command, args, { runner, verbose, logger });
  const soft = (command, args) => runner(command, args, { verbose, logger });
  const chartPath = `${chartDir}/Chart.yaml`;

  logger.log(`Releasing Helm chart version ${version}...`);

  await strict('git', ['config', 'user.name', githubActor]);
  await strict('git', ['config', 'user.email', `${githubActor}@users.noreply.github.com`]);

  // Update Chart.yaml. Note this dirties the release checkout — which is
  // precisely why publishing must happen in a separate worktree below.
  logger.log(`Updating ${chartPath} to version ${version}...`);
  const chartYaml = fs.readFileSync(chartPath, 'utf8');
  const chartName = parseChartName(chartYaml);
  fs.writeFileSync(chartPath, updateChartVersion(chartYaml, version));

  logger.log('Linting Helm chart...');
  await strict('helm', ['lint', chartDir]);

  logger.log('Packaging Helm chart...');
  fs.mkdirSync(packageDir, { recursive: true });
  await strict('helm', ['package', chartDir, '-d', packageDir]);

  const archive = `${chartName}-${version}.tgz`;
  const archivePath = `${packageDir}/${archive}`;
  if (!fs.existsSync(archivePath)) {
    throw new Error(`helm package did not produce ${archivePath}`);
  }

  // Create gh-pages on the remote if it does not exist yet. Done with plumbing
  // so the release checkout is never touched.
  const branchExists = await soft('git', ['ls-remote', '--exit-code', '--heads', 'origin', PUBLISH_BRANCH]);
  if (branchExists.code !== 0) {
    logger.log(`Creating ${PUBLISH_BRANCH} branch...`);
    const commit = await strict('git', ['commit-tree', EMPTY_TREE, '-m', `Initialize ${PUBLISH_BRANCH} branch for Helm charts`]);
    await strict('git', ['push', 'origin', `${commit.stdout.trim()}:refs/heads/${PUBLISH_BRANCH}`]);
  }

  await strict('git', ['fetch', 'origin', `+refs/heads/${PUBLISH_BRANCH}:refs/remotes/origin/${PUBLISH_BRANCH}`]);

  try {
    logger.log(`Publishing from an isolated worktree at ${worktreeDir}...`);
    await strict('git', ['worktree', 'add', '--force', '-B', PUBLISH_BRANCH, worktreeDir, `origin/${PUBLISH_BRANCH}`]);

    // The archive must sit next to index.yaml, otherwise the generated download
    // URL points at a path that does not exist on GitHub Pages.
    fs.copyFileSync(archivePath, `${worktreeDir}/${archive}`);

    const indexPath = `${worktreeDir}/index.yaml`;
    const indexArgs = ['repo', 'index', worktreeDir, '--url', helmRepoUrl];
    if (fs.existsSync(indexPath)) {
      // Merging preserves the `created` timestamps of previously published charts.
      indexArgs.push('--merge', indexPath);
    }
    await strict('helm', indexArgs);

    await strict('git', ['-C', worktreeDir, 'add', '-f', '--', 'index.yaml', archive]);

    const commitResult = await soft('git', ['-C', worktreeDir, 'commit', '-m', `Release Helm chart version ${version}`]);
    if (commitResult.code !== 0) {
      logger.log('No changes to commit');
    }

    await strict('git', ['-C', worktreeDir, 'push', 'origin', `HEAD:${PUBLISH_BRANCH}`]);
  } finally {
    await soft('git', ['worktree', 'remove', '--force', worktreeDir]);
  }

  // Verify the push actually landed. Reading the index back out of the remote
  // ref is immediate and authoritative, unlike fetching the Pages URL which is
  // subject to CDN propagation lag.
  logger.log(`Verifying ${chartName}@${version} is present in the published index...`);
  await strict('git', ['fetch', 'origin', `+refs/heads/${PUBLISH_BRANCH}:refs/remotes/origin/${PUBLISH_BRANCH}`]);
  const publishedIndex = await strict('git', ['show', `origin/${PUBLISH_BRANCH}:index.yaml`]);
  if (!indexContainsVersion(publishedIndex.stdout, version)) {
    throw new Error(`Helm release verification failed: version ${version} is not present in the published index.yaml on ${PUBLISH_BRANCH}`);
  }

  logger.log(`Helm chart version ${version} released successfully!`);
  return { published: true, version, chartName, archive };
}
