#!/usr/bin/env node
/**
 * Regression tests for issue #2168.
 *
 * A `gh pr create` call died with
 *   "GraphQL: Something went wrong while executing your query on
 *    2026-08-21T19:28:14Z. Please include `811E:...` when reporting this issue."
 * ~3 seconds after the command was issued - i.e. no retry was attempted at all.
 *
 * Root cause: GitHub's GraphQL API answers internal failures with HTTP 200 plus
 * an `errors[]` payload, so the transient classifier (which only knew TCP/TLS
 * faults and HTTP 5xx) marked the error non-retryable and aborted the session.
 *
 * These tests pin down:
 *   1. the exact failing message is classified as transient,
 *   2. GitHub's support reference id is extracted for post-mortems,
 *   3. gh calls really do get retried on it,
 *   4. network-facing git commands are retried too, and local/terminal
 *      failures still are not,
 *   5. a retried `gh pr create` that lands on "already exists" recovers the
 *      existing pull request URL instead of failing.
 *
 * Run with: node tests/transient-retry-2168.test.mjs
 */

import assert from 'node:assert/strict';

import { describeTransientError, parseGitHubRequestId, isTransientNetworkError, isGitHubServerError, formatTransientDiagnostics } from '../src/transient-errors.lib.mjs';
import { matchGitNetworkCommand, wrapDollarWithGitRetry } from '../src/git-retry.lib.mjs';
import { ghWithRateLimitRetry, wrapDollarWithGhRetry } from '../src/github-rate-limit.lib.mjs';
import { isPullRequestAlreadyExistsError, findExistingPullRequestUrl } from '../src/github-pr-idempotency.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

const test = async (name, fn) => {
  try {
    await fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   ${error.stack || error.message}`);
    testsFailed++;
  }
};

const noop = () => {};

// The verbatim message from the issue-2168 session log.
const ISSUE_2168_MESSAGE = 'GraphQL: Something went wrong while executing your query on 2026-08-21T19:28:14Z. Please include `811E:19A5B0:3A5AA9:37C97F:6A88A6CC` when reporting this issue.';

// ----------------------------------------------------------------------------
// Classification
// ----------------------------------------------------------------------------

console.log('\n📋 transient classification\n');

await test('the exact issue-2168 GraphQL error is transient', () => {
  const description = describeTransientError(new Error(ISSUE_2168_MESSAGE));
  assert.equal(description.transient, true);
  assert.equal(description.category, 'github-server');
  assert.equal(description.matchedPattern, 'something went wrong while executing your query');
});

await test('GitHub support reference id is extracted from the prose form', () => {
  assert.equal(parseGitHubRequestId(new Error(ISSUE_2168_MESSAGE)), '811E:19A5B0:3A5AA9:37C97F:6A88A6CC');
});

await test('GitHub support reference id is extracted from the response header', () => {
  const error = new Error('gh api failed\nx-github-request-id: AAAA:BBBB:CCCC:DDDD:EEEE\n');
  assert.equal(parseGitHubRequestId(error), 'AAAA:BBBB:CCCC:DDDD:EEEE');
});

await test('the GraphQL "may be a GitHub bug" wording is transient too', () => {
  assert.equal(isGitHubServerError(new Error('GraphQL: This may be the result of a timeout, or it could be a GitHub bug.')), true);
});

await test('classification reads stderr and the cause chain', () => {
  assert.equal(isTransientNetworkError({ message: 'command failed', stderr: Buffer.from(ISSUE_2168_MESSAGE) }), true);
  assert.equal(isTransientNetworkError(new Error('wrapper', { cause: new Error(ISSUE_2168_MESSAGE) })), true);
});

await test('real client errors stay non-retryable', () => {
  for (const message of ['HTTP 404: Not Found', 'HTTP 422: Validation Failed', 'GraphQL: Resource not accessible by integration']) {
    assert.equal(isTransientNetworkError(new Error(message)), false, message);
  }
});

await test('diagnostics string carries pattern, category and request id', () => {
  const text = formatTransientDiagnostics(describeTransientError(new Error(ISSUE_2168_MESSAGE)));
  assert.match(text, /transient=yes/);
  assert.match(text, /category=github-server/);
  assert.match(text, /811E:19A5B0:3A5AA9:37C97F:6A88A6CC/);
});

// ----------------------------------------------------------------------------
// gh retry
// ----------------------------------------------------------------------------

console.log('\n📋 gh retry on the issue-2168 error\n');

await test('ghWithRateLimitRetry retries the GraphQL internal error and then succeeds', async () => {
  let attempts = 0;
  const result = await ghWithRateLimitRetry(
    () => {
      attempts++;
      if (attempts < 3) return Promise.reject(new Error(ISSUE_2168_MESSAGE));
      return Promise.resolve('https://github.com/owner/repo/pull/1');
    },
    { log: noop, transientDelay: 1, transientMaxAttempts: 4 }
  );
  assert.equal(attempts, 3);
  assert.equal(result, 'https://github.com/owner/repo/pull/1');
});

await test('ghWithRateLimitRetry gives up after the transient budget and rethrows', async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      ghWithRateLimitRetry(
        () => {
          attempts++;
          return Promise.reject(new Error(ISSUE_2168_MESSAGE));
        },
        { log: noop, transientDelay: 1, transientMaxAttempts: 3 }
      ),
    /Something went wrong while executing your query/
  );
  assert.equal(attempts, 3);
});

// ----------------------------------------------------------------------------
// git network commands
// ----------------------------------------------------------------------------

console.log('\n📋 git network command detection\n');

await test('network subcommands are recognised, local plumbing is not', () => {
  assert.equal(matchGitNetworkCommand('git push origin feature 2>&1'), 'push');
  assert.equal(matchGitNetworkCommand('git fetch upstream'), 'fetch');
  assert.equal(matchGitNetworkCommand('git pull --rebase origin main'), 'pull');
  assert.equal(matchGitNetworkCommand('git ls-remote origin'), 'ls-remote');
  assert.equal(matchGitNetworkCommand('git -C /tmp/work push origin main'), 'push');
  assert.equal(matchGitNetworkCommand('  git   push  origin  main '), 'push');
  assert.equal(matchGitNetworkCommand('git commit -m "x"'), null);
  assert.equal(matchGitNetworkCommand('git status --porcelain'), null);
  assert.equal(matchGitNetworkCommand('gh pr create --draft'), null);
});

await test('git clone is deliberately excluded (a partial clone makes retry misleading)', () => {
  assert.equal(matchGitNetworkCommand('git clone https://github.com/owner/repo /tmp/x'), null);
});

console.log('\n📋 git retry\n');

const makeDollar = responses => {
  let attempts = 0;
  const tag = (strings, ...values) => {
    if (strings && !Array.isArray(strings) && typeof strings === 'object') return tag;
    const response = responses[Math.min(attempts, responses.length - 1)];
    attempts++;
    return Promise.resolve(response);
  };
  tag.attemptCount = () => attempts;
  return tag;
};

await test('a transient git push failure is retried until it succeeds', async () => {
  const dollar = makeDollar([
    { code: 128, stdout: '', stderr: 'fatal: unable to access https://github.com/owner/repo/: Recv failure: Connection reset by peer' },
    { code: 128, stdout: '', stderr: 'error: RPC failed; curl 56 Recv failure' },
    { code: 0, stdout: 'ok', stderr: '' },
  ]);
  const $ = wrapDollarWithGitRetry(dollar, { delay: 1, log: noop });
  const result = await $({ cwd: '/tmp' })`git push origin feature 2>&1`;
  assert.equal(result.code, 0);
  assert.equal(dollar.attemptCount(), 3);
});

await test('a non-fast-forward rejection is NOT retried', async () => {
  const dollar = makeDollar([{ code: 1, stdout: '', stderr: '! [rejected] feature -> feature (non-fast-forward)' }]);
  const $ = wrapDollarWithGitRetry(dollar, { delay: 1, log: noop });
  const result = await $`git push origin feature`;
  assert.equal(result.code, 1);
  assert.equal(dollar.attemptCount(), 1);
});

await test('a permission failure is NOT retried', async () => {
  const dollar = makeDollar([{ code: 128, stdout: '', stderr: 'remote: Permission to owner/repo.git denied to user.' }]);
  const $ = wrapDollarWithGitRetry(dollar, { delay: 1, log: noop });
  const result = await $`git push origin feature`;
  assert.equal(result.code, 128);
  assert.equal(dollar.attemptCount(), 1);
});

await test('local git commands are passed straight through, untouched', async () => {
  const dollar = makeDollar([{ code: 1, stdout: '', stderr: 'nothing to commit' }]);
  const $ = wrapDollarWithGitRetry(dollar, { delay: 1, log: noop });
  const result = await $`git commit -m "x"`;
  assert.equal(result.code, 1);
  assert.equal(dollar.attemptCount(), 1);
});

await test('the gh $ wrapper retries git network commands as well', async () => {
  const dollar = makeDollar([
    { code: 128, stdout: '', stderr: 'fatal: unable to access https://github.com/: The requested URL returned error: 503' },
    { code: 0, stdout: '', stderr: '' },
  ]);
  const $ = wrapDollarWithGhRetry(dollar, { delay: 1, log: noop });
  const result = await $({ cwd: '/tmp' })`git fetch origin`;
  assert.equal(result.code, 0);
  assert.equal(dollar.attemptCount(), 2);
});

// ----------------------------------------------------------------------------
// Write idempotency
// ----------------------------------------------------------------------------

console.log('\n📋 gh pr create idempotency\n');

await test('the "already exists" response is recognised', () => {
  assert.equal(isPullRequestAlreadyExistsError(new Error('a pull request already exists for owner:feature.')), true);
  assert.equal(isPullRequestAlreadyExistsError(new Error('HTTP 422: Validation Failed')), false);
});

await test('the existing pull request URL is recovered after a retried create', async () => {
  const execGh = async command => {
    assert.match(command, /gh pr list/);
    assert.match(command, /--head feature/);
    return { stdout: JSON.stringify([{ url: 'https://github.com/owner/repo/pull/7', number: 7, state: 'OPEN' }]), stderr: '' };
  };
  const url = await findExistingPullRequestUrl({ owner: 'owner', repo: 'repo', headRef: 'feature', execGh, log: noop });
  assert.equal(url, 'https://github.com/owner/repo/pull/7');
});

await test('a fork head ref (fork-owner:branch) is reduced to the branch name', async () => {
  let seen = '';
  const execGh = async command => {
    seen = command;
    return { stdout: '[]', stderr: '' };
  };
  await findExistingPullRequestUrl({ owner: 'owner', repo: 'repo', headRef: 'forkowner:feature', execGh, log: noop });
  assert.match(seen, /--head feature\b/);
});

// ----------------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------------

console.log(`\n📊 ${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) process.exit(1);
