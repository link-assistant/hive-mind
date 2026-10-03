/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2402 (and the classification half of #2175).
 *
 * From 2026-08-22 to 2026-10-01 a "Main ruleset" rejected every direct push to
 * main, so the release workflow landed each version bump through an auto-merged
 * `release/vX.Y.Z-<run>` pull request (#2175, #2274, #2279, #2281). That ruleset
 * was removed; only `no-destruction-possible` (deletion + non_fast_forward)
 * remains. The detour left six stale release pull requests (#2268-#2278) and an
 * undeletable branch per release, so issue #2402 returns to committing the
 * version bump directly to main.
 *
 * These tests pin:
 *   1. a ruleset rejection is never classified as a non-fast-forward race;
 *   2. a successful release never calls `gh` (no pull request, no check run);
 *   3. a rule-blocked push fails the release with an actionable error instead of
 *      opening a pull request, and is not retried;
 *   4. a push failure that is not a rule violation still fails as before;
 *   5. the version commit may contain generated release metadata only;
 *   6. release.yml has no pull-request or check-run write permission left in its
 *      release jobs, and the pull-request helper is gone.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2402
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { CommandFailedError } from '../scripts/run-command.lib.mjs';
import { assertReleaseMetadataOnly, isBlockedByRepositoryRule, isNonFastForward, versionAndCommit } from '../scripts/version-and-commit.lib.mjs';

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

  assert.equal(isNonFastForward(RULE_VIOLATION), false, 'a rule violation must never be treated as a race: rebasing can never satisfy a rule');
  assert.equal(isNonFastForward(LOST_RACE), true, 'a real race is still a race');
}

// --- 2-4. versionAndCommit pushes directly ---------------------------------

function createHarness({ pushResult, version = '2.33.4' }) {
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
    if (key.startsWith('git diff-tree')) {
      return { code: 0, stdout: 'package.json\npackage-lock.json\nCHANGELOG.md\n.changeset/quiet-owls-sing.md\n', stderr: '' };
    }
    if (key.startsWith('git rev-parse')) {
      return { code: 0, stdout: `${'a'.repeat(40)}\n`, stderr: '' };
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
        sleeper: async () => {},
        logger: silent,
      }),
  };
}

{
  const harness = createHarness({ pushResult: { code: 0, stdout: '', stderr: '' } });
  const result = await harness.run();

  assert.equal(result.versionCommitted, true);
  assert.equal(harness.outputs.version_committed, 'true');
  assert.equal(harness.outputs.new_version, '2.33.4');
  assert.deepEqual(
    harness.calls.filter(call => call.startsWith('git push')),
    ['git push origin main'],
    'the version commit goes straight to main, never to a release/* branch'
  );
  assert.equal(
    harness.calls.some(call => call.startsWith('gh ')),
    false,
    'a release must not open, check or merge a pull request'
  );
  assert.ok(harness.calls.includes('git commit -m 2.33.4'), 'the commit message is the bare version, as before #2175');
  assert.ok(harness.calls.includes('git config user.email 41898282+github-actions[bot]@users.noreply.github.com'), 'the commit stays attributed to github-actions[bot]');
}

{
  // The production failure of run 32589574378 (issue #2175), replayed against
  // the direct-commit contract: fail loudly, never detour through a PR.
  const harness = createHarness({ pushResult: RULE_VIOLATION });

  await assert.rejects(
    () => harness.run(),
    error => {
      assert.match(error.message, /rejected by a repository rule/);
      assert.match(error.message, /#2402/);
      assert.match(error.message, /GH013/, 'the server output is kept so the log shows which rule fired');
      return true;
    }
  );

  assert.equal(harness.calls.filter(call => call === 'git push origin main').length, 1, 'the blocked push is attempted once: every retry would be rejected identically');
  assert.equal(
    harness.calls.some(call => call.startsWith('gh ')),
    false,
    'a rule-blocked push must not create a release pull request'
  );
  assert.notEqual(harness.outputs.version_committed, 'true', 'version_committed must never be true when nothing landed');
}

{
  const harness = createHarness({ pushResult: { code: 1, stdout: '', stderr: 'fatal: Authentication failed for https://github.com/...' } });

  await assert.rejects(() => harness.run(), CommandFailedError, 'a push failure that is not a rule violation still fails the job');
  assert.notEqual(harness.outputs.version_committed, 'true');
}

// --- 5. Release commit contents --------------------------------------------

assert.doesNotThrow(() => assertReleaseMetadataOnly(['package.json', 'package-lock.json', 'CHANGELOG.md', '.changeset/fair-owls-release.md']), 'generated release metadata is allowed');
assert.throws(() => assertReleaseMetadataOnly(['package.json', 'src/solve.mjs']), /unvalidated source changes: src\/solve\.mjs/, 'a release must fail closed on unvalidated source changes');

// --- 6. Workflow and helper ------------------------------------------------

assert.equal(existsSync('scripts/release-pull-request.lib.mjs'), false, 'the release pull-request helper stays removed');

const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');
const releaseJob = releaseWorkflow.slice(releaseWorkflow.indexOf('  release:\n'), releaseWorkflow.indexOf('  docker-publish:\n'));
const instantReleaseJob = releaseWorkflow.slice(releaseWorkflow.indexOf('  instant-release:\n'), releaseWorkflow.indexOf('  docker-publish-instant:\n'));
for (const [name, job] of [
  ['release', releaseJob],
  ['instant-release', instantReleaseJob],
]) {
  assert.ok(job.length > 0, `${name} job must exist`);
  assert.match(job, /contents: write/, `${name} pushes the version commit, so it needs contents: write`);
  assert.doesNotMatch(job, /pull-requests: write/, `${name} must not be able to open release pull requests`);
  assert.doesNotMatch(job, /checks: write/, `${name} must not attest checks on a release pull request`);
  assert.match(job, /node scripts\/version-and-commit\.mjs/, `${name} commits the version bump with the direct-push script`);
}
assert.doesNotMatch(releaseWorkflow, /version PR/, 'no step or generated text promises a version pull request');

console.log('release-direct-commit-2402.test.mjs: all assertions passed');
