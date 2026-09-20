/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2082, finding F4.
 *
 * `scripts/version-and-commit.mjs` ran every git command as a bare
 * `await $\`...\``. command-stream's `$` resolves with `.code` instead of
 * throwing, so the wrapping try/catch never fired — the same defect as F1 in
 * scripts/helm-release.mjs.
 *
 * The consequence here is worse than a no-op. `git push origin main` is racy by
 * construction: the release workflow pushes the version bump to main while other
 * runs and merges push to the same branch. When the push is rejected as
 * non-fast-forward, the old code printed "Version bump committed and pushed to
 * main", set `version_committed=true`, and exited 0 — handing the downstream
 * publish job a version that exists only in the runner's local checkout.
 *
 * These tests pin:
 *   1. a failing command aborts, rather than reporting a successful bump;
 *   2. a rejected push is retried on top of the new remote HEAD;
 *   3. `version_committed=true` is only ever emitted after the push really landed.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2082
 */

import assert from 'node:assert/strict';

import { CommandFailedError } from '../scripts/run-command.lib.mjs';
import { pushWithRebaseRetry, versionAndCommit } from '../scripts/version-and-commit.lib.mjs';

const REJECTED = {
  code: 1,
  stdout: '',
  stderr: " ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to 'https://github.com/link-assistant/hive-mind'\n",
};

/**
 * Build a recording runner.
 *
 * @param {object} [options]
 * @param {(command: string, args: string[], callIndex: number) => object|null} [options.respond]
 *   Return a result object to override the default success, or null for success.
 */
function createHarness({ respond = () => null, status = ' M package.json\n', version = '2.9.0' } = {}) {
  const calls = [];
  const outputs = {};
  let index = 0;

  const runner = async (command, args = []) => {
    const key = [command, ...args].join(' ');
    calls.push(key);
    const override = respond(command, args, index++);
    if (override) {
      return { stdout: '', stderr: '', ...override };
    }
    if (key === 'git status --porcelain') {
      return { code: 0, stdout: status, stderr: '' };
    }
    if (key.startsWith('git rev-parse')) {
      return { code: 0, stdout: 'abc123\n', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  return {
    calls,
    outputs,
    runner,
    output: (key, value) => {
      outputs[key] = value;
    },
    readVersion: () => version,
    logger: { log() {}, error() {} },
  };
}

const run = (harness, overrides = {}) =>
  versionAndCommit({
    mode: 'changeset',
    runner: harness.runner,
    output: harness.output,
    readVersion: harness.readVersion,
    countChangesets: () => 1,
    logger: harness.logger,
    sleeper: async () => {},
    ...overrides,
  });

// --- 1. A failing command aborts the run ----------------------------------

{
  // `npm run changeset:version` fails: no commit, no push, no green output.
  const harness = createHarness({
    respond: (command, args) => (command === 'npm' && args.includes('changeset:version') ? { code: 1 } : null),
  });

  await assert.rejects(() => run(harness), CommandFailedError, 'a failing version bump must abort instead of continuing to commit and push');

  assert.ok(!harness.calls.some(call => call.startsWith('git push')), 'nothing is pushed after the version bump failed');
  assert.notEqual(harness.outputs.version_committed, 'true', 'version_committed must not be set after a failed bump');
}

{
  const harness = createHarness({
    respond: command => (command === 'git' ? null : { code: 0 }),
    status: '',
  });
  await run(harness);
  assert.equal(harness.outputs.version_committed, 'false', 'a clean tree reports no commit');
  assert.ok(!harness.calls.some(call => call.startsWith('git push')), 'a clean tree pushes nothing');
}

// --- 2. A rejected push is rebased and retried ----------------------------

{
  // The production race: another run pushed to main between our fetch and push.
  let pushes = 0;
  const harness = createHarness({
    respond: (command, args) => {
      if (command === 'git' && args[0] === 'push') {
        pushes += 1;
        return pushes === 1 ? REJECTED : null;
      }
      return null;
    },
  });

  await run(harness);

  assert.equal(pushes, 2, 'a rejected push is retried');
  const firstPush = harness.calls.indexOf('git push origin main');
  const rebase = harness.calls.findIndex(call => call.startsWith('git pull --rebase'));
  assert.ok(rebase > firstPush, 'the retry rebases onto the new remote HEAD before pushing again — a bare retry would be rejected identically');
  assert.equal(harness.outputs.version_committed, 'true', 'a push that succeeds on retry is a successful bump');
}

{
  // A push that never succeeds must fail the job loudly.
  const harness = createHarness({ respond: (command, args) => (command === 'git' && args[0] === 'push' ? REJECTED : null) });

  await assert.rejects(() => run(harness), CommandFailedError, 'a push that is rejected on every attempt must fail the job — this is what silently went green in production');

  assert.notEqual(harness.outputs.version_committed, 'true', 'version_committed must never be true when the push did not land');
}

// --- 3. pushWithRebaseRetry in isolation ----------------------------------

{
  const attempts = [];
  const runner = async (command, args = []) => {
    const key = [command, ...args].join(' ');
    attempts.push(key);
    return key === 'git push origin main' && attempts.filter(a => a.startsWith('git push')).length < 3 ? REJECTED : { code: 0, stdout: '', stderr: '' };
  };

  const result = await pushWithRebaseRetry({ runner, branch: 'main', sleeper: async () => {}, logger: { log() {}, error() {} } });
  assert.equal(result.attempt, 3, 'the push succeeds on the third attempt');

  await assert.rejects(
    () =>
      pushWithRebaseRetry({
        runner: async () => REJECTED,
        branch: 'main',
        maxAttempts: 2,
        sleeper: async () => {},
        logger: { log() {}, error() {} },
      }),
    CommandFailedError,
    'exhausting the retries throws rather than returning quietly'
  );
}

console.log('version-and-commit-2082.test.mjs: all assertions passed');
