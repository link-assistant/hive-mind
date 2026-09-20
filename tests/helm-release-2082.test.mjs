/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2082, finding F1.
 *
 * `scripts/helm-release.mjs` ran every git command as a bare `await $\`...\``.
 * command-stream's `$` resolves with `.code` instead of throwing, so the
 * wrapping try/catch was decorative: `git checkout gh-pages` aborted on a dirty
 * tree, execution continued on main, `git push origin gh-pages` reported
 * "Everything up-to-date", and the script printed "released successfully!" and
 * exited 0. The public Helm repository stayed frozen at 0.38.8 (2025-12-11)
 * while CI stayed green for ~7 months.
 *
 * These tests pin the three properties that make that failure impossible:
 *   1. a failing command aborts the release (restored `set -e` semantics);
 *   2. the release never switches branches in the dirty release checkout;
 *   3. the published index is verified to contain the released version.
 */

import assert from 'node:assert/strict';

import { CommandFailedError, runStrict } from '../scripts/run-command.lib.mjs';
import { parseChartName, releaseHelmChart, updateChartVersion } from '../scripts/helm-release.lib.mjs';

// --- runStrict restores `set -e` semantics -------------------------------

{
  const ok = await runStrict('true', [], { runner: async () => ({ code: 0, stdout: '', stderr: '' }) });
  assert.equal(ok.code, 0, 'runStrict resolves on exit 0');

  await assert.rejects(
    () => runStrict('git', ['checkout', 'gh-pages'], { runner: async () => ({ code: 1, stdout: '', stderr: 'Aborting' }) }),
    error => {
      assert.ok(error instanceof CommandFailedError, 'a non-zero exit throws CommandFailedError');
      assert.equal(error.code, 1);
      assert.match(error.message, /git checkout gh-pages/, 'the error names the failing command');
      return true;
    },
    'runStrict must throw on a non-zero exit code — this is the guarantee command-stream lacks'
  );
}

// --- Chart.yaml helpers ---------------------------------------------------

{
  const chart = 'apiVersion: v2\nname: hive-mind\nversion: 0.38.8\nappVersion: "0.38.8"\n';
  assert.equal(parseChartName(chart), 'hive-mind');
  const updated = updateChartVersion(chart, '2.8.3');
  assert.match(updated, /^version: 2\.8\.3$/m);
  assert.match(updated, /^appVersion: "2\.8\.3"$/m);
}

// --- Test harness ---------------------------------------------------------

const CHART_YAML = 'apiVersion: v2\nname: hive-mind\nversion: 0.38.8\nappVersion: "0.38.8"\n';

/**
 * Build a fake filesystem plus a recording runner.
 * @param {{fail?: (command: string, args: string[]) => boolean, indexVersions?: string[]}} [options]
 */
function createHarness({ fail = () => false, indexVersions = ['2.8.3'] } = {}) {
  const files = new Map([['helm/hive-mind/Chart.yaml', CHART_YAML]]);
  const calls = [];

  const fs = {
    readFileSync: path => {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
      return files.get(path);
    },
    writeFileSync: (path, content) => files.set(path, content),
    existsSync: path => files.has(path),
    copyFileSync: (from, to) => files.set(to, files.get(from) ?? ''),
    mkdirSync: () => {},
    rmSync: () => {},
  };

  const runner = async (command, args = []) => {
    calls.push([command, ...args].join(' '));
    if (fail(command, args)) {
      return { code: 1, stdout: '', stderr: 'simulated failure' };
    }
    // `helm package` writes the chart archive.
    if (command === 'helm' && args[0] === 'package') {
      files.set('.helm-packages/hive-mind-2.8.3.tgz', 'archive');
    }
    // Reading the published index back out of git.
    if (command === 'git' && args.includes('show') && args.some(a => String(a).endsWith(':index.yaml'))) {
      const entries = indexVersions.map(v => `    - version: ${v}\n`).join('');
      return { code: 0, stdout: `apiVersion: v1\nentries:\n  hive-mind:\n${entries}`, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  return { files, calls, fs, runner, logger: { log() {}, error() {} } };
}

const release = (harness, overrides = {}) =>
  releaseHelmChart({
    version: '2.8.3',
    helmRepoUrl: 'https://link-assistant.github.io/hive-mind',
    githubActor: 'github-actions',
    fs: harness.fs,
    runner: harness.runner,
    logger: harness.logger,
    ...overrides,
  });

// --- 1. A failing command aborts the release ------------------------------

{
  // The exact production failure: the gh-pages checkout fails.
  const harness = createHarness({ fail: (command, args) => command === 'git' && args.includes('worktree') && args.includes('add') });

  await assert.rejects(
    () => release(harness),
    error => error instanceof CommandFailedError,
    'a failing git command must abort the release instead of falling through to "released successfully"'
  );
}

{
  // A failing push must not be reported as a successful release.
  const harness = createHarness({ fail: (command, args) => command === 'git' && args.includes('push') });
  await assert.rejects(() => release(harness), CommandFailedError, 'a failing push must abort the release');
}

{
  // `helm lint` failing must abort before anything is published.
  const harness = createHarness({ fail: command => command === 'helm' });
  await assert.rejects(() => release(harness), CommandFailedError, 'a failing helm command must abort the release');
  assert.ok(!harness.calls.some(call => call.includes('push')), 'nothing is pushed after a lint failure');
}

// --- 2. The release never switches branches in the release checkout -------

{
  const harness = createHarness();
  await release(harness);

  const branchSwitches = harness.calls.filter(call => /^git checkout(?! --orphan)/.test(call));
  assert.deepEqual(branchSwitches, [], 'the release must not `git checkout` in the dirty release tree — this is what aborted in production');

  assert.ok(
    harness.calls.some(call => call.startsWith('git worktree add')),
    'gh-pages is published from an isolated worktree'
  );
  assert.ok(
    harness.calls.some(call => call.startsWith('git worktree remove')),
    'the worktree is cleaned up'
  );
}

// --- 3. The published index is verified ------------------------------------

{
  const harness = createHarness({ indexVersions: ['0.38.8'] }); // push "succeeded" but the version is absent
  await assert.rejects(
    () => release(harness),
    error => {
      assert.match(error.message, /2\.8\.3/, 'the verification error names the missing version');
      return true;
    },
    'a push that does not land the new version must fail the job, not report success'
  );
}

{
  const harness = createHarness({ indexVersions: ['0.38.8', '2.8.3'] });
  const result = await release(harness);
  assert.equal(result.version, '2.8.3');
  assert.equal(result.published, true, 'a release that lands in the index reports success');
}

// --- 4. The chart archive is placed next to index.yaml --------------------

{
  const harness = createHarness();
  await release(harness);
  const indexCall = harness.calls.find(call => call.startsWith('helm repo index'));
  assert.ok(indexCall, 'the repository index is regenerated');
  assert.ok(harness.files.has('.helm-gh-pages/hive-mind-2.8.3.tgz'), 'the .tgz is copied next to index.yaml so its download URL resolves (production emitted a .helm-packages/ URL)');
}

console.log('helm-release-2082.test.mjs: all assertions passed');
