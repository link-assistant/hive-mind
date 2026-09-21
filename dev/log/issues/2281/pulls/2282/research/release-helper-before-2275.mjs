/**
 * Land an already-created commit on a protected branch through a pull request.
 *
 * Why this exists (issue #2175):
 *   On 2026-08-22 17:34 UTC a `pull_request` rule was added to the repository's
 *   "Main ruleset" with an empty `bypass_actors` list. From that moment every
 *   direct push to `main` — including the release workflow's version-bump push —
 *   is rejected by the server:
 *
 *     remote: error: GH013: Repository rule violations found for refs/heads/main.
 *     remote: - Changes must be made through a pull request.
 *      ! [remote rejected]   main -> main (push declined due to repository rule violations)
 *
 *   Run 32589574378 failed exactly there, so `2.13.5` was never published. The
 *   rejection is NOT a lost race, so rebasing and retrying (the #2082 fix) can
 *   never resolve it.
 *
 * The fallback implemented here keeps releases working without weakening the
 * ruleset: the version commit is pushed to a short-lived branch, opened as a
 * pull request, and merged through the GitHub API. The merge satisfies
 * "changes must be made through a pull request", and the local checkout is
 * fast-forwarded to the merged `main` so the rest of the release job (npm
 * publish, GitHub release, Docker, Helm) proceeds unchanged in the same run.
 *
 * Two ruleset details shape the implementation:
 *   - `no-destruction-possible` (target `~ALL`) forbids branch deletion and
 *     non-fast-forward pushes on every ref, so the release branch is never
 *     force-pushed and never deleted; the name is made unique per run instead.
 *   - `allowed_merge_methods` is `["merge"]`, so the merge must use `--merge`.
 *
 * Uses only Node built-ins so it has no dependency on node_modules state.
 */

import { CommandFailedError, runCommand, runStrict } from './run-command.lib.mjs';

const DEFAULT_MERGE_ATTEMPTS = 10;
const DEFAULT_MERGE_DELAY_MS = 5000;

/**
 * Default publication sanitizer.
 *
 * Imported lazily because src/token-sanitization.lib.mjs pulls in secretlint
 * through use-m: this library must stay importable (and unit-testable) without
 * that runtime, and the sanitizer is only needed on the rare fallback path.
 *
 * @param {string} text
 * @returns {Promise<string>}
 */
async function publicationSanitizer(text) {
  const { sanitizeForPublication } = await import('../src/token-sanitization.lib.mjs');
  return sanitizeForPublication(text);
}

/**
 * Whether the remote rejected a push because of a branch protection or
 * repository ruleset rule.
 *
 * Distinguished from a non-fast-forward rejection (see `isNonFastForward` in
 * version-and-commit.lib.mjs) because rebasing cannot fix a rule violation —
 * retrying the same push only burns the remaining attempts and then fails with
 * a misleading "push rejected, remote has advanced" story.
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
 * Branch name for the version-bump pull request.
 *
 * The name embeds the run id because `no-destruction-possible` blocks both
 * force pushes and branch deletion: a reused name could neither be updated nor
 * cleaned up, so every attempt gets a fresh ref instead.
 *
 * @param {{version: string, runId?: string, attempt?: number}} opts
 * @returns {string}
 */
export function releaseBranchName({ version, runId, attempt }) {
  const suffix = [runId, attempt && attempt > 1 ? `attempt-${attempt}` : ''].filter(Boolean).join('-');
  return suffix ? `release/v${version}-${suffix}` : `release/v${version}`;
}

/**
 * Read the URL of an open pull request for a head branch, or '' when none exists.
 *
 * @param {object} opts
 * @param {(command: string, args: string[], opts?: object) => Promise<{code:number, stdout?:string}>} opts.runner
 * @param {string} opts.head
 * @param {string} opts.base
 * @param {boolean} [opts.verbose]
 * @param {Console} [opts.logger]
 * @returns {Promise<string>}
 */
export async function findOpenPullRequest({ runner, head, base, verbose = false, logger = console }) {
  const result = await runner('gh', ['pr', 'list', '--head', head, '--base', base, '--state', 'open', '--json', 'url', '--jq', '.[0].url // ""'], { verbose, logger });
  return result.code === 0 ? (result.stdout || '').trim() : '';
}

/**
 * Merge a pull request, retrying while GitHub is still computing mergeability.
 *
 * `gh pr merge` fails with "Pull request is not mergeable" for a few seconds
 * after creation while the `mergeable` field is `null`. Treating that transient
 * state as a hard failure would abort a release that is one poll away from
 * succeeding.
 *
 * @param {object} opts
 * @param {(command: string, args: string[], opts?: object) => Promise<{code:number, stdout?:string, stderr?:string}>} opts.runner
 * @param {string} opts.url
 * @param {number} [opts.maxAttempts]
 * @param {number} [opts.delayMs]
 * @param {(ms:number)=>Promise<void>} [opts.sleeper]
 * @param {Console} [opts.logger]
 * @param {boolean} [opts.verbose]
 * @returns {Promise<{merged: true, attempt: number}>}
 * @throws {CommandFailedError} when the merge never succeeds.
 */
export async function mergePullRequestWithRetry({ runner, url, maxAttempts = DEFAULT_MERGE_ATTEMPTS, delayMs = DEFAULT_MERGE_DELAY_MS, sleeper, logger = console, verbose = false }) {
  const wait = sleeper ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const args = ['pr', 'merge', url, '--merge'];

  let last = { code: 1, stdout: '', stderr: '' };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await runner('gh', args, { verbose, logger });
    if (last.code === 0) {
      return { merged: true, attempt };
    }
    if (attempt === maxAttempts) {
      break;
    }
    logger.log(`Merge attempt ${attempt} of ${maxAttempts} did not succeed yet; GitHub may still be computing mergeability. Retrying...`);
    await wait(delayMs);
  }

  throw new CommandFailedError('gh', args, last);
}

/**
 * Push HEAD to a branch, open a pull request, merge it, and fast-forward the
 * local checkout to the merged base branch.
 *
 * @param {object} opts
 * @param {(command: string, args: string[], opts?: object) => Promise<{code:number, stdout?:string, stderr?:string}>} [opts.runner]
 * @param {string} opts.version
 * @param {string} [opts.branch] base branch, defaults to `main`
 * @param {string} [opts.remote]
 * @param {string} [opts.runId]
 * @param {string} [opts.title]
 * @param {string} [opts.body]
 * @param {(ms:number)=>Promise<void>} [opts.sleeper]
 * @param {Console} [opts.logger]
 * @param {boolean} [opts.verbose]
 * @param {(key: string, value: string) => void} [opts.output]
 * @param {(text: string) => Promise<string>} [opts.sanitizeForPublication]
 * @returns {Promise<{landed: true, head: string, url: string}>}
 */
export async function landViaPullRequest({ runner = runCommand, version, branch = 'main', remote = 'origin', runId, title, body, sleeper, logger = console, verbose = false, output, sanitizeForPublication = publicationSanitizer }) {
  const strict = (command, args) => runStrict(command, args, { runner, verbose, logger });
  const head = releaseBranchName({ version, runId });

  logger.log(`Direct push to ${branch} is blocked by a repository rule. Landing ${version} through a pull request instead.`);
  logger.log(`Pushing version commit to ${remote}/${head}...`);
  await strict('git', ['push', remote, `HEAD:refs/heads/${head}`]);

  let url = await findOpenPullRequest({ runner, head, base: branch, verbose, logger });
  if (url) {
    logger.log(`Reusing existing pull request ${url}`);
  } else {
    const prTitle = title || version;
    const prBody = body || [`Automated version bump to \`${version}\`.`, '', 'A repository ruleset requires every change to `main` to go through a pull request,', 'so the release workflow opens and merges this pull request instead of pushing directly.', '', 'See issue #2175.'].join('\n');
    const created = await strict('gh', ['pr', 'create', '--base', branch, '--head', head, '--title', await sanitizeForPublication(prTitle), '--body', await sanitizeForPublication(prBody)]);
    url = (created.stdout || '').trim().split('\n').filter(Boolean).pop() || '';
    logger.log(`Created pull request ${url}`);
  }

  if (output) {
    output('release_pull_request', url);
  }

  await mergePullRequestWithRetry({ runner, url, sleeper, logger, verbose });
  logger.log(`Pull request ${url} merged into ${branch}.`);

  // Fast-forward the local checkout so the publish steps operate on the same
  // tree that is now on the base branch.
  await strict('git', ['fetch', remote, branch]);
  await strict('git', ['reset', '--hard', `${remote}/${branch}`]);

  return { landed: true, head, url };
}
