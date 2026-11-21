#!/usr/bin/env node
/**
 * Regression tests for issue #3552.
 *
 * The initial `git push -u origin issue-375-57d02718cf74` of a solve run was
 * answered by GitHub with
 *
 *   remote: fatal error in commit_refs
 *   To https://github.com/konard/G-Ivan-A-mango_ba_prompts.git
 *    ! [remote rejected]   issue-375-57d02718cf74 -> issue-375-57d02718cf74 (failure)
 *   error: failed to push some refs to '...'
 *
 * `fatal error in commit_refs` is GitHub's receive-pack failing to commit the
 * ref update on its own side (a server-side fault — a rerun of the same task
 * 20 minutes later pushed fine). Two defects turned it into a hard failure:
 *
 *   1. the transient classifier did not know the string, so the git retry
 *      wrapper logged `not retrying [transient=no]` and gave up after one try;
 *   2. the rejection handler treated every `[remote rejected]` as a history
 *      divergence and reported "Local and remote branch histories differ",
 *      although the remote branch did not even exist.
 *
 * Run with: node tests/push-github-server-error-3552.test.mjs
 */

import assert from 'node:assert/strict';

import { describeTransientError, isGitHubServerError, isTransientNetworkError } from '../src/transient-errors.lib.mjs';
import { wrapDollarWithGitRetry } from '../src/git-retry.lib.mjs';
import { wrapDollarWithGhRetry } from '../src/github-rate-limit.lib.mjs';
import { buildPushRejectionExplanation, classifyPushRejection, handleRejectedPushForAutoPr } from '../src/solve.branch-divergence.lib.mjs';
import { buildPrePullRequestFailureActionSection } from '../src/solve.pre-pr-failure-notifier.lib.mjs';
import { isNonFastForward, pushWithRebaseRetry } from '../scripts/version-and-commit.lib.mjs';
import { pushWithTransientRetry } from '../scripts/helm-release.lib.mjs';

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

const noop = async () => {};

// Verbatim from the failed run's log (issue #3552).
const BRANCH = 'issue-375-57d02718cf74';
const INCIDENT_OUTPUT = ['remote: fatal error in commit_refs        ', 'To https://github.com/konard/G-Ivan-A-mango_ba_prompts.git', ` ! [remote rejected]   ${BRANCH} -> ${BRANCH} (failure)`, "error: failed to push some refs to 'https://github.com/konard/G-Ivan-A-mango_ba_prompts.git'"].join('\n');
const MISSING_REMOTE_REF = `fatal: couldn't find remote ref refs/heads/${BRANCH}`;

const result = ({ code = 0, stdout = '', stderr = '' } = {}) => ({ code, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) });

const makeDollar = responses => {
  let attempts = 0;
  const tag = strings => {
    if (strings && !Array.isArray(strings) && typeof strings === 'object') return tag;
    const response = responses[Math.min(attempts, responses.length - 1)];
    attempts++;
    return Promise.resolve(result(response));
  };
  tag.attemptCount = () => attempts;
  return tag;
};

const createMockDollar = resolver => {
  const calls = [];
  const dollar =
    () =>
    async (strings, ...values) => {
      const command = strings.reduce((text, part, index) => text + part + (values[index] ?? ''), '');
      calls.push(command);
      return resolver(command);
    };
  dollar.calls = calls;
  return dollar;
};

const handlerArgs = overrides => ({
  errorOutput: INCIDENT_OUTPUT,
  tempDir: '/tmp/repro-3552',
  formatAligned: (icon, label, message) => `${icon} ${label} ${message}`,
  branchName: BRANCH,
  isContinueMode: false,
  prNumber: null,
  owner: 'G-Ivan-A',
  repo: 'mango_ba_prompts',
  defaultBranch: 'main',
  forkedRepo: 'konard/G-Ivan-A-mango_ba_prompts',
  ...overrides,
});

console.log('🧪 Issue #3552: GitHub server-side push failures\n');

await test('`fatal error in commit_refs` is classified as a transient GitHub server error', () => {
  const description = describeTransientError({ message: INCIDENT_OUTPUT });
  assert.equal(description.transient, true);
  assert.equal(description.category, 'github-server');
  assert.equal(description.matchedPattern, 'fatal error in commit_refs');
  assert.equal(isTransientNetworkError(INCIDENT_OUTPUT), true);
  assert.equal(isGitHubServerError(INCIDENT_OUTPUT), true);
});

await test('the git retry wrapper retries the failed push until GitHub accepts it', async () => {
  const dollar = makeDollar([
    { code: 1, stdout: INCIDENT_OUTPUT },
    { code: 1, stdout: INCIDENT_OUTPUT },
    { code: 0, stdout: `branch '${BRANCH}' set up to track 'origin/${BRANCH}'.` },
  ]);
  const $ = wrapDollarWithGitRetry(dollar, { delay: 1, log: noop });
  const pushed = await $({ cwd: '/tmp' })`git push -u origin ${BRANCH} 2>&1`;
  assert.equal(pushed.code, 0);
  assert.equal(dollar.attemptCount(), 3);
});

await test('the gh/git $ wrapper used by solve.auto-pr retries it too, and logs why', async () => {
  const logs = [];
  const dollar = makeDollar([{ code: 1, stdout: INCIDENT_OUTPUT }, { code: 0 }]);
  const $ = wrapDollarWithGhRetry(dollar, { delay: 1, log: async message => logs.push(String(message)) });
  const pushed = await $({ cwd: '/tmp' })`git push -u origin ${BRANCH} 2>&1`;
  assert.equal(pushed.code, 0);
  assert.equal(dollar.attemptCount(), 2);
  assert.match(logs.join('\n'), /transient git error .*category=github-server pattern="fatal error in commit_refs"/);
});

await test('genuine rejections are still not retried', async () => {
  for (const stderr of [`! [rejected] ${BRANCH} -> ${BRANCH} (non-fast-forward)`, ` ! [remote rejected] main -> main (permission denied)`, ` ! [remote rejected] main -> main (push declined due to repository rule violations)`]) {
    const dollar = makeDollar([{ code: 1, stderr }]);
    const $ = wrapDollarWithGitRetry(dollar, { delay: 1, log: noop });
    const pushed = await $`git push origin ${BRANCH}`;
    assert.equal(pushed.code, 1, stderr);
    assert.equal(dollar.attemptCount(), 1, stderr);
  }
});

await test('the rejection is classified as a GitHub server error, not a divergence', () => {
  assert.equal(classifyPushRejection(INCIDENT_OUTPUT), 'github-server-error');
  // The existing classes keep their meaning.
  assert.equal(classifyPushRejection(` ! [rejected] a -> a (non-fast-forward)`), 'non-fast-forward');
  assert.equal(classifyPushRejection(` ! [remote rejected] a -> a (cannot lock ref 'refs/heads/a': reference already exists)`), 'remote-ref-already-exists');
  assert.equal(classifyPushRejection(` ! [remote rejected] a -> a (permission denied)`), 'remote-rejected');
});

await test('the explanation never claims the remote changed when the remote branch does not exist', () => {
  const text = buildPushRejectionExplanation({
    branchName: BRANCH,
    owner: 'G-Ivan-A',
    repo: 'mango_ba_prompts',
    forkedRepo: 'konard/G-Ivan-A-mango_ba_prompts',
    classification: 'non-fast-forward',
    divergence: { remoteExists: false, ahead: null, behind: null, fetchError: MISSING_REMOTE_REF },
  }).join('\n');
  assert.doesNotMatch(text, /remote branch changed after the local branch state/);
  assert.match(text, /does not exist/);
});

await test('handler: server error with no remote branch fails with a GitHub-server diagnosis, not "histories differ"', async () => {
  const logs = [];
  const $ = createMockDollar(command => {
    if (command.startsWith(`git fetch origin refs/heads/${BRANCH}`)) return result({ code: 128, stdout: MISSING_REMOTE_REF });
    return result({ code: 1, stderr: `unexpected command: ${command}` });
  });
  await assert.rejects(handleRejectedPushForAutoPr({ ...handlerArgs(), $, log: async message => logs.push(String(message)) }), error => {
    assert.match(error.message, /GitHub server error while pushing konard\/G-Ivan-A-mango_ba_prompts:issue-375-57d02718cf74/);
    assert.equal(error.hiveMindUserFacingLogged, true);
    assert.match(error.failureActionSection, /githubstatus\.com/);
    assert.match(error.failureActionSection, /[Rr]erun the solver/);
    assert.doesNotMatch(error.failureActionSection, /Diverged-history path/);
    return true;
  });
  const text = logs.join('\n');
  assert.match(text, /GITHUB SERVER ERROR/);
  assert.match(text, /remote: fatal error in commit_refs/);
  assert.match(text, /not a branch divergence/);
  assert.match(text, /does not exist/);
  assert.doesNotMatch(text, /Local and remote branch histories differ/);
  assert.doesNotMatch(text, /remote branch changed after the local branch state/);
  assert.doesNotMatch(text, /git pull origin/);
});

await test('handler: server error after which the ref landed anyway recovers and continues', async () => {
  const sha = '278a01e4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const $ = createMockDollar(command => {
    if (command.startsWith(`git fetch origin refs/heads/${BRANCH}`)) return result();
    if (command.startsWith('git rev-list --count')) return result({ stdout: '0\n' });
    if (command.startsWith('git rev-parse')) return result({ stdout: `${sha}\n` });
    return result({ code: 1, stderr: `unexpected command: ${command}` });
  });
  const handled = await handleRejectedPushForAutoPr({ ...handlerArgs(), $, log: noop });
  assert.equal(handled.handled, true);
  assert.equal(handled.branchReadyForPrCreation, true);
  assert.equal(handled.recoveredFromPushRejection, true);
});

await test('pre-PR failure comment for a GitHub server error tells the user to rerun, not to merge', () => {
  const section = buildPrePullRequestFailureActionSection(`GitHub server error while pushing konard/G-Ivan-A-mango_ba_prompts:${BRANCH}; compare https://github.com/G-Ivan-A/mango_ba_prompts/compare/main...konard:${BRANCH} and inspect https://github.com/konard/G-Ivan-A-mango_ba_prompts/tree/${BRANCH}`);
  assert.match(section, /githubstatus\.com/);
  assert.match(section, /[Rr]erun the solver/);
  assert.doesNotMatch(section, /merge the remote branch state/);
});

await test('release push: a GitHub server error is retried without rebasing', async () => {
  const commands = [];
  const responses = [{ code: 1, stderr: INCIDENT_OUTPUT.replaceAll(BRANCH, 'main') }, { code: 0 }];
  const runner = async (command, args) => {
    commands.push(`${command} ${args.join(' ')}`);
    return commands.length <= responses.length ? responses[commands.length - 1] : { code: 0 };
  };
  const pushed = await pushWithRebaseRetry({ runner, sleeper: noop, logger: { log: () => {} } });
  assert.deepEqual(pushed, { pushed: true, attempt: 2 });
  assert.deepEqual(commands, ['git push origin main', 'git push origin main']);
  assert.equal(isNonFastForward({ stderr: INCIDENT_OUTPUT }), false);
});

await test('helm gh-pages push: a GitHub server error is retried, a permission error is not', async () => {
  const run = async responses => {
    const commands = [];
    const runner = async (command, args) => {
      commands.push(`${command} ${args.join(' ')}`);
      return responses[Math.min(commands.length, responses.length) - 1];
    };
    try {
      return { result: await pushWithTransientRetry(['push', 'origin', 'HEAD:gh-pages'], { runner, sleeper: noop, logger: { log: () => {} } }), commands };
    } catch (error) {
      return { error, commands };
    }
  };
  const serverError = { code: 1, stderr: INCIDENT_OUTPUT.replaceAll(BRANCH, 'gh-pages') };
  const recovered = await run([serverError, { code: 0 }]);
  assert.equal(recovered.result.code, 0);
  assert.equal(recovered.commands.length, 2);
  const exhausted = await run([serverError]);
  assert.match(exhausted.error.message, /git push origin HEAD:gh-pages/);
  assert.equal(exhausted.commands.length, 3);
  const denied = await run([{ code: 128, stderr: 'remote: Permission to owner/repo.git denied to bot.' }]);
  assert.ok(denied.error);
  assert.equal(denied.commands.length, 1);
});

console.log(`\n📊 ${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) process.exit(1);
