/**
 * Decide whether the release job has anything to do.
 *
 * Why this exists (issue #2175):
 *   The release job used to key everything off a single question — "are there
 *   changeset files?" — computed by an inline `find .changeset ...` in
 *   release.yml. That made two states indistinguishable from "nothing to do":
 *
 *     1. A version bump landed on main but the publish never happened (the run
 *        was cancelled, the runner died, or npm rejected the publish). The next
 *        push to main sees no changesets and silently skips the release, so
 *        package.json and git say 2.13.5 while npm's latest stays 2.13.4 —
 *        a false negative that persists until someone notices.
 *     2. A version bump that had to be landed through a pull request
 *        (issue #2175's ruleset fallback): the changesets are consumed by the
 *        version PR, and the merge of that PR is the run that must publish.
 *
 *   Checking npm — not git tags — closes both. npm is the only source of truth
 *   for "can a user install this version": a tag or GitHub release can exist for
 *   a version that was never published.
 *
 *   This mirrors `scripts/check-release-needed.mjs` in
 *   link-foundation/js-ai-driven-development-pipeline-template, which added the
 *   same self-healing check for its issue #36.
 *
 * Issue #2923 extends it to the GitHub release: a version can reach npm while
 *   its release job dies (2.34.1 and 2.35.1 timed out verifying npm), leaving no
 *   GitHub release, Docker images or Helm chart. Asking npm alone reports
 *   "nothing to release" for that version forever, so a missing GitHub release
 *   re-runs the release without a bump (same as
 *   link-foundation/js-ai-driven-development-pipeline-template#211).
 *
 * Uses only Node built-ins so it has no dependency on node_modules state.
 */

import { readdirSync, readFileSync } from 'node:fs';

/**
 * Count changeset files, excluding the changesets tool's own metadata.
 * @param {{dir?: string, reader?: (dir: string) => string[]}} [opts]
 * @returns {number}
 */
export function countChangesets({ dir = '.changeset', reader = readdirSync } = {}) {
  try {
    return reader(dir).filter(name => name.endsWith('.md') && name !== 'README.md').length;
  } catch {
    return 0;
  }
}

/**
 * Read `{name, version}` from a package.json.
 * @param {{path?: string, readFile?: (path: string, encoding: string) => string}} [opts]
 * @returns {{name: string, version: string}}
 */
export function readPackageInfo({ path = './package.json', readFile = readFileSync } = {}) {
  const { name, version } = JSON.parse(readFile(path, 'utf8'));
  return { name, version };
}

/**
 * Whether the GitHub release `v<version>` exists.
 * @param {{runner: (command: string, args: string[]) => Promise<{code: number, stdout?: string, stderr?: string}>, repository: string, version: string}} opts
 * @returns {Promise<boolean|null>} null when the state is unknown (no repository, network or 5xx failure).
 */
export async function githubReleaseExists({ runner, repository, version }) {
  if (!repository) return null;
  const result = await runner('gh', ['api', `repos/${repository}/releases/tags/v${version}`, '--jq', '.id']);
  if (result.code === 0) return true;
  return /HTTP 404|Not Found/i.test(`${result.stderr || ''}${result.stdout || ''}`) ? false : null;
}

/**
 * Decide what the release job should do.
 *
 * @param {object} opts
 * @param {number} opts.changesetCount
 * @param {string} opts.version
 * @param {(version: string) => Promise<boolean>} opts.isPublished
 * @param {(version: string) => Promise<boolean|null>} [opts.hasGithubRelease] - null means unknown.
 * @param {Console} [opts.logger]
 * @returns {Promise<{hasChangesets: boolean, changesetCount: number, shouldRelease: boolean, skipBump: boolean, version: string}>}
 */
export async function decideRelease({ changesetCount, version, isPublished, hasGithubRelease = async () => true, logger = console }) {
  const hasChangesets = changesetCount > 0;
  logger.log(`Found ${changesetCount} changeset file(s)`);

  // A pending changeset always means a new version has to be produced first.
  if (hasChangesets) {
    logger.log('Changesets present: a version bump is required before publishing.');
    return { hasChangesets, changesetCount, shouldRelease: true, skipBump: false, version };
  }

  logger.log(`No changesets. Checking whether ${version} is already on npm...`);
  const published = await isPublished(version);
  if (published) {
    const released = await hasGithubRelease(version);
    if (released === false) {
      // publish-to-npm.mjs reports an existing version as published, so the
      // GitHub release, Docker images and Helm chart run for it (issue #2923).
      logger.log(`Version ${version} is on npm but has no GitHub release v${version}. Releasing it without a version bump (self-healing release).`);
      return { hasChangesets, changesetCount, shouldRelease: true, skipBump: true, version };
    }
    if (released === null) logger.warn(`Could not check the GitHub release v${version}; not releasing. Re-run the job if the release is missing.`);
    logger.log(`Version ${version} is already published. Nothing to release.`);
    return { hasChangesets, changesetCount, shouldRelease: false, skipBump: false, version };
  }

  // Self-healing path: the repository is ahead of the registry.
  logger.log(`Version ${version} is NOT on npm. Publishing it without a version bump (self-healing release).`);
  return { hasChangesets, changesetCount, shouldRelease: true, skipBump: true, version };
}

/**
 * Emit the decision as GitHub Actions step outputs.
 * @param {{hasChangesets: boolean, changesetCount: number, shouldRelease: boolean, skipBump: boolean}} decision
 * @param {(key: string, value: string) => void} output
 */
export function emitDecision(decision, output) {
  output('has_changesets', String(decision.hasChangesets));
  output('changeset_count', String(decision.changesetCount));
  output('should_release', String(decision.shouldRelease));
  output('skip_bump', String(decision.skipBump));
}
