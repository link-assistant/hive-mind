/**
 * Regression coverage for issue #3413: `/fix --update-all-dependencies` (and
 * `/task --update-all-dependencies`) merges every open Dependabot pull request
 * before creating the issue, without waiting for CI/CD, and the issue asks the
 * solver to fix every error those merges introduced.
 *
 * The fixtures mirror link-foundation/links-notation#343–#347, the pull
 * requests left open when links-notation#348 was generated.
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildDependabotPullRequestsSection, buildMergeArgs, chooseMergeMethod, isDependabotAuthor, listOpenDependabotPullRequests, mergeDependabotPullRequests, shouldRetryWithAdmin, summarizeChecks, summarizeDependabotPullRequests } from '../src/fix.dependabot-merge.lib.mjs';
import { partitionFixArgs, FIX_OWNED_BOOLEAN_FLAGS, buildSolveArgs } from '../src/fix.args.lib.mjs';
import { buildUpdateDependenciesIssueBody } from '../src/fix.update-dependencies.lib.mjs';
import { createUpdateDependenciesIssue, prepareUpdateDependenciesIssue } from '../src/fix.update-dependencies-issue.lib.mjs';
import { FIX_OWN_OPTIONS } from '../src/telegram-fix-command.lib.mjs';
import { registerTaskCommands, resolveMergeDependabotPrs } from '../src/telegram-task-command.lib.mjs';

const repository = { owner: 'link-foundation', repo: 'links-notation', fullName: 'link-foundation/links-notation', url: 'https://github.com/link-foundation/links-notation' };
const dependabotAuthor = { is_bot: true, login: 'app/dependabot' };

const check = (name, conclusion, extra = {}) => ({ __typename: 'CheckRun', name, workflowName: extra.workflowName || 'CI', status: 'COMPLETED', conclusion, detailsUrl: `https://github.com/x/actions/runs/1/job/${name}`, completedAt: extra.completedAt || '2026-10-14T08:10:00Z', ...extra });

function dependabotPr(number, title, overrides = {}) {
  return {
    number,
    title,
    url: `${repository.url}/pull/${number}`,
    author: dependabotAuthor,
    baseRefName: 'main',
    headRefName: `dependabot/nuget/csharp/pkg-${number}`,
    headRefOid: `sha${number}`,
    isDraft: false,
    mergeable: 'MERGEABLE',
    statusCheckRollup: [check('CSharp', 'SUCCESS'), check('auto-merge', 'FAILURE', { workflowName: 'Dependabot auto-merge' }), check('latest-stable', 'FAILURE', { workflowName: 'dependency freshness' })],
    ...overrides,
  };
}

const incidentPrs = [dependabotPr(346, 'Bump Microsoft.ML.Tokenizers from 2.0.0 to 2.1.0'), dependabotPr(343, 'Bump Microsoft.Bcl.Memory from 10.0.12 to 10.0.13'), dependabotPr(347, 'Bump Microsoft.ML.Tokenizers.Data.O200kBase'), dependabotPr(344, 'Bump Microsoft.SourceLink.GitHub from 10.0.401 to 10.0.402')];

/** Fake `gh`: answers the listing/settings calls and records every merge. */
function fakeGh({ prs = incidentPrs, settings = { allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true }, merge = () => ({ code: 0, stdout: '', stderr: '' }), listing = null } = {}) {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === 'pr' && args[1] === 'list') return listing || { code: 0, stdout: JSON.stringify(prs), stderr: '' };
    if (args[0] === 'pr' && args[1] === 'merge') return merge(args);
    if (args[0] === 'api' && args[1] === `repos/${repository.fullName}` && args.includes('{allow_merge_commit, allow_squash_merge, allow_rebase_merge}')) return { code: 0, stdout: JSON.stringify(settings), stderr: '' };
    if (args[0] === 'api' && args[1]?.endsWith('/languages')) return { code: 0, stdout: '{"C#": 100}', stderr: '' };
    if (args[0] === 'api' && args[1] === `repos/${repository.fullName}`) return { code: 0, stdout: 'main', stderr: '' };
    if (args[0] === 'api' && args[1]?.includes('/git/trees/')) return { code: 0, stdout: '{"files":["csharp/Link.Foundation.Links.Notation.csproj"],"truncated":false}', stderr: '' };
    if (args[0] === 'issue' && args[1] === 'create') {
      calls.at(-1).body = await readFile(args[args.indexOf('--body-file') + 1], 'utf8');
      return { code: 0, stdout: `${repository.url}/issues/348\n`, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls, merges: () => calls.filter(call => call[1] === 'pr' && call[2] === 'merge') };
}

test('only Dependabot authors are recognized', () => {
  assert.ok(isDependabotAuthor(dependabotAuthor));
  assert.ok(isDependabotAuthor({ login: 'dependabot[bot]' }));
  assert.ok(isDependabotAuthor('dependabot'));
  assert.ok(!isDependabotAuthor({ login: 'konard' }));
  assert.ok(!isDependabotAuthor({ login: 'app/renovate' }));
});

test('summarizeChecks reports failing and pending checks, counting only the latest attempt', () => {
  const summary = summarizeChecks([check('build', 'FAILURE', { completedAt: '2026-10-14T08:00:00Z' }), check('build', 'SUCCESS', { completedAt: '2026-10-14T09:00:00Z' }), check('lint', 'CANCELLED'), check('docs', 'SKIPPED'), check('neutral', 'NEUTRAL'), { __typename: 'CheckRun', name: 'tests', workflowName: 'CI', status: 'IN_PROGRESS', conclusion: '' }, { __typename: 'StatusContext', context: 'ci/legacy', state: 'PENDING' }, { __typename: 'StatusContext', context: 'ci/error', state: 'ERROR', targetUrl: 'https://ci/1' }]);
  assert.equal(summary.total, 7);
  assert.deepEqual(
    summary.failing.map(item => item.name),
    ['CI / lint', 'ci/error']
  );
  assert.deepEqual(
    summary.pending.map(item => item.name),
    ['CI / tests', 'ci/legacy']
  );
  assert.deepEqual(summarizeChecks(null), { total: 0, failing: [], pending: [] });
});

test('chooseMergeMethod follows the repository settings', () => {
  assert.equal(chooseMergeMethod({ allow_merge_commit: true, allow_squash_merge: true }), 'merge');
  assert.equal(chooseMergeMethod({ allow_merge_commit: false, allow_squash_merge: true }), 'squash');
  assert.equal(chooseMergeMethod({ allow_merge_commit: false, allow_squash_merge: false, allow_rebase_merge: true }), 'rebase');
  assert.equal(chooseMergeMethod({}), 'merge', 'unknown settings default to a merge commit');
});

test('merge args pin the head commit and add --admin only on retry', () => {
  const pullRequest = { number: 343, headRefOid: 'abc' };
  assert.deepEqual(buildMergeArgs({ repository, pullRequest, method: 'squash' }), ['pr', 'merge', '343', '--repo', repository.fullName, '--squash', '--match-head-commit', 'abc']);
  assert.deepEqual(buildMergeArgs({ repository, pullRequest, admin: true }).slice(-2), ['abc', '--admin']);
  assert.ok(shouldRetryWithAdmin('GraphQL: Required status check "CSharp" is failing'));
  assert.ok(shouldRetryWithAdmin('X Pull request is not mergeable: the base branch policy prohibits the merge.'));
  assert.ok(!shouldRetryWithAdmin('Pull request has merge conflicts'));
  assert.ok(!shouldRetryWithAdmin('GraphQL: Could not resolve to a PullRequest'));
});

test('listing asks gh for open Dependabot pull requests and sorts them oldest first', async () => {
  const gh = fakeGh({ prs: [...incidentPrs, { ...dependabotPr(350, 'Not dependabot'), author: { login: 'someone' } }] });
  const list = await listOpenDependabotPullRequests(repository, gh.run);
  assert.deepEqual(
    list.map(pullRequest => pullRequest.number),
    [343, 344, 346, 347]
  );
  const [call] = gh.calls;
  assert.deepEqual(call.slice(0, 8), ['gh', 'pr', 'list', '--repo', repository.fullName, '--author', 'app/dependabot', '--state']);
  assert.ok(call.includes('statusCheckRollup') || call.some(arg => arg.includes('statusCheckRollup')));
  assert.deepEqual(
    list[0].checks.failing.map(item => item.name),
    ['Dependabot auto-merge / auto-merge', 'dependency freshness / latest-stable']
  );
});

test('every open Dependabot pull request is merged without waiting for CI/CD (links-notation#348)', async () => {
  const gh = fakeGh();
  const logs = [];
  const result = await mergeDependabotPullRequests({ repository, run: gh.run, warn: () => {}, log: message => logs.push(message) });
  assert.equal(result.method, 'merge');
  assert.deepEqual(
    result.pullRequests.map(entry => [entry.number, entry.outcome]),
    [
      [343, 'merged'],
      [344, 'merged'],
      [346, 'merged'],
      [347, 'merged'],
    ]
  );
  assert.deepEqual(
    gh.merges().map(call => call[3]),
    ['343', '344', '346', '347'],
    'merged oldest first, failing checks notwithstanding'
  );
  assert.ok(!gh.calls.some(call => call.includes('--auto')), 'no GitHub auto-merge: it would wait for CI/CD');
  assert.ok(!gh.calls.some(call => call[1] === 'run' || call.some(arg => String(arg).includes('actions/runs'))), 'CI/CD is not polled');
  assert.match(logs.join('\n'), /Merged 4 of 4/);
  assert.match(summarizeDependabotPullRequests(result), /4 of 4 open pull request\(s\) merged without waiting for CI\/CD/);
});

test('a merge blocked by branch rules is retried with --admin; conflicts and drafts are left open', async () => {
  const prs = [dependabotPr(1, 'Blocked by required checks'), dependabotPr(2, 'Ruleset without bypass'), dependabotPr(3, 'Conflicting', { mergeable: 'CONFLICTING' }), dependabotPr(4, 'Draft', { isDraft: true })];
  const gh = fakeGh({
    prs,
    merge: args => {
      const admin = args.includes('--admin');
      if (args[2] === '1') return admin ? { code: 0, stdout: '', stderr: '' } : { code: 1, stdout: '', stderr: 'X Pull request is not mergeable: the base branch policy prohibits the merge.\n' };
      return { code: 1, stdout: '', stderr: 'GraphQL: Repository rule violations found\n\nRequired status check "CSharp" is expected.\n' };
    },
  });
  const result = await mergeDependabotPullRequests({ repository, run: gh.run, warn: () => {} });
  const byNumber = Object.fromEntries(result.pullRequests.map(entry => [entry.number, entry]));
  assert.equal(byNumber[1].outcome, 'merged');
  assert.equal(byNumber[1].admin, true);
  assert.equal(byNumber[2].outcome, 'failed');
  assert.match(byNumber[2].error, /Repository rule violations/);
  assert.equal(byNumber[3].outcome, 'skipped');
  assert.equal(byNumber[4].outcome, 'skipped');
  assert.deepEqual(
    gh.merges().map(call => call.slice(3).join(' ')),
    ['1 --repo link-foundation/links-notation --merge --match-head-commit sha1', '1 --repo link-foundation/links-notation --merge --match-head-commit sha1 --admin', '2 --repo link-foundation/links-notation --merge --match-head-commit sha2', '2 --repo link-foundation/links-notation --merge --match-head-commit sha2 --admin']
  );

  const section = buildDependabotPullRequestsSection(result);
  assert.match(section, /\[#1\]\(.*\/pull\/1\) Blocked by required checks.*merged with `--admin`/);
  assert.match(section, /could not be merged automatically/);
  assert.match(section, /\[#2\].*merge failed: GraphQL: Repository rule violations found/);
  assert.match(section, /\[#3\].*skipped: merge conflict/);
  assert.match(section, /Apply each of these updates/);
});

test('--dry-run only lists what would be merged', async () => {
  const gh = fakeGh();
  const result = await mergeDependabotPullRequests({ repository, run: gh.run, warn: () => {}, dryRun: true });
  assert.equal(gh.merges().length, 0);
  assert.ok(result.pullRequests.every(entry => entry.outcome === 'planned'));
  assert.match(buildDependabotPullRequestsSection(result), /\(dry run\)[\s\S]*will be merged/);
});

test('a listing failure never blocks the issue and is reported in it', async () => {
  const warnings = [];
  const gh = fakeGh({ listing: { code: 1, stdout: '', stderr: 'HTTP 403: Resource not accessible by integration\n' } });
  const result = await mergeDependabotPullRequests({ repository, run: gh.run, warn: message => warnings.push(message) });
  assert.match(result.listingError, /HTTP 403/);
  assert.match(warnings[0], /Could not list open Dependabot pull requests/);
  assert.match(buildDependabotPullRequestsSection(result), /could not be listed \(HTTP 403/);
});

test('nothing open, or merging disabled, adds no section', async () => {
  const gh = fakeGh({ prs: [] });
  const result = await mergeDependabotPullRequests({ repository, run: gh.run, warn: () => {} });
  assert.deepEqual(result.pullRequests, []);
  assert.equal(buildDependabotPullRequestsSection(result), '');
  assert.equal(buildDependabotPullRequestsSection({ enabled: false, pullRequests: [] }), '');
  assert.equal(buildDependabotPullRequestsSection(null), '');
  assert.doesNotMatch(buildUpdateDependenciesIssueBody({ repository, languages: {}, files: [] }), /Dependabot pull requests merged/);
});

test('the generated issue merges first, then leads with the note to fix every error', async () => {
  const gh = fakeGh();
  const issue = await createUpdateDependenciesIssue({ repository, run: gh.run, warn: () => {} });
  const firstMerge = gh.calls.findIndex(call => call[2] === 'merge');
  const firstContextRead = gh.calls.findIndex(call => call[2]?.endsWith?.('/languages'));
  const create = gh.calls.findIndex(call => call[1] === 'issue' && call[2] === 'create');
  assert.ok(firstMerge >= 0 && firstMerge < firstContextRead && firstContextRead < create, 'merged before the context is read and the issue is created');

  const body = gh.calls[create].body;
  assert.ok(body.startsWith('### Dependabot pull requests merged before this issue was created'), body.slice(0, 200));
  for (const number of [343, 344, 346, 347]) assert.match(body, new RegExp(`\\[#${number}\\]\\(${repository.url}/pull/${number}\\)`));
  assert.match(body, /without waiting for CI\/CD/);
  assert.match(body, /\*\*Fix every error these merges introduced\.\*\*/);
  assert.match(body, /not passing: \[Dependabot auto-merge \/ auto-merge\]\(.*\) \(failure\), \[dependency freshness \/ latest-stable\]/);
  assert.match(body, /CI\/CD of the default branch is green/);
  assert.equal(issue.prepared.dependabot.pullRequests.length, 4);
});

test('the opt-out skips the merge and the note', async () => {
  const gh = fakeGh();
  const prepared = await prepareUpdateDependenciesIssue({ repository, run: gh.run, warn: () => {}, mergeDependabotPrs: false });
  assert.equal(gh.calls.filter(call => call[1] === 'pr').length, 0);
  assert.doesNotMatch(prepared.body, /Dependabot pull requests merged/);
  assert.match(summarizeDependabotPullRequests(prepared.dependabot), /merging disabled/);
});

test('/fix parses --no-merge-dependabot-prs and keeps it away from /solve', () => {
  assert.equal(partitionFixArgs(['owner/repo', '--update-all-dependencies']).mergeDependabotPrs, true, 'on by default');
  const parsed = partitionFixArgs(['owner/repo', '--update-all-dependencies', '--no-merge-dependabot-prs', '--model', 'opus']);
  assert.equal(parsed.mergeDependabotPrs, false);
  assert.equal(partitionFixArgs(['owner/repo', '--update-all-dependencies', '--no-merge-dependabot-prs', '--merge-dependabot-prs']).mergeDependabotPrs, true, 'the last flag wins');
  assert.ok(!buildSolveArgs({ issueUrl: 'u', passthrough: parsed.passthrough, mode: parsed.mode }).some(arg => arg.includes('dependabot')));
  for (const flag of ['--merge-dependabot-prs', '--no-merge-dependabot-prs']) {
    assert.ok(FIX_OWNED_BOOLEAN_FLAGS.includes(flag));
    assert.ok(FIX_OWN_OPTIONS.includes(flag), 'Telegram /fix accepts the flag instead of rejecting it as an unknown solve option');
  }
});

test('Telegram /task --update-all-dependencies merges by default and honours the opt-out', { timeout: 5000 }, async () => {
  assert.equal(resolveMergeDependabotPrs([]), true);
  assert.equal(resolveMergeDependabotPrs(['--no-merge-dependabot-prs']), false);
  assert.equal(resolveMergeDependabotPrs(['--no-merge-dependabot-prs', '--merge-dependabot-prs']), true);

  let generated;
  const { handleTaskCommand } = registerTaskCommands(
    { command() {} },
    {
      taskEnabled: true,
      addBreadcrumb: async () => {},
      isOldMessage: () => false,
      isGroupChat: () => true,
      isTopicAuthorized: () => true,
      isChatStopped: () => false,
      createUpdateDependenciesIssue: async options => {
        generated = options;
        return { url: `${repository.url}/issues/1` };
      },
    }
  );
  for (const [suffix, expected] of [
    ['', true],
    [' --no-merge-dependabot-prs', false],
  ]) {
    await handleTaskCommand({
      chat: { id: 1, type: 'group' },
      from: { id: 2, username: 'tester' },
      message: { text: `/task --update-all-dependencies ${repository.fullName}${suffix}`, message_id: 1 },
      reply: async () => ({ chat: { id: 1 }, message_id: 2 }),
      telegram: { editMessageText: async () => {} },
    });
    assert.equal(generated?.mergeDependabotPrs, expected, suffix || 'default');
  }
});
