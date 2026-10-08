/**
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/1782
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { EventEmitter } from 'node:events';
import { evaluateCiCdHealth, detectPublishing, buildRepairSolveArgs } from '../src/solve.auto-fix-ci-cd.detect.lib.mjs';
import { runAutoFixCiCd, solveCiCdIssue, buildRemediationIssueBody } from '../src/solve.auto-fix-ci-cd.lib.mjs';
import { resetAutoRestartBudget } from '../src/auto-restart-budget.lib.mjs';

beforeEach(() => resetAutoRestartBudget());

const green = [{ id: 1, name: 'Release', status: 'completed', conclusion: 'success' }];
const published = [{ kind: 'github-release', verified: true, detail: 'v1.0.0 contains merge' }];
const healthy = { success: true, runs: green, outputs: published, errors: [] };
const missing = { success: false, runs: green, outputs: [], errors: ['No release or deployment was published.'] };

test('reproduction: green CI without a release or deployment remains an error', () => {
  const result = evaluateCiCdHealth({ runs: green, outputs: [], fresh: true });
  assert.equal(result.success, false);
  assert.match(result.errors.join(' '), /release or deployment/i);
});

test('all detected outputs must be verified, even when other outputs exist', () => {
  for (const kind of ['github-release', 'npm', 'pypi', 'crates', 'pages']) {
    const result = evaluateCiCdHealth({ runs: green, outputs: [...published, { kind, verified: false, detail: `${kind} missing` }], fresh: true });
    assert.equal(result.success, false, kind);
    assert.ok(result.errors.includes(`${kind} missing`));
  }
  assert.equal(evaluateCiCdHealth({ runs: green, outputs: published, fresh: true }).success, true);
});

test('pending, failed, cancelled and stale CI cannot pass', () => {
  assert.equal(evaluateCiCdHealth({ runs: [], outputs: published, fresh: false }).pending, true);
  assert.equal(evaluateCiCdHealth({ runs: green, outputs: published, fresh: false }).success, false);
  assert.equal(evaluateCiCdHealth({ runs: [{ status: 'queued' }], outputs: published, fresh: true }).pending, true);
  for (const conclusion of ['failure', 'timed_out', 'cancelled', 'action_required', 'unknown']) {
    const result = evaluateCiCdHealth({ runs: [{ ...green[0], conclusion }], outputs: published, fresh: true });
    assert.equal(result.success, false, conclusion);
    assert.ok(result.errors.some(error => error.includes(conclusion)));
  }
});

test('detect publishing commands, actions and helper scripts; ignore comments', () => {
  assert.deepEqual(detectPublishing('# npm publish\n# uses: actions/deploy-pages@v4'), []);
  assert.deepEqual(detectPublishing('run: npm publish\nuses: softprops/action-gh-release@v2\nuses: actions/deploy-pages@v4'), ['github-release', 'npm', 'pages']);
  assert.ok(detectPublishing('run: node scripts/publish-to-npm.mjs').includes('npm'));
  assert.ok(detectPublishing('run: twine upload dist/*').includes('pypi'));
  assert.ok(detectPublishing('uses: pypa/gh-action-pypi-publish@release/v1').includes('pypi'));
  assert.ok(detectPublishing('run: cargo publish').includes('crates'));
});

test('repair handoff preserves worker options but discards the previous session', () => {
  const args = buildRepairSolveArgs('https://github.com/o/r/issues/2', ['https://github.com/o/r/issues/1', '--auto-merge', '--auto-fix-ci-cd', '--tool', 'codex', '--model=gpt-test', '--think', 'high', '--working-directory', '/old', '--resume=old-session', '--continue', '--isolated', 'screen']);
  assert.ok(args.includes('--tool'));
  assert.ok(args.includes('codex'));
  assert.ok(args.includes('--model=gpt-test'));
  assert.ok(args.includes('--think'));
  assert.ok(args.includes('--auto-merge'));
  assert.ok(args.includes('--no-auto-fix-ci-cd'));
  assert.ok(!args.includes('--auto-fix-ci-cd'));
  assert.ok(!args.includes('/old'));
  assert.ok(!args.includes('--resume=old-session'));
  assert.ok(!args.includes('--continue'));
  assert.ok(!args.includes('--isolated'));
});

test('handoff supports flags before the issue URL and keeps option values', () => {
  const args = buildRepairSolveArgs('https://github.com/o/r/issues/2', ['--tool', 'codex', 'https://github.com/o/r/issues/1', '--think=high', '--no-auto-merge', '--resume', 'old', '-b', 'old-target']);
  assert.ok(!args.includes('https://github.com/o/r/issues/1'));
  assert.ok(args.includes('codex'));
  assert.ok(args.includes('--think=high'));
  assert.ok(args.includes('--auto-merge'));
  assert.ok(!args.includes('--no-auto-merge'));
  assert.ok(!args.includes('old'));
  assert.ok(!args.includes('old-target'));
});

test('disabled, unmerged, and auto-merge-free calls do not create remediation issues', async () => {
  let calls = 0;
  const dependencies = {
    getTarget: async () => {
      calls++;
      return null;
    },
  };
  await runAutoFixCiCd({ argv: {}, dependencies });
  assert.equal(calls, 0);
  await assert.rejects(runAutoFixCiCd({ argv: { autoFixCiCd: true }, dependencies }), /requires --auto-merge/);
  await runAutoFixCiCd({ argv: { autoMerge: true, autoFixCiCd: true }, owner: 'o', repo: 'r', prNumber: 1, dependencies });
  assert.equal(calls, 1);
});

test('failed CI creates an issue, solves it, then rechecks until published', async () => {
  const events = [];
  let checks = 0;
  await runAutoFixCiCd({
    argv: { autoMerge: true, autoFixCiCd: true, autoRestartMaxIterations: 3 },
    owner: 'o',
    repo: 'r',
    prNumber: 1,
    dependencies: {
      getTarget: async () => ({ sha: 'merge', branch: 'main', since: '2026-01-01T00:00:00Z' }),
      monitor: async () => {
        events.push('check');
        return checks++ < 2 ? missing : healthy;
      },
      createIssue: async ({ health }) => {
        assert.equal(health.success, false);
        events.push('issue');
        return { url: 'https://github.com/o/r/issues/2' };
      },
      solve: async () => {
        events.push('solve');
      },
      refreshTarget: async () => ({ sha: `repair-${checks}`, branch: 'main', since: '2026-01-02T00:00:00Z' }),
    },
  });
  assert.deepEqual(events, ['check', 'issue', 'solve', 'check', 'issue', 'solve', 'check']);
});

test('repair limit and child failure stop without falsely reporting success', async () => {
  let issues = 0;
  const dependencies = {
    getTarget: async () => ({ sha: 'merge', branch: 'main' }),
    monitor: async () => missing,
    createIssue: async () => {
      issues++;
      return { url: 'https://github.com/o/r/issues/2' };
    },
    solve: async () => {
      throw new Error('solve exited with code 1');
    },
  };
  await assert.rejects(runAutoFixCiCd({ argv: { autoMerge: true, autoFixCiCd: true, autoRestartMaxIterations: 0 }, dependencies }), /solve exited/);
  assert.equal(issues, 1);
});

test('finite restart budget stops the repair chain before another issue is created', async () => {
  let issues = 0;
  await assert.rejects(
    runAutoFixCiCd({
      argv: { autoMerge: true, autoFixCiCd: true, autoRestartMaxIterations: 1 },
      dependencies: {
        getTarget: async () => ({ sha: 'merge', branch: 'stable' }),
        monitor: async () => missing,
        createIssue: async () => {
          issues++;
          return { url: 'https://github.com/o/r/issues/2' };
        },
        solve: async args => {
          assert.ok(args.includes('--base-branch=stable'));
        },
        refreshTarget: async () => ({ sha: 'repair', branch: 'stable' }),
      },
    }),
    /repair limit reached/
  );
  assert.equal(issues, 1);
});

test('unchanged target branch stops; no further issue is created', async () => {
  await assert.rejects(
    runAutoFixCiCd({
      argv: { autoMerge: true, autoFixCiCd: true },
      dependencies: {
        getTarget: async () => ({ sha: 'merge', branch: 'main' }),
        monitor: async () => missing,
        createIssue: async () => ({ url: 'https://github.com/o/r/issues/2' }),
        solve: async () => {},
        refreshTarget: async () => ({ sha: 'merge', branch: 'main' }),
      },
    }),
    /did not advance/
  );
});

test('interruption waits for the repair child and restores signal ownership', async () => {
  const originalHandlers = process.listeners('SIGTERM');
  const child = new EventEmitter();
  const events = [];
  child.kill = signal => events.push(signal);
  const pending = solveCiCdIssue([], { spawnChild: () => child, delegateSignals: enabled => events.push(enabled) });
  const forward = process.listeners('SIGTERM').find(handler => !originalHandlers.includes(handler));
  forward();
  child.emit('close', 0, null);
  await assert.rejects(pending, /interrupted/);
  assert.deepEqual(events, [true, 'SIGTERM', false]);
  assert.deepEqual(process.listeners('SIGTERM'), originalHandlers);
});

test('repair child failures restore signal ownership and reject', async () => {
  for (const event of ['error', 'close']) {
    const child = new EventEmitter();
    const ownership = [];
    const pending = solveCiCdIssue([], { spawnChild: () => child, delegateSignals: enabled => ownership.push(enabled) });
    if (event === 'error') child.emit('error', new Error('spawn failed'));
    else child.emit('close', 1, null);
    await assert.rejects(pending, /spawn failed|exited/);
    assert.deepEqual(ownership, [true, false]);
  }
});

test('remediation issues describe the actual target branch and failed runs', () => {
  const body = buildRemediationIssueBody({
    repository: { fullName: 'o/r', url: 'https://github.com/o/r' },
    prepared: { languages: [], body: 'Recent CI/CD runs on `main`: unrelated-old-sha' },
    target: { branch: 'stable', sha: 'repair-merge', since: '2026-01-01T00:00:00Z' },
    health: { ...missing, runs: [{ name: 'Stable publisher', status: 'completed', conclusion: 'failure' }] },
  });
  assert.ok(!body.includes('unrelated-old-sha'));
  assert.ok(!body.includes('runs on `main`'));
  assert.match(body, /runs on `stable`/);
  assert.match(body, /Stable publisher/);
  assert.match(body, /No release or deployment was published/);
});
