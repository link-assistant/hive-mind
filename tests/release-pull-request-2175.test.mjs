/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2175.
 *
 * On 2026-08-22 17:34 UTC a `pull_request` rule with an empty `bypass_actors`
 * list was added to the repository's "Main ruleset". The very next release run
 * (32589574378) bumped the version to 2.13.5, committed it, and was rejected by
 * the server:
 *
 *   remote: error: GH013: Repository rule violations found for refs/heads/main.
 *   remote: - Changes must be made through a pull request.
 *    ! [remote rejected]   main -> main (push declined due to repository rule violations)
 *
 * 2.13.5 was therefore never published. The rejection is not a lost race, so the
 * issue #2082 rebase-and-retry loop could not resolve it — and must not even try,
 * because every retry is rejected identically.
 *
 * These tests pin:
 *   1. a ruleset rejection is never classified as a non-fast-forward race;
 *   2. it is not retried, it is landed through a pull request instead;
 *   3. the release branch is unique per run (the `no-destruction-possible`
 *      ruleset forbids force-pushing and deleting refs, so names cannot be reused);
 *   4. the merge uses `--merge` (the only method `allowed_merge_methods` permits)
 *      and is retried while GitHub is still computing mergeability;
 *   5. the local checkout is fast-forwarded to the merged branch so the publish
 *      steps run against what is actually on main;
 *   6. `version_committed=true` is emitted only after the pull request merged;
 *   7. a genuine push failure that is not a rule violation still fails the job.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2175
 */

import assert from 'node:assert/strict';

import { isBlockedByRepositoryRule, landViaPullRequest, mergePullRequestWithRetry, releaseBranchName } from '../scripts/release-pull-request.lib.mjs';
import { CommandFailedError } from '../scripts/run-command.lib.mjs';
import { isNonFastForward, versionAndCommit } from '../scripts/version-and-commit.lib.mjs';

const RULE_VIOLATION = {
  code: 1,
  stdout: '',
  stderr: ['remote: error: GH013: Repository rule violations found for refs/heads/main.', 'remote: - Changes must be made through a pull request.', ' ! [remote rejected]   main -> main (push declined due to repository rule violations)', "error: failed to push some refs to 'https://github.com/link-assistant/hive-mind'"].join('\n'),
};

const LOST_RACE = {
  code: 1,
  stdout: '',
  stderr: ' ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs\n',
};

const silent = { log() {}, error() {} };

// --- 1. Classification ----------------------------------------------------

{
  assert.equal(isBlockedByRepositoryRule(RULE_VIOLATION), true, 'the production GH013 output must be recognised as a rule violation');
  assert.equal(isBlockedByRepositoryRule(LOST_RACE), false, 'a plain non-fast-forward is a lost race, not a rule violation');
  assert.equal(isBlockedByRepositoryRule({ code: 1, stderr: 'fatal: Authentication failed' }), false, 'an auth failure is not a rule violation');

  assert.equal(isNonFastForward(RULE_VIOLATION), false, 'a rule violation must never be treated as a race — rebasing and retrying can never satisfy "changes must be made through a pull request"');
  assert.equal(isNonFastForward(LOST_RACE), true, 'a real race is still a race');
}

// --- 2. Branch naming -----------------------------------------------------

{
  assert.equal(releaseBranchName({ version: '2.13.5', runId: '32589574378' }), 'release/v2.13.5-32589574378');
  assert.notEqual(releaseBranchName({ version: '2.13.5', runId: '1' }), releaseBranchName({ version: '2.13.5', runId: '2' }), 'two runs releasing the same version must not collide: the no-destruction ruleset forbids force-pushing or deleting the branch of the first one');
}

// --- 3. Merge retry -------------------------------------------------------

{
  let attempts = 0;
  const runner = async (command, args = []) => {
    attempts += 1;
    assert.deepEqual([command, ...args], ['gh', 'pr', 'merge', 'https://pr/1', '--merge'], 'allowed_merge_methods is ["merge"], so squash/rebase would be rejected');
    return attempts < 3 ? { code: 1, stdout: '', stderr: 'Pull request is not mergeable: the merge commit cannot be cleanly created.' } : { code: 0, stdout: '', stderr: '' };
  };

  const result = await mergePullRequestWithRetry({ runner, url: 'https://pr/1', sleeper: async () => {}, logger: silent });
  assert.equal(result.attempt, 3, 'a not-yet-mergeable pull request is polled rather than abandoned');

  await assert.rejects(() => mergePullRequestWithRetry({ runner: async () => ({ code: 1, stdout: '', stderr: 'no' }), url: 'https://pr/1', maxAttempts: 2, sleeper: async () => {}, logger: silent }), CommandFailedError, 'a merge that never succeeds must fail the release loudly');
}

// --- 4. landViaPullRequest end to end -------------------------------------

{
  const calls = [];
  const outputs = {};
  const runner = async (command, args = []) => {
    const key = [command, ...args].join(' ');
    calls.push(key);
    if (key.startsWith('gh pr list')) {
      return { code: 0, stdout: '\n', stderr: '' };
    }
    if (key.startsWith('gh pr create')) {
      return { code: 0, stdout: 'https://github.com/link-assistant/hive-mind/pull/9999\n', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  const result = await landViaPullRequest({
    runner,
    version: '2.13.5',
    runId: '32589574378',
    sleeper: async () => {},
    // The real default lazily imports the secretlint-backed sanitizer; the body
    // is composed of literals, so identity keeps this test hermetic.
    sanitizeForPublication: async text => text,
    logger: silent,
    output: (key, value) => {
      outputs[key] = value;
    },
  });

  assert.equal(result.url, 'https://github.com/link-assistant/hive-mind/pull/9999');
  assert.ok(calls.includes('git push origin HEAD:refs/heads/release/v2.13.5-32589574378'), 'the commit is pushed to its own branch — pushing to main is exactly what the ruleset rejects');
  assert.ok(
    calls.some(call => call.startsWith('gh pr merge https://github.com/link-assistant/hive-mind/pull/9999 --merge')),
    'the pull request is merged through the API'
  );
  const merge = calls.findIndex(call => call.startsWith('gh pr merge'));
  const reset = calls.indexOf('git reset --hard origin/main');
  assert.ok(reset > merge, 'the local checkout is fast-forwarded to the merged main only after the merge, so publish steps see the real tree');
  assert.equal(outputs.release_pull_request, 'https://github.com/link-assistant/hive-mind/pull/9999', 'the pull request URL is surfaced as a step output for debugging');
  assert.ok(!calls.some(call => call.includes('--force')), 'the no-destruction ruleset forbids force pushes');
  assert.ok(!calls.some(call => call.includes('push') && call.includes('--delete')), 'the no-destruction ruleset forbids deleting refs');
}

{
  // An existing pull request for the same head branch is reused, not duplicated.
  const calls = [];
  const runner = async (command, args = []) => {
    const key = [command, ...args].join(' ');
    calls.push(key);
    if (key.startsWith('gh pr list')) {
      return { code: 0, stdout: 'https://github.com/link-assistant/hive-mind/pull/42\n', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  const result = await landViaPullRequest({ runner, version: '2.13.5', runId: '7', sleeper: async () => {}, logger: silent, sanitizeForPublication: async text => text });
  assert.equal(result.url, 'https://github.com/link-assistant/hive-mind/pull/42');
  assert.ok(!calls.some(call => call.startsWith('gh pr create')), 're-running the release must not open a second pull request for the same branch');
}

// --- 5. versionAndCommit falls back instead of failing --------------------

function createHarness({ pushResult, version = '2.13.5' }) {
  const calls = [];
  const outputs = {};

  const runner = async (command, args = []) => {
    const key = [command, ...args].join(' ');
    calls.push(key);
    if (key === 'git push origin main') {
      return pushResult;
    }
    if (key === 'git status --porcelain') {
      return { code: 0, stdout: ' M package.json\n', stderr: '' };
    }
    if (key.startsWith('git rev-parse')) {
      return { code: 0, stdout: 'abc123\n', stderr: '' };
    }
    if (key.startsWith('gh pr list')) {
      return { code: 0, stdout: '', stderr: '' };
    }
    if (key.startsWith('gh pr create')) {
      return { code: 0, stdout: 'https://github.com/link-assistant/hive-mind/pull/1234\n', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  return {
    calls,
    outputs,
    run: () =>
      versionAndCommit({
        mode: 'changeset',
        runner,
        output: (key, value) => {
          outputs[key] = value;
        },
        readVersion: () => version,
        countChangesets: () => 1,
        runId: '32589574378',
        sleeper: async () => {},
        logger: silent,
        sanitizeForPublication: async text => text,
      }),
  };
}

{
  // The production failure of run 32589574378, replayed.
  const harness = createHarness({ pushResult: RULE_VIOLATION });
  const result = await harness.run();

  assert.equal(result.versionCommitted, true, 'the release must complete: before the fix this threw and 2.13.5 was never published');
  assert.equal(harness.outputs.version_committed, 'true');
  assert.equal(harness.outputs.new_version, '2.13.5');

  const directPushes = harness.calls.filter(call => call === 'git push origin main').length;
  assert.equal(directPushes, 1, 'the blocked push is attempted once, not retried — every retry would be rejected identically');
  assert.ok(
    harness.calls.some(call => call.startsWith('gh pr create')),
    'the version bump is landed through a pull request'
  );
  assert.ok(harness.calls.includes('git config user.email 41898282+github-actions[bot]@users.noreply.github.com'), "the commit must be attributed to github-actions[bot] — an unattributed commit trips the ruleset's require_extra_approval_for_unattributed_changes and the pull request would need a human approval");
}

{
  // Not a rule violation: the old, correct behaviour must be preserved.
  const harness = createHarness({ pushResult: { code: 1, stdout: '', stderr: 'fatal: Authentication failed for https://github.com/...' } });

  await assert.rejects(() => harness.run(), CommandFailedError, 'a push failure that is not a rule violation must still fail the job rather than silently opening a pull request');

  assert.ok(!harness.calls.some(call => call.startsWith('gh pr create')), 'the pull-request fallback is only for rule violations');
  assert.notEqual(harness.outputs.version_committed, 'true', 'version_committed must never be true when nothing landed');
}

console.log('release-pull-request-2175.test.mjs: all assertions passed');
