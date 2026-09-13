/**
 * @hive-mind-test-suite default
 *
 * `handleBillingLimitBlocker` was lifted out of `solve.auto-merge.lib.mjs`
 * while fixing issue #2247: the #2247 changes brought that file back over the
 * 1350-line early-warning threshold `scripts/check-file-line-limits.sh` emits,
 * which `tests/extracted-modules-2198.test.mjs` asserts against.
 *
 * The move is behaviour-preserving, so this pins the behaviour that used to be
 * unreachable from a test because it closed over the loop's local state: a
 * private repository stops the run and asks a human (issue #1314 - restarting
 * the AI cannot pay a bill), a public one only backs off, and a comment that
 * fails to post never masks the stop.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2247
 * @see https://github.com/link-assistant/hive-mind/issues/1314
 */

import assert from 'node:assert/strict';

import { buildBillingLimitComment, handleBillingLimitBlocker, nextBillingBackoffSeconds } from '../src/billing-limit-stop.lib.mjs';

const blocker = { type: 'billing_limit', details: ['build', 'test'], allJobsAffected: true, billingMessage: 'The job was not started because spending limit is reached' };
const formatAligned = (icon, label, value) => `${icon} ${label} ${value}`;

const harness = ({ isPrivate, postComment } = {}) => {
  const logs = [];
  const comments = [];
  const errors = [];
  return {
    logs,
    comments,
    errors,
    params: {
      blocker,
      owner: 'konard',
      repo: 'test-hello-world',
      prNumber: 2,
      $: () => {},
      log: async message => logs.push(String(message)),
      formatAligned,
      postComment:
        postComment ||
        (async body => {
          comments.push(body);
        }),
      reportError: (error, context) => errors.push([error.message, context.context]),
      backoffSeconds: 60,
      getRepoVisibility: async () => ({ isPrivate }),
    },
  };
};

// A private repository: the loop stops and a human is asked.
{
  const { params, logs, comments } = harness({ isPrivate: true });
  const result = await handleBillingLimitBlocker(params);
  assert.equal(result.stopped, true);
  assert.equal(result.backoffSeconds, 60, 'a stopped loop does not back off');
  assert.equal(comments.length, 1);
  assert.match(comments[0].body, /GitHub Actions Billing Limit Reached/);
  assert.match(comments[0].body, /- build\n- test/);
  assert.equal(comments[0].targetNumber, 2);
  assert.ok(logs.some(line => line.includes('STOPPING')));
}

// A public repository: unusual, so wait rather than stop or restart the AI.
{
  const { params, logs, comments } = harness({ isPrivate: false });
  const result = await handleBillingLimitBlocker(params);
  assert.equal(result.stopped, false);
  assert.equal(result.backoffSeconds, 120, 'the backoff doubles');
  assert.equal(comments.length, 0, 'no human is asked for a repository with free CI');
  assert.ok(logs.some(line => line.includes('exponential backoff')));
}

// A comment that cannot be posted is reported, but the stop still stands.
{
  const { params, errors } = harness({
    isPrivate: true,
    postComment: async () => {
      throw new Error('GitHub API is down');
    },
  });
  const result = await handleBillingLimitBlocker(params);
  assert.equal(result.stopped, true);
  assert.deepEqual(errors, [['GitHub API is down', 'post_billing_limit_comment']]);
}

assert.equal(nextBillingBackoffSeconds(1800), 3600);
assert.equal(nextBillingBackoffSeconds(3600), 3600, 'the backoff is capped at an hour');

// The fallback message keeps the pattern the detector matches on.
assert.match(buildBillingLimitComment({ details: [] }), /spending limit/i);

console.log('PASS: billing-limit stop extracted for #2247');
