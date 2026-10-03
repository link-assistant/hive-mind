/**
 * Version-bump-and-push logic, with injectable dependencies so it is testable.
 *
 * Why this was extracted and rewritten (issue #2082, finding F4):
 *   scripts/version-and-commit.mjs ran every git command as a bare
 *   `await $\`...\`` using command-stream, whose `$` does NOT throw on a
 *   non-zero exit code. The wrapping try/catch could therefore never fire.
 *
 *   `git push origin main` is racy by construction — the release workflow pushes
 *   the version bump to main while merges and other runs push to the same
 *   branch. A rejected non-fast-forward push was swallowed: the script printed
 *   "Version bump committed and pushed to main", set `version_committed=true`,
 *   and exited 0. The downstream publish job then worked from a version that
 *   existed only in the runner's local checkout.
 *
 * This version:
 *   - Runs every command through `runStrict`, restoring `set -e` semantics.
 *   - Retries a rejected push on top of the new remote HEAD (`git pull --rebase`)
 *     instead of assuming the first attempt won the race.
 *   - Emits `version_committed=true` only after a push that actually landed.
 *
 * Issue #2402 restored the original contract: the version bump is committed
 * directly to main. Between issue #2175 (2026-08-22) and issue #2402
 * (2026-10-01) a "Main ruleset" forced the bump through an auto-merged
 * `release/vX.Y.Z-<run>` pull request; that ruleset is gone, and the pull
 * request detour left stale release PRs and undeletable branches behind. A push
 * rejected by a repository rule now fails the release with an explanation
 * instead of opening a pull request, because only a repository admin can fix it.
 *
 * Uses only Node built-ins so it has no dependency on node_modules state.
 */

import { readFileSync } from 'node:fs';

import { CommandFailedError, runCommand, runStrict } from './run-command.lib.mjs';

const DEFAULT_PUSH_ATTEMPTS = 5;
const DEFAULT_PUSH_DELAY_MS = 3000;
const RELEASE_METADATA_FILES = new Set(['package.json', 'package-lock.json', 'CHANGELOG.md']);

/**
 * Prove that a generated version commit did not change the source tree that the
 * parent workflow validated. Changesets may consume Markdown files and update
 * the package metadata, lockfile, and changelog; anything else must fail closed
 * before the commit is pushed or attested as successful.
 *
 * @param {string[]} paths
 * @returns {void}
 */
export function assertReleaseMetadataOnly(paths) {
  const unexpected = paths.filter(path => path && !RELEASE_METADATA_FILES.has(path) && !/^\.changeset\/[^/]+\.md$/.test(path));
  if (unexpected.length > 0) {
    throw new Error(`Refusing to publish a release commit with unvalidated source changes: ${unexpected.join(', ')}`);
  }
}

/**
 * Read the package version from disk.
 * @param {string} [path]
 * @returns {string}
 */
export function readPackageVersion(path = './package.json') {
  return JSON.parse(readFileSync(path, 'utf8')).version;
}

/**
 * Whether the remote rejected a push because of a branch protection or
 * repository ruleset rule.
 *
 * Distinguished from a non-fast-forward rejection because rebasing cannot fix a
 * rule violation: retrying the same push only burns the remaining attempts and
 * then fails with a misleading "remote has advanced" story (issue #2175).
 *
 * @param {{stdout?: string, stderr?: string, message?: string}} result
 * @returns {boolean}
 */
export function isBlockedByRepositoryRule(result) {
  const output = `${result.stdout || ''}\n${result.stderr || ''}\n${result.message || ''}`.toLowerCase();
  return (
    output.includes('gh006') || // legacy protected-branch rejection
    output.includes('gh013') || // repository rule violations
    output.includes('repository rule violations') ||
    output.includes('changes must be made through a pull request') ||
    output.includes('protected branch') ||
    output.includes('push declined')
  );
}

/**
 * Explain a rule-blocked version push to whoever reads the failed release log.
 *
 * @param {{branch: string, remote: string, version: string, cause: Error}} opts
 * @returns {Error}
 */
export function repositoryRuleError({ branch, remote, version, cause }) {
  const error = new Error([`Direct push of version ${version} to ${remote}/${branch} was rejected by a repository rule.`, `The release workflow commits the version bump directly to ${branch} (issue #2402) and does not open release pull requests.`, `Remove the rule that blocks direct pushes to ${branch}, or add github-actions as its bypass actor, then re-run the release.`, `Underlying error: ${cause.message}`, (cause.stderr || '').trim()].filter(Boolean).join('\n'));
  error.cause = cause;
  return error;
}

/**
 * Whether git rejected a push because the remote branch has advanced.
 *
 * Distinguished from other push failures (auth, network, protected branch)
 * because only this one is fixed by rebasing and trying again.
 *
 * @param {{stdout?: string, stderr?: string}} result
 * @returns {boolean}
 */
export function isNonFastForward(result) {
  // A ruleset rejection also prints "rejected", but rebasing can never satisfy
  // a rule, so it must never be mistaken for a lost race (issue #2175).
  if (isBlockedByRepositoryRule(result)) {
    return false;
  }
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.toLowerCase();
  return output.includes('[rejected]') || output.includes('non-fast-forward') || output.includes('fetch first') || output.includes('updates were rejected');
}

/**
 * Push to a branch, rebasing onto the remote and retrying when the push is
 * rejected because someone else pushed first.
 *
 * @param {object} opts
 * @param {(command: string, args: string[], opts?: object) => Promise<{code: number, stdout?: string, stderr?: string}>} opts.runner
 * @param {string} [opts.branch]
 * @param {string} [opts.remote]
 * @param {number} [opts.maxAttempts]
 * @param {number} [opts.delayMs]
 * @param {(ms: number) => Promise<void>} [opts.sleeper]
 * @param {Console} [opts.logger]
 * @param {boolean} [opts.verbose]
 * @returns {Promise<{pushed: true, attempt: number}>}
 * @throws {CommandFailedError} when the push never lands.
 */
export async function pushWithRebaseRetry({ runner = runCommand, branch = 'main', remote = 'origin', maxAttempts = DEFAULT_PUSH_ATTEMPTS, delayMs = DEFAULT_PUSH_DELAY_MS, sleeper, logger = console, verbose = false }) {
  const wait = sleeper ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await runner('git', ['push', remote, branch], { verbose, logger });
    if (result.code === 0) {
      return { pushed: true, attempt };
    }

    // Anything other than a lost race (auth, protected branch, network) will not
    // be fixed by rebasing, so fail immediately with the real error.
    if (!isNonFastForward(result) || attempt === maxAttempts) {
      throw new CommandFailedError('git', ['push', remote, branch], result);
    }

    logger.log(`Push rejected: ${remote}/${branch} has advanced (attempt ${attempt} of ${maxAttempts}). Rebasing and retrying...`);
    await wait(delayMs);
    await runStrict('git', ['pull', '--rebase', remote, branch], { runner, verbose, logger });
  }

  // Unreachable: the loop either returns or throws.
  throw new Error(`Failed to push to ${remote}/${branch}`);
}

/**
 * Bump the version, commit it, and push it to main.
 *
 * @param {object} opts
 * @param {'changeset'|'instant'} opts.mode
 * @param {string} [opts.bumpType]
 * @param {string} [opts.description]
 * @param {(command: string, args: string[], opts?: object) => Promise<{code: number, stdout?: string, stderr?: string}>} [opts.runner]
 * @param {(key: string, value: string) => void} opts.output
 * @param {(source?: 'local') => string} [opts.readVersion]
 * @param {() => number} opts.countChangesets
 * @param {string} [opts.branch]
 * @param {(ms: number) => Promise<void>} [opts.sleeper]
 * @param {Console} [opts.logger]
 * @param {boolean} [opts.verbose]
 * @returns {Promise<{versionCommitted: boolean, newVersion?: string, alreadyReleased?: boolean}>}
 */
export async function versionAndCommit({ mode, bumpType, description, runner = runCommand, output, readVersion = readPackageVersion, countChangesets, branch = 'main', remote = 'origin', sleeper, logger = console, verbose = false }) {
  const strict = (command, args) => runStrict(command, args, { runner, verbose, logger });

  await strict('git', ['config', 'user.name', 'github-actions[bot]']);
  // The numeric prefix is what links the commit to the github-actions[bot]
  // account. Without it the commit is "unattributed", and the Main ruleset's
  // `require_extra_approval_for_unattributed_changes` would demand a human
  // approval for it (issue #2175).
  await strict('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);

  logger.log('Checking for remote changes...');
  await strict('git', ['fetch', remote, branch]);

  const localHead = (await strict('git', ['rev-parse', 'HEAD'])).stdout.trim();
  const remoteHead = (await strict('git', ['rev-parse', `${remote}/${branch}`])).stdout.trim();

  if (localHead !== remoteHead) {
    logger.log(`Remote ${branch} has advanced (local: ${localHead}, remote: ${remoteHead})`);
    logger.log('This may indicate a previous attempt partially succeeded.');

    if (countChangesets() === 0) {
      const remotePackageJson = await strict('git', ['show', `${remote}/${branch}:package.json`]);
      const remoteVersion = JSON.parse(remotePackageJson.stdout).version;
      logger.log(`Remote version: ${remoteVersion}`);
      logger.log('No changesets to process and remote has advanced.');
      logger.log('Assuming version bump was already completed in a previous attempt.');
      output('version_committed', 'false');
      output('already_released', 'true');
      output('new_version', remoteVersion);
      return { versionCommitted: false, alreadyReleased: true, newVersion: remoteVersion };
    }

    logger.log('Rebasing on remote main to incorporate changes...');
    await strict('git', ['rebase', `${remote}/${branch}`]);
  }

  logger.log(`Current version: ${readVersion()}`);

  if (mode === 'instant') {
    logger.log('Running instant version bump...');
    const args = ['scripts/instant-version-bump.mjs', '--bump-type', bumpType];
    if (description) {
      args.push('--description', description);
    }
    await strict('node', args);
  } else {
    // @changesets/cli 3.0 made `changeset version` exit 1 when there are no
    // unreleased changesets; 2.x warned and exited 0. The count checked above
    // was read before the rebase, and the rebase can consume the very
    // changesets the release decision was made on (another run versioned them
    // first). Reading it again here keeps that case a quiet self-healing
    // release instead of a red release job.
    if (countChangesets() === 0) {
      const versionOnDisk = readVersion();
      logger.log('No changesets left after synchronizing with the remote (another run versioned them).');
      logger.log(`Nothing to bump; treating ${versionOnDisk} as the version to publish.`);
      output('version_committed', 'false');
      output('already_released', 'true');
      output('new_version', versionOnDisk);
      return { versionCommitted: false, alreadyReleased: true, newVersion: versionOnDisk };
    }

    logger.log('Running changeset version...');
    await strict('npm', ['run', 'changeset:version']);

    logger.log('Synchronizing package-lock.json...');
    await strict('npm', ['install', '--package-lock-only']);
  }

  const newVersion = readVersion();
  logger.log(`New version: ${newVersion}`);
  output('new_version', newVersion);

  const status = (await strict('git', ['status', '--porcelain'])).stdout.trim();
  if (!status) {
    logger.log('No changes to commit');
    output('version_committed', 'false');
    return { versionCommitted: false, newVersion };
  }

  logger.log('Changes detected, committing...');
  await strict('git', ['add', '-A']);
  await strict('git', ['commit', '-m', newVersion]);

  const committedPaths = (await strict('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])).stdout
    .split('\n')
    .map(path => path.trim())
    .filter(Boolean);
  assertReleaseMetadataOnly(committedPaths);

  // Only after this resolves has the bump actually reached main. Reporting
  // success before the push landed is the F4 regression.
  try {
    await pushWithRebaseRetry({ runner, branch, remote, sleeper, logger, verbose });
  } catch (error) {
    // A repository rule is not a lost race, so no amount of rebasing fixes it.
    // Fail with the cause instead of detouring through a pull request (#2402).
    if (isBlockedByRepositoryRule(error)) {
      throw repositoryRuleError({ branch, remote, version: newVersion, cause: error });
    }
    throw error;
  }

  logger.log(`Version bump committed and pushed to ${branch}`);
  output('version_committed', 'true');
  return { versionCommitted: true, newVersion };
}
