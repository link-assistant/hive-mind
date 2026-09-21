/**
 * @hive-mind-test-suite default
 *
 * Corrected regression coverage for issue #2274.
 *
 * The original fix waited for a successful `workflow_dispatch` run. Production
 * runs 35530983182 and 35536619299 proved that those passing workflow-job
 * checks do not satisfy a pull-request required check. GitHub documents that
 * only checks from eligible events such as `pull_request` are evaluated.
 */

import assert from 'node:assert/strict';

import { landViaPullRequest } from '../scripts/release-pull-request.lib.mjs';

const silent = { log() {}, error() {} };

const calls = [];
let checksPassed = false;
const runner = async (command, args = []) => {
  const call = [command, ...args].join(' ');
  calls.push(call);
  if (call.startsWith('gh pr list')) return { code: 0, stdout: '', stderr: '' };
  if (call.startsWith('gh pr create')) return { code: 0, stdout: 'https://github.com/link-assistant/hive-mind/pull/9999\n', stderr: '' };
  if (call.startsWith('gh pr checks')) {
    checksPassed = true;
    return { code: 0, stdout: 'Pipeline Status\tpass\n', stderr: '' };
  }
  if (call.startsWith('gh pr merge')) {
    return checksPassed ? { code: 0, stdout: '', stderr: '' } : { code: 1, stdout: '', stderr: 'Required status check "Pipeline Status" is expected.' };
  }
  return { code: 0, stdout: '', stderr: '' };
};

const result = await landViaPullRequest({
  runner,
  version: '2.31.0',
  runId: '35536130313',
  releasePullRequestTokenConfigured: true,
  sleeper: async () => {},
  logger: silent,
  sanitizeForPublication: async text => text,
});

assert.equal(result.landed, true);
assert.ok(calls.includes('gh pr checks https://github.com/link-assistant/hive-mind/pull/9999 --watch --fail-fast --interval 10'), 'the generated release PR must receive ordinary PR-associated validation');
assert.ok(calls.findIndex(call => call.startsWith('gh pr checks')) < calls.findIndex(call => call.startsWith('gh pr merge')), 'validation must finish before the first merge attempt');
assert.equal(
  calls.some(call => call.startsWith('gh workflow run')),
  false,
  'a manually dispatched workflow is not eligible proof for a pull-request ruleset'
);

const failedValidationCalls = [];
await assert.rejects(
  landViaPullRequest({
    runner: async (command, args = []) => {
      const call = [command, ...args].join(' ');
      failedValidationCalls.push(call);
      if (call.startsWith('gh pr list')) return { code: 0, stdout: '', stderr: '' };
      if (call.startsWith('gh pr create')) return { code: 0, stdout: 'https://github.com/link-assistant/hive-mind/pull/10000\n', stderr: '' };
      if (call.startsWith('gh pr checks')) return { code: 1, stdout: 'Pipeline Status\tfail\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
    version: '2.31.0',
    runId: 'failed-validation',
    releasePullRequestTokenConfigured: true,
    logger: silent,
    sanitizeForPublication: async text => text,
  }),
  /gh pr checks/,
  'a failed pull-request check must abort release landing'
);
assert.equal(
  failedValidationCalls.some(call => call.startsWith('gh pr merge')),
  false,
  'a release PR with failed validation must never reach merge'
);

console.log('release-required-checks-2274.test.mjs: all assertions passed');
