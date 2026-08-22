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
 * Uses only Node built-ins so it has no dependency on node_modules state.
 */

import { readFileSync } from 'node:fs';

import { CommandFailedError, runCommand, runStrict } from './run-command.lib.mjs';

const DEFAULT_PUSH_ATTEMPTS = 5;
const DEFAULT_PUSH_DELAY_MS = 3000;

/**
 * Read the package version from disk.
 * @param {string} [path]
 * @returns {string}
 */
export function readPackageVersion(path = './package.json') {
  return JSON.parse(readFileSync(path, 'utf8')).version;
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
  await strict('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com']);

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

  // Only after this resolves has the bump actually reached main. Reporting
  // success before the push landed is the F4 regression.
  await pushWithRebaseRetry({ runner, branch, remote, sleeper, logger, verbose });

  logger.log(`Version bump committed and pushed to ${branch}`);
  output('version_committed', 'true');
  return { versionCommitted: true, newVersion };
}
