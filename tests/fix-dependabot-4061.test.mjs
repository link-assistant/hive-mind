/**
 * Regression coverage for issue #4061: `/fix --update-all-dependencies` left
 * links-notation#396 and #407 open and listed them in links-notation#408.
 *
 * - #407 bumped `"version"` in csharp/global.json (Dependabot's `dotnet-sdk`
 *   ecosystem). main already had 11.0.100, but global.json was not parsed and
 *   only conflicting pull requests were compared with main, so the mergeable
 *   but BEHIND #407 was merged instead — and a strict, non-bypassable ruleset
 *   rejected it ("Repository rule violations found", `--admin` cannot help).
 * - #396 conflicted and every update it carried was already on main.
 *
 * The fixtures are the real pull requests, diffs, ruleset and base-branch
 * files saved in docs/case-studies/issue-4061/raw.
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildDependabotPullRequestsSection, compactError, describeBranchRules, mergeDependabotPullRequests, summarizeDependabotPullRequests } from '../src/fix.dependabot-merge.lib.mjs';
import { describeSupersession, evaluateSupersession, parseDependencyLine, parseUnifiedDiff } from '../src/fix.dependabot-superseded.lib.mjs';
import { partitionFixArgs } from '../src/fix.args.lib.mjs';
import { resolveDependabotWaitTimeoutMs } from '../src/telegram-task-command.lib.mjs';
import { buildUpdateDependenciesIssueBody } from '../src/fix.update-dependencies.lib.mjs';

const raw = new URL('../docs/case-studies/issue-4061/raw/', import.meta.url);
const readRaw = name => readFile(new URL(name, raw), 'utf8');
const repository = { owner: 'link-foundation', repo: 'links-notation', fullName: 'link-foundation/links-notation', url: 'https://github.com/link-foundation/links-notation' };

const diffs = { 396: await readRaw('pr-396.diff'), 407: await readRaw('pr-407.diff') };
const files = Object.fromEntries(Object.entries(diffs).map(([number, diff]) => [number, parseUnifiedDiff(diff)]));
const baseAtIssueCreation = {};
for (const file of [...files[396], ...files[407]]) {
  baseAtIssueCreation[file.path] = await readRaw(`base-at-issue-creation/${file.path}`);
}
const rulesMain = await readRaw('rules-main.json');
const ruleset = await readRaw('ruleset-24860631.json');
// A stand-in for the multi-line `gh pr merge` error; the issue body only kept its first line.
const RULE_VIOLATION = 'GraphQL: Repository rule violations found\n\nThe base branch requires all commits to be up to date before merging.\n\n';
const NO_CHECKS_YET = 'GraphQL: Repository rule violations found\n\n10 of 10 required status checks are expected.\n\n';
const OLD_HEAD = 'a'.repeat(40);
const NEW_HEAD = 'b'.repeat(40);

/** #396 and #407 as `gh pr list` reported them when links-notation#408 was created. */
async function incidentPullRequests() {
  const states = { 396: { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }, 407: { mergeable: 'MERGEABLE', mergeStateStatus: 'BEHIND' } };
  return Promise.all(
    [396, 407].map(async number => {
      const pr = JSON.parse(await readRaw(`pr-${number}.json`));
      return { number, title: pr.title, url: `${repository.url}/pull/${number}`, author: pr.author, baseRefName: 'main', headRefName: pr.headRefName, headRefOid: OLD_HEAD, isDraft: false, statusCheckRollup: [], ...states[number] };
    })
  );
}

const success = name => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion: 'SUCCESS' });
const running = name => ({ __typename: 'CheckRun', name, status: 'IN_PROGRESS', conclusion: null });

/** Fake `gh` for links-notation; `view` answers `gh pr view`, `merge` answers `gh pr merge`. */
function fakeGh({ prs, base = baseAtIssueCreation, view = () => ({}), merge = () => ({ code: 0, stdout: '', stderr: '' }) }) {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, ...args]);
    const [group, action] = args;
    if (group === 'pr' && action === 'list') return { code: 0, stdout: JSON.stringify(prs), stderr: '' };
    if (group === 'pr' && action === 'view') {
      const pr = prs.find(item => String(item.number) === args[2]);
      return { code: 0, stdout: JSON.stringify({ state: 'OPEN', mergeable: pr.mergeable, mergeStateStatus: pr.mergeStateStatus, headRefOid: pr.headRefOid, statusCheckRollup: [], ...view(Number(args[2]), calls) }), stderr: '' };
    }
    if (group === 'pr' && action === 'merge') return merge(args, calls);
    if (group === 'pr' && action === 'diff') return { code: 0, stdout: diffs[Number(args[2])] || '', stderr: '' };
    if (group === 'api' && args[1] === `repos/${repository.fullName}`) return { code: 0, stdout: JSON.stringify({ allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true }), stderr: '' };
    if (group === 'api' && args[1] === `repos/${repository.fullName}/rules/branches/main`) return { code: 0, stdout: rulesMain, stderr: '' };
    if (group === 'api' && args[1] === `repos/${repository.fullName}/rulesets/24860631`) return { code: 0, stdout: ruleset, stderr: '' };
    if (group === 'api' && args[1]?.startsWith(`repos/${repository.fullName}/contents/`)) {
      const path = decodeURIComponent(args[1].slice(`repos/${repository.fullName}/contents/`.length).split('?')[0]);
      return path in base ? { code: 0, stdout: base[path], stderr: '' } : { code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)\n' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const named = action => calls.filter(call => call[1] === 'pr' && call[2] === action);
  return { run, calls, named };
}

/** A clock that only moves when the code under test sleeps. */
function fakeClock() {
  let time = 0;
  return { now: () => time, sleep: async ms => void (time += ms), elapsed: () => time };
}

/** main with #407's update reverted, so #407 is a real update that still has to be merged. */
const baseWithoutDotnetUpdate = { ...baseAtIssueCreation, 'csharp/global.json': baseAtIssueCreation['csharp/global.json'].replace('"11.0.100"', '"10.0.402"') };

test('the .NET SDK pin in global.json is a dependency (Dependabot dotnet-sdk)', () => {
  assert.deepEqual(parseDependencyLine('    "version": "11.0.100",', { path: 'csharp/global.json' }), { name: 'dotnet-sdk', requirement: { lower: '11.0.100', upper: null } });
  assert.equal(parseDependencyLine('    "version": "11.0.100",', { path: 'js/package.json' }), null, 'package metadata elsewhere is still not a dependency');
  assert.equal(parseDependencyLine('channel = "1.83.0"', { path: 'rust-toolchain.toml' }).name, 'rust-toolchain');
  assert.equal(parseDependencyLine('    image: postgres:16.4', { path: 'docker-compose.yml' }).name, 'postgres');
});

test('#407 and #396 were both superseded by main when links-notation#408 was created', () => {
  const dotnet = evaluateSupersession(files[407], baseAtIssueCreation);
  assert.equal(dotnet.superseded, true, dotnet.reason);
  assert.match(dotnet.reason, /dotnet-sdk 11\.0\.100 ≥ 11\.0\.100/);
  const actions = evaluateSupersession(files[396], baseAtIssueCreation);
  assert.equal(actions.superseded, true, actions.reason);
  const parts = actions.reason.split('; ');
  assert.equal(new Set(parts).size, parts.length, `a dependency pinned in several workflows is named once: ${actions.reason}`);
  assert.match(actions.reason, /trufflesecurity\/trufflehog 3\.99\.9 ≥ 3\.99\.8/);
  assert.equal(evaluateSupersession(files[407], baseWithoutDotnetUpdate).superseded, false);
  assert.equal(describeSupersession([]), '');
});

test('superseded pull requests are closed whatever their mergeability, without merging (#396, #407)', async () => {
  const gh = fakeGh({ prs: await incidentPullRequests() });
  const result = await mergeDependabotPullRequests({ repository, run: gh.run, ...fakeClock(), warn: () => {} });
  assert.deepEqual(
    result.pullRequests.map(entry => [entry.number, entry.outcome]),
    [
      [396, 'closed'],
      [407, 'closed'],
    ]
  );
  assert.equal(gh.named('merge').length, 0, 'nothing is merged into a branch that already has the updates');
  assert.equal(gh.named('comment').length, 0, 'Dependabot is not asked to rebase or recreate a superseded pull request');
  const comments = Object.fromEntries(gh.named('close').map(call => [call[3], call[call.indexOf('--comment') + 1]]));
  assert.match(comments[407], /dotnet-sdk 11\.0\.100/);
  assert.doesNotMatch(comments[407], /can no longer be merged cleanly/, '#407 never conflicted');
  assert.match(comments[396], /can no longer be merged cleanly/);
  assert.match(buildDependabotPullRequestsSection(result), /closed as superseded/);
});

test('a BEHIND pull request a strict ruleset rejects is rebased by Dependabot, checked and merged (#407)', async () => {
  const prs = (await incidentPullRequests()).filter(pr => pr.number === 407);
  let rebased = false;
  let polls = 0;
  const gh = fakeGh({
    prs,
    base: baseWithoutDotnetUpdate,
    view: (number, calls) => {
      rebased ||= calls.some(call => call[2] === 'comment' && call.includes('@dependabot rebase'));
      if (!rebased) return {};
      polls += 1;
      return { mergeStateStatus: polls < 3 ? 'BLOCKED' : 'CLEAN', headRefOid: NEW_HEAD, statusCheckRollup: polls < 3 ? [success('JavaScript'), running('CSharp')] : [success('JavaScript'), success('CSharp')] };
    },
    merge: args => (rebased && polls >= 3 ? { code: 0, stdout: '', stderr: '' } : { code: 1, stdout: '', stderr: rebased ? NO_CHECKS_YET : RULE_VIOLATION.replace('{n}', args[2]) }),
  });
  const clock = fakeClock();
  const logs = [];
  const result = await mergeDependabotPullRequests({ repository, run: gh.run, ...clock, warn: () => {}, log: line => logs.push(line), verbose: true });
  const [entry] = result.pullRequests;
  assert.equal(entry.outcome, 'merged', logs.join('\n'));
  assert.equal(entry.rebased, true);
  assert.deepEqual(
    gh.named('comment').map(call => call.at(-1)),
    ['@dependabot rebase']
  );
  assert.match(entry.rules, /“Main requires same-commit ten-language CI” requires the branch to be up to date/);
  assert.match(entry.rules, /cannot be bypassed by the current user \(no bypass actors\), so `--admin` does not help/);
  assert.ok(logs.some(line => line.includes('[VERBOSE] #407 supersession check: not superseded')));
  assert.ok(clock.elapsed() <= 30 * 60 * 1000, 'the wait is bounded');
});

test('a rebased pull request whose checks are not reported yet keeps waiting for them', async () => {
  const prs = (await incidentPullRequests()).filter(pr => pr.number === 407);
  let rebased = false;
  let polls = 0;
  const gh = fakeGh({
    prs,
    base: baseWithoutDotnetUpdate,
    view: (number, calls) => {
      rebased ||= calls.some(call => call[2] === 'comment');
      if (!rebased) return {};
      polls += 1;
      // GitHub lists no check for a while right after Dependabot pushed the rebased head.
      return { mergeStateStatus: polls < 4 ? 'BLOCKED' : 'CLEAN', headRefOid: NEW_HEAD, statusCheckRollup: polls < 4 ? [] : [success('CSharp')] };
    },
    merge: () => (rebased && polls >= 4 ? { code: 0, stdout: '', stderr: '' } : { code: 1, stdout: '', stderr: rebased ? NO_CHECKS_YET : RULE_VIOLATION }),
  });
  const result = await mergeDependabotPullRequests({ repository, run: gh.run, ...fakeClock(), warn: () => {} });
  assert.equal(result.pullRequests[0].outcome, 'merged');
  const mergesAfterRebase = gh.calls.filter((call, index) => call[2] === 'merge' && gh.calls.slice(0, index).some(earlier => earlier[2] === 'comment'));
  assert.ok(mergesAfterRebase.length <= 4, `a merge is only retried when the checks change (${mergesAfterRebase.length} attempts)`);
});

test('a pull request Dependabot never rebases stays open with the rule that blocked it, after a bounded wait', async () => {
  const prs = (await incidentPullRequests()).filter(pr => pr.number === 407);
  const gh = fakeGh({ prs, base: baseWithoutDotnetUpdate, merge: () => ({ code: 1, stdout: '', stderr: RULE_VIOLATION }) });
  const clock = fakeClock();
  const result = await mergeDependabotPullRequests({ repository, run: gh.run, ...clock, warn: () => {}, waitTimeoutMs: 10 * 60 * 1000 });
  const [entry] = result.pullRequests;
  assert.equal(entry.outcome, 'rebase-requested');
  assert.ok(clock.elapsed() <= 10 * 60 * 1000);
  assert.match(entry.error, /Repository rule violations found — The base branch requires/, 'the whole gh error is kept, not only its first line');
  const section = buildDependabotPullRequestsSection(result);
  assert.match(section, /#407/);
  assert.match(section, /cannot be bypassed/);
  assert.match(summarizeDependabotPullRequests(result), /open/);
  const noWait = await mergeDependabotPullRequests({ repository, run: fakeGh({ prs, base: baseWithoutDotnetUpdate, merge: () => ({ code: 1, stdout: '', stderr: RULE_VIOLATION }) }).run, ...fakeClock(), warn: () => {}, waitTimeoutMs: 0 });
  assert.equal(noWait.pullRequests[0].outcome, 'rebase-requested', '--dependabot-wait-timeout 0 asks for the rebase but does not wait');
});

test('the links-notation ruleset is described from the rules API answer', () => {
  const described = describeBranchRules(JSON.parse(rulesMain), [JSON.parse(ruleset)]);
  assert.match(described, /^ruleset “Main requires same-commit ten-language CI” requires the branch to be up to date and the status check\(s\) JavaScript, Rust, Python, Java, Go, CSharp, PHP, Cpp, Swift, Kotlin to pass/);
  assert.match(described, /so `--admin` does not help$/);
  assert.match(describeBranchRules(JSON.parse(rulesMain), []), /^a repository ruleset requires/, 'without read access to the ruleset the rules still explain the block');
  assert.equal(describeBranchRules([{ type: 'deletion' }]), null);
  assert.equal(compactError('X failed\n\n  detail one\ndetail two\n'), 'X failed — detail one — detail two');
});

test('--dependabot-wait-timeout is parsed by /fix and /task', () => {
  assert.equal(partitionFixArgs(['https://github.com/o/r', '--update-all-dependencies']).dependabotWaitTimeoutMinutes, 30);
  assert.equal(partitionFixArgs(['https://github.com/o/r', '--update-all-dependencies', '--dependabot-wait-timeout', '5']).dependabotWaitTimeoutMinutes, 5);
  assert.equal(partitionFixArgs(['https://github.com/o/r', '--dependabot-wait-timeout=0']).dependabotWaitTimeoutMinutes, 0);
  const bad = partitionFixArgs(['https://github.com/o/r', '--dependabot-wait-timeout', 'soon']);
  assert.match(bad.errors.join('\n'), /--dependabot-wait-timeout expects a number of minutes/);
  assert.equal(resolveDependabotWaitTimeoutMs([]), 30 * 60 * 1000);
  assert.equal(resolveDependabotWaitTimeoutMs(['--dependabot-wait-timeout', '2', '--dependabot-wait-timeout=0.5']), 30 * 1000);
  assert.equal(resolveDependabotWaitTimeoutMs(['--dependabot-wait-timeout', 'x']), 30 * 60 * 1000);
});

test('the generated issue names the hive-mind version that collected it', () => {
  const body = buildUpdateDependenciesIssueBody({ repository, defaultBranch: 'main', commit: null, languages: {}, files: [], toolVersion: '2.40.0' });
  assert.match(body, /- \*\*Collected by:\*\* hive-mind `2\.40\.0`/);
  assert.doesNotMatch(buildUpdateDependenciesIssueBody({ repository, defaultBranch: 'main', commit: null, languages: {}, files: [] }), /Collected by/);
});
