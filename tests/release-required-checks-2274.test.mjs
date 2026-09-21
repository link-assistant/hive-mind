/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2274, corrected by issue #2281.
 *
 * A manually dispatched workflow does not satisfy a pull-request required
 * check, and a GITHUB_TOKEN-created PR cannot trigger an eligible child run.
 * The release therefore relies on the complete validation already performed
 * by its parent workflow and publishes that result through the Checks API.
 */

import assert from 'node:assert/strict';

import { landViaPullRequest } from '../scripts/release-pull-request.lib.mjs';

const calls = [];
const runner = async (command, args = []) => {
  const call = [command, ...args].join(' ');
  calls.push(call);
  if (call === 'git rev-parse HEAD') return { code: 0, stdout: `${'a'.repeat(40)}\n`, stderr: '' };
  if (call.startsWith('gh pr list')) return { code: 0, stdout: '', stderr: '' };
  if (call.startsWith('gh pr create')) return { code: 0, stdout: 'https://github.com/link-assistant/hive-mind/pull/9999\n', stderr: '' };
  return { code: 0, stdout: '', stderr: '' };
};

const result = await landViaPullRequest({
  runner,
  version: '2.31.0',
  runId: '35536130313',
  sleeper: async () => {},
  logger: { log() {}, error() {} },
  sanitizeForPublication: async text => text,
});

assert.equal(result.landed, true);
assert.equal(
  calls.some(call => call.startsWith('gh workflow run')),
  false,
  'workflow_dispatch checks are ineligible for pull-request rulesets'
);
assert.ok(
  calls.some(call => call.startsWith('gh api') && call.includes('/check-runs')),
  'the parent release publishes an eligible PR-associated check through the GitHub Actions App'
);
assert.ok(
  calls.some(call => call.startsWith('gh pr checks') && call.includes('--required')),
  'the helper observes that required check before merge'
);
assert.ok(
  calls.some(call => call.startsWith('gh pr merge')),
  'the PR merges only after its required check passes'
);

const failedValidationCalls = [];
await assert.rejects(
  landViaPullRequest({
    runner: async (command, args = []) => {
      const call = [command, ...args].join(' ');
      failedValidationCalls.push(call);
      if (call === 'git rev-parse HEAD') return { code: 0, stdout: `${'b'.repeat(40)}\n`, stderr: '' };
      if (call.startsWith('gh pr list')) return { code: 0, stdout: '', stderr: '' };
      if (call.startsWith('gh pr create')) return { code: 0, stdout: 'https://github.com/link-assistant/hive-mind/pull/10000\n', stderr: '' };
      if (call.startsWith('gh pr checks')) return { code: 1, stdout: 'Pipeline Status\tfail\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
    version: '2.31.0',
    runId: 'failed-validation',
    sleeper: async () => {},
    logger: { log() {}, error() {} },
    sanitizeForPublication: async text => text,
  }),
  /gh pr checks/,
  'a failed required check must abort release landing'
);
assert.equal(
  failedValidationCalls.some(call => call.startsWith('gh pr merge')),
  false,
  'a release PR with failed validation must never reach merge'
);

let checkCalls = 0;
const discoverySleeps = [];
await landViaPullRequest({
  runner: async (command, args = []) => {
    const call = [command, ...args].join(' ');
    if (call === 'git rev-parse HEAD') return { code: 0, stdout: `${'c'.repeat(40)}\n`, stderr: '' };
    if (call.startsWith('gh pr list')) return { code: 0, stdout: '', stderr: '' };
    if (call.startsWith('gh pr create')) return { code: 0, stdout: 'https://github.com/link-assistant/hive-mind/pull/10001\n', stderr: '' };
    if (call.startsWith('gh pr checks')) {
      checkCalls += 1;
      return checkCalls === 1 ? { code: 1, stdout: '', stderr: 'no required checks reported' } : { code: 0, stdout: 'Pipeline Status\tpass\n', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  },
  version: '2.31.0',
  runId: 'check-discovery-race',
  sleeper: async ms => discoverySleeps.push(ms),
  logger: { log() {}, error() {} },
  sanitizeForPublication: async text => text,
});
assert.equal(checkCalls, 2, 'a short required-check discovery race is retried');
assert.deepEqual(discoverySleeps, [2000], 'required-check discovery uses the bounded retry delay');

console.log('release-required-checks-2274.test.mjs: all assertions passed');
