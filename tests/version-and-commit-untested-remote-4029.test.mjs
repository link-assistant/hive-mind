/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #4029 (template comparison, item B2).
 *
 * When main moved while a release run was testing its commit, the release job
 * rebased onto the new main and versioned and published it. The new commits
 * were never tested by that run, yet the release reported success: a false
 * positive. Release metadata from another run (or a previous attempt of this
 * one) is still picked up; source changes are left to the run for the newer
 * commit, which tests and releases them.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4029
 */

import assert from 'node:assert/strict';

import { untestedSourcePaths, versionAndCommit } from '../scripts/version-and-commit.lib.mjs';

function harness({ diff, mode = 'changeset', changesets = 1 }) {
  const calls = [];
  const outputs = {};
  const logs = [];
  const runner = async (command, args = []) => {
    const key = [command, ...args].join(' ');
    calls.push(key);
    if (key === 'git rev-parse HEAD') return { code: 0, stdout: 'aaa\n', stderr: '' };
    if (key.startsWith('git rev-parse origin/')) return { code: 0, stdout: 'bbb\n', stderr: '' };
    if (key === 'git diff --name-only aaa bbb') return { code: 0, stdout: diff, stderr: '' };
    if (key === 'git show origin/main:package.json') return { code: 0, stdout: '{"version":"2.0.1"}', stderr: '' };
    if (key === 'git status --porcelain') return { code: 0, stdout: ' M package.json\n', stderr: '' };
    if (key.startsWith('git diff-tree')) return { code: 0, stdout: 'package.json\nCHANGELOG.md\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const call = () =>
    versionAndCommit({
      mode,
      bumpType: 'patch',
      runner,
      output: (key, value) => (outputs[key] = value),
      readVersion: () => '2.0.1',
      countChangesets: () => changesets,
      logger: { log: message => logs.push(message), error() {} },
      sleeper: async () => {},
    });
  return { calls, outputs, logs, call };
}

// 1. Main gained source changes: no rebase, no version, no publish.
{
  const h = harness({ diff: 'src/solve.mjs\ntests/solve.test.mjs\nCHANGELOG.md\n' });
  const result = await h.call();
  assert.equal(result.skippedUntestedRemote, true);
  assert.ok(!h.calls.some(call => call.startsWith('git rebase')), 'the untested commits are not rebased into this release');
  assert.ok(!h.calls.some(call => call.includes('changeset:version')), 'nothing is versioned');
  assert.ok(!h.calls.some(call => call.startsWith('git push')), 'nothing is pushed');
  assert.equal(h.outputs.version_committed, 'false');
  assert.equal(h.outputs.already_released, 'false', 'the publish step must not run either');
  assert.ok(
    h.logs.some(line => line.startsWith('::notice::') && line.includes('src/solve.mjs') && line.includes('bbb')),
    'the log names the untested files and the commit whose run releases them'
  );
}

// 2. The same with no changesets left (a re-run): not reported as already released.
{
  const h = harness({ diff: 'src/solve.mjs\n', changesets: 0 });
  await h.call();
  assert.equal(h.outputs.already_released, 'false', 'a re-run does not publish main either');
}

// 3. Instant (dispatched) releases fail instead of silently dropping the request.
{
  const h = harness({ diff: 'src/solve.mjs\n', mode: 'instant' });
  await assert.rejects(h.call, /changed after this run validated aaa \(src\/solve\.mjs\)\. Dispatch the release again/);
  assert.ok(!h.calls.some(call => call.startsWith('git push')));
}

// 4. Only release metadata and documentation moved: the existing rebase path still runs.
{
  const h = harness({ diff: 'package.json\npackage-lock.json\nCHANGELOG.md\n.changeset/x.md\ndocs/a.md\nREADME.md\n' });
  const result = await h.call();
  assert.notEqual(result.skippedUntestedRemote, true);
  assert.ok(
    h.calls.some(call => call === 'git rebase origin/main'),
    'the rebase onto a metadata-only advance is unchanged'
  );
  assert.equal(h.outputs.version_committed, 'true');
}

// 5. The path filter.
assert.deepEqual(untestedSourcePaths(['package.json', '.changeset/a.md', 'docs/x.png', 'data/y.json', 'experiments/z.mjs', 'dev/log/a.log', 'README.md', 'src/a.mjs', 'scripts/b.sh', 'locales/en.json', '']), ['src/a.mjs', 'scripts/b.sh', 'locales/en.json']);

console.log('version-and-commit-untested-remote-4029: all assertions passed');
