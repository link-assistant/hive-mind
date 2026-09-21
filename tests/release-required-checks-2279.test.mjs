/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2279.
 *
 * GitHub does not evaluate workflow-job checks from a `workflow_dispatch` run
 * as pull-request required checks. A release PR must instead be opened with an
 * independent PAT or GitHub App token so its ordinary `pull_request` runs are
 * eligible. The release must wait for those PR-associated checks and fail
 * closed when no independent credential is configured.
 *
 * @see https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { landViaPullRequest } from '../scripts/release-pull-request.lib.mjs';

const silent = { log() {}, error() {} };

// A passing manually dispatched run is not evidence that a pull request's
// required check passed. The helper must wait on checks attached to the PR.
{
  const calls = [];
  const runner = async (command, args = []) => {
    const call = [command, ...args].join(' ');
    calls.push(call);

    if (call.startsWith('gh pr list')) return { code: 0, stdout: '', stderr: '' };
    if (call.startsWith('gh pr create')) return { code: 0, stdout: 'https://github.com/link-assistant/hive-mind/pull/9999\n', stderr: '' };
    // Keep the obsolete implementation executable so the assertion below
    // records the behavioral mismatch rather than an unrelated mock failure.
    if (call.startsWith('gh workflow run')) return { code: 0, stdout: 'https://github.com/link-assistant/hive-mind/actions/runs/4242\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };

  await landViaPullRequest({
    runner,
    version: '2.31.0',
    runId: '35536130313',
    releasePullRequestTokenConfigured: true,
    sleeper: async () => {},
    logger: silent,
    sanitizeForPublication: async text => text,
  });

  const checks = calls.indexOf('gh pr checks https://github.com/link-assistant/hive-mind/pull/9999 --watch --fail-fast --interval 10');
  const merge = calls.findIndex(call => call.startsWith('gh pr merge'));
  assert.ok(checks >= 0, 'the release must watch checks associated with the pull request');
  assert.ok(checks < merge, 'pull-request checks must pass before the first merge attempt');
  assert.equal(
    calls.some(call => call.startsWith('gh workflow run')),
    false,
    'workflow_dispatch checks are ineligible to satisfy pull-request required checks'
  );
}

// GitHub can briefly report no checks immediately after PR creation. Retry
// only that discovery race; the next call watches the now-visible checks.
{
  let checkCalls = 0;
  const sleeps = [];
  await landViaPullRequest({
    runner: async (command, args = []) => {
      const call = [command, ...args].join(' ');
      if (call.startsWith('gh pr list')) return { code: 0, stdout: '', stderr: '' };
      if (call.startsWith('gh pr create')) return { code: 0, stdout: 'https://github.com/link-assistant/hive-mind/pull/10001\n', stderr: '' };
      if (call.startsWith('gh pr checks')) {
        checkCalls += 1;
        return checkCalls === 1 ? { code: 1, stdout: '', stderr: "no checks reported on the 'release/v2.31.0-check-race' branch" } : { code: 0, stdout: 'Pipeline Status\tpass\n', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
    version: '2.31.0',
    runId: 'check-race',
    releasePullRequestTokenConfigured: true,
    sleeper: async ms => sleeps.push(ms),
    logger: silent,
    sanitizeForPublication: async text => text,
  });
  assert.equal(checkCalls, 2, 'a short check-discovery race is retried');
  assert.deepEqual(sleeps, [2000], 'check discovery uses the bounded retry delay');
}

// Falling back to GITHUB_TOKEN creates action-required runs and another
// permanently blocked PR. Refuse before pushing an orphan release branch.
{
  const calls = [];
  await assert.rejects(
    landViaPullRequest({
      runner: async (command, args = []) => {
        calls.push([command, ...args].join(' '));
        return { code: 0, stdout: '', stderr: '' };
      },
      version: '2.31.0',
      runId: 'missing-token',
      releasePullRequestTokenConfigured: false,
      logger: silent,
      sanitizeForPublication: async text => text,
    }),
    /RELEASE_PULL_REQUEST_TOKEN/,
    'a protected release must explain the missing independent credential'
  );
  assert.deepEqual(calls, [], 'a missing token must be detected before an orphan branch or PR is created');
}

const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');
const preflightWorkflow = readFileSync('.github/workflows/release-preflight.yml', 'utf8');

assert.doesNotMatch(releaseWorkflow, /validate-pr/, 'the ineligible workflow_dispatch validation mode must be removed');
assert.equal((releaseWorkflow.match(/actions: write/g) || []).length, 0, 'dispatch-only Actions write permissions must be removed');
assert.equal((releaseWorkflow.match(/GH_TOKEN: \$\{\{ secrets\.RELEASE_PULL_REQUEST_TOKEN \}\}/g) || []).length, 2, 'both release modes must create fallback PRs with the independent token');
assert.equal((releaseWorkflow.match(/RELEASE_PULL_REQUEST_TOKEN_CONFIGURED:/g) || []).length, 2, 'both release modes must pass a non-secret availability flag to the helper');
assert.doesNotMatch(preflightWorkflow, /validate-pr/, 'preflight no longer needs a publication exception for the invalid dispatch mode');

console.log('release-required-checks-2279.test.mjs: all assertions passed');
