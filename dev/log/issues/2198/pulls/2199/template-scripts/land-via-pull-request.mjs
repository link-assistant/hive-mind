/**
 * Land an already-created commit on a branch that refuses direct pushes.
 *
 * When a repository ruleset carries a `pull_request` rule whose `bypass_actors`
 * list does not include the GitHub Actions app, every direct push to `main` is
 * rejected with GH013 ("Changes must be made through a pull request"). The
 * rejection is not a lost race, so the rebase-and-retry recovery cannot help:
 * the release job dies after the version bump has been committed in the runner
 * and the version is never published.
 *
 * The fallback here keeps automation working without weakening the ruleset: the
 * commit is pushed to a short-lived branch, opened as a pull request, and merged
 * through the GitHub API. The local checkout is then fast-forwarded to the
 * merged base branch so the rest of the job (npm publish, GitHub release, ...)
 * proceeds unchanged in the same run.
 *
 * Two common ruleset details shape the implementation:
 *   - a `non_fast_forward` / `deletion` rule targeting `~ALL` forbids force
 *     pushes and branch deletion on every ref, so the temporary branch is never
 *     force-pushed and never deleted; the run id makes each attempt's name
 *     unique instead.
 *   - `allowed_merge_methods` may be `["merge"]` only, so the merge must not
 *     assume squash or rebase.
 *
 * Addresses issue:
 * - link-foundation/js-ai-driven-development-pipeline-template#143
 */

import { CommandFailedError, runCommand, runStrict } from './run-command.mjs';

export const DEFAULT_MERGE_ATTEMPTS = 10;
export const DEFAULT_MERGE_DELAY_MS = 5000;

/**
 * Default sleep implementation (injectable so tests do not wait).
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

/**
 * Name of the temporary branch that carries the commit into a pull request.
 *
 * The run id is embedded because a `no destruction` style rule blocks both
 * force pushes and branch deletion: a reused name could neither be updated nor
 * cleaned up, so every attempt gets a fresh ref.
 * @param {{label?: string, runId?: string, prefix?: string}} options
 * @returns {string}
 */
export function pullRequestBranchName({
  label = 'automation',
  runId,
  prefix = 'release',
} = {}) {
  const slug = String(label)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return [prefix, [slug || 'automation', runId].filter(Boolean).join('-')].join(
    '/'
  );
}

/**
 * URL of an open pull request for a head branch, or '' when none exists.
 * @param {object} options
 * @param {Function} options.runner
 * @param {string} options.head
 * @param {string} options.base
 * @param {Console} [options.logger]
 * @returns {Promise<string>}
 */
export async function findOpenPullRequest({
  runner,
  head,
  base,
  logger = console,
}) {
  const result = await runner(
    'gh',
    [
      'pr',
      'list',
      '--head',
      head,
      '--base',
      base,
      '--state',
      'open',
      '--json',
      'url',
      '--jq',
      '.[0].url // ""',
    ],
    { logger }
  );
  return result.code === 0 ? (result.stdout || '').trim() : '';
}

/**
 * Merge a pull request, retrying while GitHub is still computing mergeability.
 *
 * `gh pr merge` fails with "Pull request is not mergeable" for a few seconds
 * after creation, while the `mergeable` field is still null. Treating that
 * transient state as a hard failure aborts a release one poll away from
 * success.
 * @param {object} options
 * @param {Function} options.runner
 * @param {string} options.url
 * @param {number} [options.maxAttempts]
 * @param {number} [options.delayMs]
 * @param {Function} [options.sleepFn]
 * @param {Console} [options.logger]
 * @returns {Promise<{merged: true, attempt: number}>}
 */
export async function mergePullRequestWithRetry({
  runner,
  url,
  maxAttempts = DEFAULT_MERGE_ATTEMPTS,
  delayMs = DEFAULT_MERGE_DELAY_MS,
  sleepFn = sleep,
  logger = console,
}) {
  // `--merge` only: allowed_merge_methods may exclude squash and rebase.
  const args = ['pr', 'merge', url, '--merge'];
  let last = { code: 1, stdout: '', stderr: '' };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await runner('gh', args, { logger });
    if (last.code === 0) {
      return { merged: true, attempt };
    }
    if (attempt === maxAttempts) {
      break;
    }
    logger.log(
      `Merge attempt ${attempt} of ${maxAttempts} did not succeed yet; GitHub may still be computing mergeability. Retrying...`
    );
    await sleepFn(delayMs);
  }

  throw new CommandFailedError('gh', args, last);
}

/**
 * Default body for the fallback pull request.
 * @param {string} label
 * @param {string} base
 * @returns {string}
 */
function defaultBody(label, base) {
  return [
    `Automated change (\`${label}\`) landed through a pull request.`,
    '',
    `A repository ruleset requires every change to \`${base}\` to go through a`,
    'pull request, so this workflow opens and merges this pull request instead',
    'of pushing directly.',
    '',
    'See link-foundation/js-ai-driven-development-pipeline-template#143.',
  ].join('\n');
}

/**
 * Push HEAD to a temporary branch, open a pull request, merge it, and
 * fast-forward the local checkout to the merged base branch.
 * @param {object} options
 * @param {Function} [options.runner]
 * @param {string} [options.label] - Human-readable label (e.g. the new version)
 * @param {string} [options.branch] - Base branch
 * @param {string} [options.remote]
 * @param {string} [options.runId]
 * @param {string} [options.title]
 * @param {string} [options.body]
 * @param {number} [options.mergeAttempts]
 * @param {number} [options.mergeDelayMs]
 * @param {Function} [options.sleepFn]
 * @param {Console} [options.logger]
 * @returns {Promise<{landed: true, head: string, url: string}>}
 */
export async function landViaPullRequest({
  runner = runCommand,
  label = 'automation',
  branch = 'main',
  remote = 'origin',
  runId = process.env.GITHUB_RUN_ID,
  title,
  body,
  mergeAttempts = DEFAULT_MERGE_ATTEMPTS,
  mergeDelayMs = DEFAULT_MERGE_DELAY_MS,
  sleepFn = sleep,
  logger = console,
}) {
  const strict = (command, args) =>
    runStrict(command, args, { runner, logger });
  const head = pullRequestBranchName({ label, runId });

  logger.log(
    `Direct push to ${branch} is blocked by a repository rule. Landing "${label}" through a pull request instead.`
  );
  logger.log(`Pushing commit to ${remote}/${head}...`);
  await strict('git', ['push', remote, `HEAD:refs/heads/${head}`]);

  let url = await findOpenPullRequest({ runner, head, base: branch, logger });
  if (url) {
    logger.log(`Reusing existing pull request ${url}`);
  } else {
    const created = await strict('gh', [
      'pr',
      'create',
      '--base',
      branch,
      '--head',
      head,
      '--title',
      title || label,
      '--body',
      body || defaultBody(label, branch),
    ]);
    url =
      (created.stdout || '').trim().split('\n').filter(Boolean).pop() || head;
    logger.log(`Created pull request ${url}`);
  }

  await mergePullRequestWithRetry({
    runner,
    url,
    maxAttempts: mergeAttempts,
    delayMs: mergeDelayMs,
    sleepFn,
    logger,
  });
  logger.log(`Pull request ${url} merged into ${branch}.`);

  // Fast-forward the local checkout so later steps in the same job operate on
  // the tree that is now on the base branch.
  await strict('git', ['fetch', remote, branch]);
  await strict('git', ['reset', '--hard', `${remote}/${branch}`]);

  return { landed: true, head, url };
}
