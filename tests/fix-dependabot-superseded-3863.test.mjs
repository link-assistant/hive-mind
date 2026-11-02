/**
 * Regression coverage for issue #3863: `/fix --update-all-dependencies` left
 * all five open Dependabot pull requests of konard/medical-neural-network-ml
 * (#13–#17) open. Each conflicted with `main`, which already had the same or
 * newer versions ("the merge commit cannot be cleanly created"), the merge was
 * pointlessly retried with `--admin`, and Dependabot never closed them because
 * its configuration no longer covered their file.
 *
 * The fixtures are the real diffs, pull requests and base-branch files saved
 * in docs/case-studies/issue-3863/raw.
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildDependabotPullRequestsSection, isMergeConflictError, mergeDependabotPullRequests, summarizeDependabotPullRequests } from '../src/fix.dependabot-merge.lib.mjs';
import { checkSupersededByBase, collectDependencies, compareVersions, evaluateSupersession, parseDependencyLine, parseRequirement, parseUnifiedDiff, requirementSatisfies } from '../src/fix.dependabot-superseded.lib.mjs';

const raw = new URL('../docs/case-studies/issue-3863/raw/', import.meta.url);
const readRaw = name => readFile(new URL(name, raw), 'utf8');
const repository = { owner: 'konard', repo: 'medical-neural-network-ml', fullName: 'konard/medical-neural-network-ml', url: 'https://github.com/konard/medical-neural-network-ml' };
const incidentNumbers = [13, 14, 15, 16, 17];
const CONFLICT = 'X Pull request konard/medical-neural-network-ml#{n} is not mergeable: the merge commit cannot be cleanly created.\n';

const baseFiles = {
  'scripts/unimedvl-requirements.txt': await readRaw('base-at-issue-creation-unimedvl-requirements.txt'),
  'pyproject.toml': await readRaw('base-at-issue-creation-pyproject.toml'),
};
const diffs = Object.fromEntries(await Promise.all(incidentNumbers.map(async number => [number, await readRaw(`pr-${number}.diff`)])));

/** The pull requests as `gh pr list` returned them when issue #25 was created: mergeability not yet computed. */
async function incidentPullRequests(mergeable = 'UNKNOWN') {
  return Promise.all(
    incidentNumbers.map(async number => {
      const pr = JSON.parse(await readRaw(`pr-${number}.json`));
      return { number: pr.number, title: pr.title, url: pr.url, author: pr.author, baseRefName: pr.baseRefName, headRefName: pr.headRefName, headRefOid: pr.headRefOid, isDraft: pr.isDraft, mergeable, statusCheckRollup: pr.statusCheckRollup || [] };
    })
  );
}

/**
 * Fake `gh` for the incident repository. `view` decides what `gh pr view`
 * reports (refreshed mergeability, or state after a recreate request).
 */
function fakeGh({ prs, base = baseFiles, view = () => ({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }), merge = args => ({ code: 1, stdout: '', stderr: CONFLICT.replace('{n}', args[2]) }) }) {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, ...args]);
    const [group, action] = args;
    if (group === 'pr' && action === 'list') return { code: 0, stdout: JSON.stringify(prs), stderr: '' };
    if (group === 'pr' && action === 'view') {
      const pr = prs.find(item => String(item.number) === args[2]);
      return { code: 0, stdout: JSON.stringify({ state: 'OPEN', headRefOid: pr.headRefOid, ...view(Number(args[2]), calls) }), stderr: '' };
    }
    if (group === 'pr' && action === 'merge') return merge(args);
    if (group === 'pr' && action === 'diff') return { code: 0, stdout: diffs[Number(args[2])] || '', stderr: '' };
    if (group === 'api' && args[1] === `repos/${repository.fullName}`) return { code: 0, stdout: JSON.stringify({ allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true }), stderr: '' };
    if (group === 'api' && args[1]?.startsWith(`repos/${repository.fullName}/contents/`)) {
      const path = decodeURIComponent(args[1].slice(`repos/${repository.fullName}/contents/`.length).split('?')[0]);
      return path in base ? { code: 0, stdout: base[path], stderr: '' } : { code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)\n' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const named = (action, extra = () => true) => calls.filter(call => call[1] === 'pr' && call[2] === action && extra(call));
  return { run, calls, named };
}

const instant = { sleep: async () => {}, warn: () => {} };

test('versions compare numerically, pre-releases rank below their release', () => {
  assert.ok(compareVersions('2.5.4', '2.2.6') > 0);
  assert.ok(compareVersions('2.10.0', '2.9.9') > 0);
  assert.equal(compareVersions('26.3', '26.3.0'), 0);
  assert.ok(compareVersions('5.0.0rc1', '5.0.0') < 0, 'rc is a pre-release, not a post release');
  assert.ok(compareVersions('1.0.0-rc.1', '1.0.0') < 0);
  assert.ok(compareVersions('1.0.0.post1', '1.0.0') > 0);
  assert.ok(compareVersions('v4.2.2', '4.2.1') > 0);
});

test('dependency lines of the common ecosystems are parsed', () => {
  assert.deepEqual(parseDependencyLine('numpy==2.2.6'), { name: 'numpy', requirement: { lower: '2.2.6', upper: null } });
  assert.deepEqual(parseDependencyLine('    "mypy>=1.13.0,<3.0",'), { name: 'mypy', requirement: { lower: '1.13.0', upper: '3.0' } });
  assert.equal(parseDependencyLine('    "react": "^18.3.1",').name, 'react');
  assert.equal(parseDependencyLine('serde = { version = "1.0.210", features = ["derive"] }').requirement.lower, '1.0.210');
  assert.equal(parseDependencyLine('      - uses: actions/checkout@v4').name, 'actions/checkout');
  assert.equal(parseDependencyLine('FROM node:20.11-alpine').name, 'node');
  assert.equal(parseDependencyLine('    "version": "1.2.3",'), null, 'package metadata is not a dependency');
  assert.equal(parseDependencyLine('# numpy==1.0'), null, 'comments are ignored');
  assert.deepEqual(parseRequirement('>=1.13.0,<3.0'), { lower: '1.13.0', upper: '3.0' });
  assert.ok(requirementSatisfies(parseRequirement('>=2.4.0'), parseRequirement('>=1.13.0,<3.0')), 'a raised floor with the upper bound dropped supersedes');
  assert.ok(!requirementSatisfies(parseRequirement('>=1.13.0,<2.0'), parseRequirement('>=1.13.0,<3.0')), 'a lower upper bound does not');
});

test('requirement lines that never match are rejected in linear time (CodeQL js/redos)', () => {
  // The pip-style pattern used to backtrack exponentially here: 20 repetitions took ~360ms, each extra one doubled it.
  const started = Date.now();
  assert.equal(parseDependencyLine(`0>!,${'<=!,'.repeat(60)}"x"`), null);
  assert.equal(parseDependencyLine(`0>!,${'<=!,'.repeat(60)}#`), null);
  assert.ok(Date.now() - started < 500, `took ${Date.now() - started}ms`);
  assert.deepEqual(parseDependencyLine('pkg[extra] >= 1.0 , <2 ; python_version<"3.9"'), { name: 'pkg', requirement: { lower: '1.0', upper: '2' } });
});

test('all five pull requests of the incident are superseded by main', () => {
  const dependencies = collectDependencies(baseFiles['scripts/unimedvl-requirements.txt']);
  assert.ok(dependencies.has('numpy'));
  for (const number of incidentNumbers) {
    const verdict = evaluateSupersession(parseUnifiedDiff(diffs[number]), baseFiles);
    assert.equal(verdict.superseded, true, `#${number}: ${verdict.reason}`);
  }
  assert.match(evaluateSupersession(parseUnifiedDiff(diffs[17]), baseFiles).reason, /numpy 2\.5\.4 ≥ 2\.2\.6/);
});

test('a pull request that main has not caught up with is not superseded', () => {
  const behind = { ...baseFiles, 'scripts/unimedvl-requirements.txt': baseFiles['scripts/unimedvl-requirements.txt'].replace(/^numpy==.*$/m, 'numpy==1.26.4') };
  const verdict = evaluateSupersession(parseUnifiedDiff(diffs[17]), behind);
  assert.equal(verdict.superseded, false);
  assert.match(verdict.reason, /numpy/);
  assert.equal(evaluateSupersession(parseUnifiedDiff(diffs[17]), {}).superseded, false, 'an unreadable base file never closes anything');
});

test('checkSupersededByBase reads the diff and the base files through gh and never throws', async () => {
  const prs = await incidentPullRequests();
  const gh = fakeGh({ prs });
  const verdict = await checkSupersededByBase({ repository, pullRequest: prs[4], run: gh.run });
  assert.equal(verdict.superseded, true);
  assert.ok(gh.calls.some(call => call.join(' ') === `gh pr diff 17 --repo ${repository.fullName}`));
  assert.ok(gh.calls.some(call => call[2] === `repos/${repository.fullName}/contents/scripts/unimedvl-requirements.txt?ref=main`));
  const broken = await checkSupersededByBase({
    repository,
    pullRequest: prs[4],
    run: async () => {
      throw new Error('network down');
    },
  });
  assert.equal(broken.superseded, false);
});

test('"the merge commit cannot be cleanly created" is a conflict, not a branch rule', () => {
  assert.ok(isMergeConflictError(CONFLICT.replace('{n}', '13')));
  assert.ok(isMergeConflictError('Pull request has merge conflicts'));
  assert.ok(!isMergeConflictError('GraphQL: Required status check "CSharp" is failing'));
});

test('replaying medical-neural-network-ml#25: UNKNOWN is refreshed and every superseded pull request is closed', async () => {
  const prs = await incidentPullRequests('UNKNOWN');
  const gh = fakeGh({ prs });
  const logs = [];
  const result = await mergeDependabotPullRequests({ repository, run: gh.run, log: message => logs.push(message), verbose: true, ...instant });

  assert.deepEqual(
    result.pullRequests.map(entry => [entry.number, entry.outcome]),
    incidentNumbers.map(number => [number, 'closed'])
  );
  assert.equal(gh.named('merge').length, 0, 'the refreshed CONFLICTING state means no merge is attempted, so no --admin retry either');
  assert.equal(gh.named('view').length, incidentNumbers.length, 'mergeability was re-read once per pull request');
  const closes = gh.named('close');
  assert.deepEqual(
    closes.map(call => call[3]),
    incidentNumbers.map(String)
  );
  const closeComment = closes[4][closes[4].indexOf('--comment') + 1];
  assert.match(closeComment, /Closing as superseded: `main` already has every update/);
  assert.match(closeComment, /numpy 2\.5\.4 ≥ 2\.2\.6/);
  assert.equal(gh.named('comment').length, 0, 'nothing to recreate');
  assert.match(logs.join('\n'), /\[VERBOSE\] #17 supersession check: superseded/);
  assert.match(logs.join('\n'), /Merged 0 of 5 .*closed 5 as superseded/);

  const section = buildDependabotPullRequestsSection(result);
  assert.ok(section.startsWith('### Open Dependabot pull requests handled before this issue was created'), section.slice(0, 120));
  assert.doesNotMatch(section, /pull requests merged before/, 'nothing was merged, so the heading must not say so');
  assert.match(section, /closed as superseded:[\s\S]*\[#14\][^\n]*mypy 2\.4\.0 ≥ 1\.13\.0, <3\.0/);
  assert.doesNotMatch(section, /Dependabot closes a pull request by itself/);
  assert.match(summarizeDependabotPullRequests(result), /0 of 5 open pull request\(s\) merged without waiting for CI\/CD, 5 closed as superseded/);
});

test('a conflict that only shows up when merging is handled the same way, without an --admin retry', async () => {
  const prs = await incidentPullRequests('MERGEABLE');
  const gh = fakeGh({ prs });
  const result = await mergeDependabotPullRequests({ repository, run: gh.run, ...instant });
  assert.ok(result.pullRequests.every(entry => entry.outcome === 'closed'));
  assert.equal(gh.named('merge').length, 5);
  assert.equal(gh.named('merge', call => call.includes('--admin')).length, 0);
});

test('a conflicting pull request that is not superseded is recreated by Dependabot and then merged', async () => {
  const prs = (await incidentPullRequests('CONFLICTING')).filter(pr => pr.number === 17);
  const behind = { ...baseFiles, 'scripts/unimedvl-requirements.txt': baseFiles['scripts/unimedvl-requirements.txt'].replace(/^numpy==.*$/m, 'numpy==1.26.4') };
  const gh = fakeGh({
    prs,
    base: behind,
    view: (number, calls) => (calls.some(call => call[2] === 'comment') ? { mergeable: 'MERGEABLE', headRefOid: 'recreated17' } : { mergeable: 'CONFLICTING' }),
    merge: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  let clock = 0;
  const result = await mergeDependabotPullRequests({
    repository,
    run: gh.run,
    ...instant,
    sleep: async ms => {
      clock += ms;
    },
    now: () => clock,
  });
  const [entry] = result.pullRequests;
  assert.equal(entry.outcome, 'merged');
  assert.equal(entry.recreated, true);
  assert.deepEqual(gh.named('comment')[0].slice(3), ['17', '--repo', repository.fullName, '--body', '@dependabot recreate']);
  assert.deepEqual(gh.named('merge')[0].slice(-2), ['--match-head-commit', 'recreated17'], 'the recreated head is merged, not the stale one');
  assert.equal(gh.named('close').length, 0);
  assert.match(buildDependabotPullRequestsSection(result), /\[#17\][^\n]*recreated by Dependabot on top of the base branch first/);
});

test('the wait for Dependabot is bounded; unfinished recreations stay listed in the issue', async () => {
  const prs = (await incidentPullRequests('CONFLICTING')).filter(pr => pr.number === 17);
  const behind = { 'scripts/unimedvl-requirements.txt': baseFiles['scripts/unimedvl-requirements.txt'].replace(/^numpy==.*$/m, 'numpy==1.26.4') };
  const gh = fakeGh({ prs, base: behind });
  let clock = 0;
  const result = await mergeDependabotPullRequests({
    repository,
    run: gh.run,
    ...instant,
    sleep: async ms => {
      clock += ms;
    },
    now: () => clock,
    recreateTimeoutMs: 60000,
    recreatePollMs: 15000,
  });
  assert.equal(result.pullRequests[0].outcome, 'recreate-requested');
  assert.equal(clock, 60000);
  assert.equal(gh.named('view').length, 4, 'polled every 15s for 60s');
  const section = buildDependabotPullRequestsSection(result);
  assert.match(section, /\[#17\][^\n]*Dependabot was asked to recreate it \(`@dependabot recreate`\) but had not finished/);
  assert.match(section, /Do not rely on Dependabot to close them/);
});

test('Dependabot closing a pull request after the recreate request is reported as superseded', async () => {
  const prs = (await incidentPullRequests('CONFLICTING')).filter(pr => pr.number === 17);
  const gh = fakeGh({ prs, base: {}, view: (number, calls) => (calls.some(call => call[2] === 'comment') ? { state: 'CLOSED' } : {}) });
  const result = await mergeDependabotPullRequests({ repository, run: gh.run, ...instant, now: () => 0 });
  assert.equal(result.pullRequests[0].outcome, 'closed-by-dependabot');
  assert.match(buildDependabotPullRequestsSection(result), /\[#17\][^\n]*closed by Dependabot after it was asked to recreate it/);
});

test('--dry-run plans the closes and recreations without touching any pull request', async () => {
  const prs = await incidentPullRequests('CONFLICTING');
  const gh = fakeGh({ prs });
  const result = await mergeDependabotPullRequests({ repository, run: gh.run, dryRun: true, ...instant });
  assert.ok(result.pullRequests.every(entry => entry.outcome === 'planned-close'));
  for (const action of ['merge', 'close', 'comment']) assert.equal(gh.named(action).length, 0, action);
  assert.match(buildDependabotPullRequestsSection(result), /\(dry run\)[\s\S]*would be closed as superseded/);
  assert.match(summarizeDependabotPullRequests(result), /0 of 5 open pull request\(s\) would be merged, 5 would be closed as superseded/);
});
