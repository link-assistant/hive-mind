/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2274.
 *
 * A release commit cannot be merged immediately when the base ruleset requires
 * the `Pipeline Status` check. Pull requests opened with `GITHUB_TOKEN` leave
 * their ordinary pull_request runs in `action_required`, so retrying
 * `gh pr merge` never creates the missing check. The release workflow must
 * explicitly dispatch validation for the generated head and wait for it before
 * attempting the merge.
 */

import assert from 'node:assert/strict';

import { landViaPullRequest } from '../scripts/release-pull-request.lib.mjs';

const calls = [];
let validationPassed = false;

const runner = async (command, args = []) => {
  const call = [command, ...args].join(' ');
  calls.push(call);

  if (call.startsWith('gh pr list')) {
    return { code: 0, stdout: '', stderr: '' };
  }
  if (call.startsWith('gh pr create')) {
    return { code: 0, stdout: 'https://github.com/link-assistant/hive-mind/pull/9999\n', stderr: '' };
  }
  if (call.startsWith('gh workflow run')) {
    return { code: 0, stdout: 'https://github.com/link-assistant/hive-mind/actions/runs/4242\n', stderr: '' };
  }
  if (call === 'gh run watch 4242 --exit-status --compact') {
    validationPassed = true;
    return { code: 0, stdout: '', stderr: '' };
  }
  if (call.startsWith('gh pr merge')) {
    return validationPassed
      ? { code: 0, stdout: '', stderr: '' }
      : { code: 1, stdout: '', stderr: 'Required status check "Pipeline Status" is expected.' };
  }

  return { code: 0, stdout: '', stderr: '' };
};

const result = await landViaPullRequest({
  runner,
  version: '2.31.0',
  runId: '35519980846',
  sleeper: async () => {},
  logger: { log() {}, error() {} },
  sanitizeForPublication: async text => text,
});

assert.equal(result.landed, true);
assert.ok(
  calls.includes('gh workflow run release.yml --ref release/v2.31.0-35519980846 --raw-field release_mode=validate-pr --raw-field bump_type=patch'),
  'the generated release head must receive an explicit validation run'
);
assert.ok(calls.includes('gh run watch 4242 --exit-status --compact'), 'the release must wait for validation to finish successfully');
assert.ok(calls.findIndex(call => call.startsWith('gh run watch')) < calls.findIndex(call => call.startsWith('gh pr merge')), 'validation must finish before the first merge attempt');

console.log('release-required-checks-2274.test.mjs: all assertions passed');
