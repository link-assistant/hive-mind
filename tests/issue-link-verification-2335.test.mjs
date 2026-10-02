#!/usr/bin/env node
/** Issue #2335: pull requests must stay linked to every issue they solve. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, access, mkdtemp, writeFile, symlink, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { evaluateClosingReferencesGate } from '../src/solve.ensure-sub-issues.detect.lib.mjs';
import { checkIssueLinksBeforeMerge, closeLinkedIssuesAfterMerge, fetchPullRequestIssueScope, fetchRequiredIssueScope, ghJson, issueKey } from '../src/issue-link-verification.lib.mjs';
import { repairRequiredIssueLinks } from '../src/pr-issue-link-repair.lib.mjs';
import { prepareRepositoryModeIssue } from '../src/solve.repository-mode.run.lib.mjs';
import { parseRequiredClosingReferences, REPOSITORY_MODE_MARKER, REQUIRED_CLOSING_REFERENCES_HEADING } from '../src/solve.repository-mode.lib.mjs';
import { resolvePrimaryIssueNumber } from '../src/github-linking.lib.mjs';
import { MergeQueueProcessor } from '../src/telegram-merge-queue.lib.mjs';

const headSha = 'a'.repeat(40);
const repository = { owner: 'link-assistant', repo: 'agent' };
const context = { ...repository, issueNumber: 322, prNumber: 326 };
const source = (number, body = '## Done when\n- All peers work.') => ({ number, title: `Issue ${number}`, body });
const json = value => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });
const linkPage = (...keys) => ({ data: { repository: { pullRequest: { closingIssuesReferences: { nodes: keys.map(key => ({ number: Number(key.split('#')[1]), repository: { nameWithOwner: key.split('#')[0] } })) } } } } });

/** Finite, fully paginated GitHub fixture. Unknown requests fail the test. */
function fixture() {
  const responses = new Map([
    ['repos/link-assistant/agent/pulls/326', { body: 'Fixes #322', head: { sha: headSha, ref: 'issue-322-example' }, base: { ref: 'main' }, html_url: 'https://github.com/link-assistant/agent/pull/326' }],
    ['repos/link-assistant/agent', { default_branch: 'main' }],
    ['repos/link-assistant/agent/issues/322', source(322)],
    ['repos/link-assistant/agent/issues/322/sub_issues', [[]]],
    ['graphql', [linkPage('link-assistant/agent#322')]],
  ]);
  const calls = [];
  const files = [];
  const pr = responses.get('repos/link-assistant/agent/pulls/326');
  const run = async args => {
    calls.push(args);
    if (args[0] === 'pr' && args[1] === 'edit') {
      const path = args[args.indexOf('--body-file') + 1];
      files.push(path);
      pr.body = await readFile(path, 'utf8');
      return json({});
    }
    assert.equal(args[0], 'api');
    assert.ok(responses.has(args[1]), `unexpected endpoint ${args[1]}`);
    if (args[1] === 'graphql' || args[1].endsWith('/sub_issues')) {
      assert.ok(args.includes('--paginate'));
      assert.ok(args.includes('--slurp'));
    }
    const response = responses.get(args[1]);
    return typeof response === 'function' ? response(args) : json(response);
  };
  const add = (owner, repo, number, body) => {
    responses.set(`repos/${owner}/${repo}/issues/${number}`, source(number, body));
    responses.set(`repos/${owner}/${repo}/issues/${number}/sub_issues`, [[]]);
  };
  return { responses, calls, files, pr, run, add, check: () => checkIssueLinksBeforeMerge({ ...context, run }) };
}

test('ordinary issue: removing the primary closing reference blocks merge', async () => {
  const result = evaluateClosingReferencesGate({ ensureEnabled: false, issueBody: '## Done when\n- All peers work.', subIssues: [], prText: 'Related to #322. This PR does not close #322.', owner: 'link-assistant', repo: 'agent', issueNumber: 322, prNumber: 326 });
  assert.equal(result.enabled, true);
  assert.equal(result.blocker.reason, 'missing_closing_references');
  assert.deepEqual(
    result.missing.map(issue => issue.number),
    [322]
  );
  const f = fixture();
  f.pr.body = 'Related to #322. This PR does not close #322.';
  const { blocker } = await f.check();
  assert.equal(blocker.reason, 'missing_closing_references');
  assert.deepEqual(blocker.details, ['link-assistant/agent#322']);
});

test('the reported PR #326 is blocked until its closing link is repaired', async () => {
  const f = fixture();
  const incident = JSON.parse(await readFile(new URL('../docs/case-studies/issue-2335/data/agent-pr-326.json', import.meta.url), 'utf8'));
  const issue = JSON.parse(await readFile(new URL('../docs/case-studies/issue-2335/data/agent-issue-322.json', import.meta.url), 'utf8'));
  f.responses.set('repos/link-assistant/agent/issues/322', source(322, issue.body));
  f.pr.body = incident.body;
  assert.equal((await f.check()).blocker.reason, 'missing_closing_references');
  assert.equal((await repairRequiredIssueLinks({ ...context, run: f.run })).updated, true);
  assert.match(f.pr.body, /^Fixes #322$/m);
  assert.equal((await f.check()).blocker, null);
});

test('GitHub-confirmed links allow merging', async () => {
  const f = fixture();
  const logs = [];
  const result = await checkIssueLinksBeforeMerge({ ...context, run: f.run, verbose: true, logger: async message => logs.push(message) });
  assert.equal(result.blocker, null);
  assert.equal(result.snapshot.headSha, headSha);
  assert.deepEqual(result.snapshot.issues.map(issueKey), ['link-assistant/agent#322']);
  assert.match(logs[0], /1 issue/);
});

test('GitHub errors and malformed responses never become permission to merge', async () => {
  for (const endpoint of fixture().responses.keys()) {
    const f = fixture();
    f.responses.set(endpoint, () => ({ code: 1, stdout: '', stderr: 'HTTP 403 unreadable' }));
    assert.equal((await f.check()).blocker.reason, 'issue_link_verification_failed', endpoint);
  }
  for (const value of [null, {}, { head: { sha: 'bad' }, body: '' }, { head: { sha: headSha }, body: 3 }]) {
    const f = fixture();
    f.responses.set('repos/link-assistant/agent/pulls/326', value);
    assert.equal((await f.check()).blocker.reason, 'issue_link_verification_failed');
  }
  for (const value of [null, {}, source(323), { ...source(322), body: 4 }, { ...source(322), pull_request: {} }]) {
    const f = fixture();
    f.responses.set('repos/link-assistant/agent/issues/322', value);
    assert.equal((await f.check()).blocker.reason, 'issue_link_verification_failed');
  }
  for (const value of [{}, [null], [[{ number: 0 }]]]) {
    const f = fixture();
    f.responses.set('repos/link-assistant/agent/issues/322/sub_issues', value);
    assert.equal((await f.check()).blocker.reason, 'issue_link_verification_failed');
  }
  const f = fixture();
  f.responses.set('repos/link-assistant/agent', {});
  assert.equal((await f.check()).blocker.reason, 'issue_link_verification_failed');
  await assert.rejects(ghJson(async () => ({ stdout: 'bad' }), ['api', 'fixture']));
  await assert.rejects(ghJson(async () => json({ errors: ['GraphQL failed'] }), ['api', 'graphql']));
  await assert.rejects(
    ghJson(async () => ({ code: 1, stdout: '', stderr: '' }), ['api', 'fixture']),
    /exited with code/
  );
});

test('the complete nested scope includes body-only and foreign issues, without cycles or duplicates', async () => {
  const f = fixture();
  const body = `${REPOSITORY_MODE_MARKER}\n${REQUIRED_CLOSING_REFERENCES_HEADING}\n\`\`\`\nFixes #7\nFixes #322\n\`\`\``;
  f.responses.set('repos/link-assistant/agent/issues/322', source(322, body));
  f.responses.set('repos/link-assistant/agent/issues/322/sub_issues', [[{ number: 7 }], [{ number: 7, repository_url: 'https://api.github.com/repos/other/project' }]]);
  f.add('link-assistant', 'agent', 7);
  f.add('other', 'project', 7);
  f.add('other', 'project', 8);
  f.responses.set('repos/other/project/issues/7/sub_issues', [[{ number: 8 }]]);
  f.responses.set('repos/other/project/issues/8/sub_issues', [[{ number: 7 }]]);
  const scope = await fetchRequiredIssueScope({ ...context, run: f.run });
  assert.deepEqual(scope.map(issueKey), ['link-assistant/agent#322', 'link-assistant/agent#7', 'other/project#7', 'other/project#8']);
  assert.equal((await f.check()).blocker.reason, 'missing_closing_references');
  const repaired = await repairRequiredIssueLinks({ ...context, run: f.run });
  assert.match(repaired.body, /Fixes #7\nFixes other\/project#7\nFixes other\/project#8/);
  assert.equal(repaired.updated, true);
  assert.equal((await f.check()).blocker.reason, 'unverified_issue_links');
  f.responses.set('graphql', [linkPage('link-assistant/agent#322', 'link-assistant/agent#7', 'other/project#7', 'other/project#8')]);
  assert.equal((await f.check()).blocker, null);
  for (const path of f.files) await assert.rejects(access(path), /ENOENT/);
});

test('unreadable repository-mode requirements block verification', async () => {
  const f = fixture();
  f.responses.set('repos/link-assistant/agent/issues/322', source(322, REPOSITORY_MODE_MARKER));
  assert.equal((await f.check()).blocker.reason, 'issue_link_verification_failed');
});

test('native links must match the exact repositories and all pages', async () => {
  const f = fixture();
  f.add('other', 'project', 7);
  f.pr.body += '\nFixes other/project#7';
  assert.equal((await f.check()).blocker.reason, 'unverified_issue_links');
  f.responses.get('graphql').push(linkPage('other/project#7'));
  assert.equal((await f.check()).blocker, null);
  f.responses.set('graphql', [linkPage('link-assistant/agent#322', 'another/project#7')]);
  assert.deepEqual((await f.check()).blocker.details, ['other/project#7']);
  f.responses.set('graphql', [{ data: {} }]);
  assert.equal((await f.check()).blocker.reason, 'issue_link_verification_failed');
});

test('non-default base branches skip native links; PR-only workflows remain available', async () => {
  const f = fixture();
  f.pr.base.ref = 'feature';
  f.responses.delete('graphql');
  const result = await f.check();
  assert.equal(result.blocker, null);
  assert.equal(result.snapshot.defaultBranch, 'main');
  f.pr.base = {};
  assert.equal((await f.check()).blocker.reason, 'issue_link_verification_failed');
  f.pr.head.ref = 'feature';
  f.pr.body = 'Maintenance with no linked issue.';
  assert.equal((await checkIssueLinksBeforeMerge({ ...repository, prNumber: 326, run: f.run })).blocker, null);
});

test('scope recovers the primary issue from explicit context, the branch, or a local reference', async () => {
  const f = fixture();
  assert.deepEqual((await fetchPullRequestIssueScope({ ...repository, prNumber: 326, run: f.run })).issues.map(issueKey), ['link-assistant/agent#322']);
  f.pr.head.ref = 'maintenance';
  f.pr.body = 'Fixes other/project#7\nFixes link-assistant/agent#322';
  f.add('other', 'project', 7, null);
  assert.deepEqual((await fetchPullRequestIssueScope({ ...repository, prNumber: 326, run: f.run })).issues.map(issueKey), ['link-assistant/agent#322', 'other/project#7']);
  f.pr.body = '';
  assert.deepEqual((await fetchPullRequestIssueScope({ ...context, run: f.run })).issues.map(issueKey), ['link-assistant/agent#322']);
  delete f.pr.head.ref;
  assert.deepEqual((await fetchPullRequestIssueScope({ ...repository, prNumber: 326, run: f.run })).issues, []);
});

test('the temporary description file is removed after successful, failed and throwing writes', async () => {
  const f = fixture();
  const exists = async path => !(await access(path).catch(error => error));
  f.pr.body = 'Human description.';
  assert.equal((await repairRequiredIssueLinks({ ...context, run: f.run })).updated, true);
  const written = [...f.files];
  for (const outcome of [{ code: 1, stderr: 'write failed' }, new Error('gh crashed')]) {
    f.pr.body = 'Human description.';
    const run = args => {
      if (args[0] !== 'pr') return f.run(args);
      written.push(args[args.indexOf('--body-file') + 1]);
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
    };
    assert.equal((await repairRequiredIssueLinks({ ...context, run })).checked, false);
  }
  assert.equal(written.length, 3);
  for (const path of written) assert.equal(await exists(path), false, path);
});

test('repair is idempotent, preserves descriptions, and does not claim success on failed writes', async () => {
  const f = fixture();
  assert.equal((await repairRequiredIssueLinks({ ...context, run: f.run })).updated, false);
  f.pr.body = 'Human description. This does not close #322.';
  const result = await repairRequiredIssueLinks({ ...context, argv: { fork: true }, run: f.run });
  assert.match(result.body, /^Human description/);
  assert.match(result.body, /Fixes link-assistant\/agent#322/);
  assert.equal((await repairRequiredIssueLinks({ ...context, run: f.run })).updated, false);
  f.pr.body = '';
  const failedRun = args => (args[0] === 'pr' ? Promise.resolve({ code: 1, stderr: 'write failed' }) : f.run(args));
  const failed = await repairRequiredIssueLinks({ ...context, run: failedRun });
  assert.equal(failed.checked, false);
  assert.match(failed.error, /write failed/);
  const racingRun = args => (args[0] === 'pr' ? Promise.resolve(json({})) : f.run(args));
  assert.match((await repairRequiredIssueLinks({ ...context, run: racingRun })).error, /not saved/);
  assert.equal((await repairRequiredIssueLinks({ run: f.run })).checked, false);
});

test('repair rejects invalid descriptions and reports write and logger failures', async () => {
  const f = fixture();
  for (const body of [undefined, 42]) {
    f.pr.body = body;
    assert.match((await repairRequiredIssueLinks({ ...context, run: f.run })).error, /Invalid pull request body/);
  }
  f.pr.body = null;
  const withoutCode = async args => {
    const { code: _ignored, ...result } = await f.run(args);
    return result;
  };
  assert.equal((await repairRequiredIssueLinks({ ...context, run: withoutCode })).updated, true);
  f.pr.body = '';
  assert.match((await repairRequiredIssueLinks({ ...context, run: async args => (args[0] === 'pr' ? { code: 1, stderr: '' } : f.run(args)) })).error, /Could not update/);
  await assert.rejects(
    repairRequiredIssueLinks({
      ...context,
      run: f.run,
      logger: async () => {
        throw new Error('logger unavailable');
      },
    }),
    /logger unavailable/
  );
  for (const path of f.files) await assert.rejects(access(path), /ENOENT/);
});

test('non-default branch merges close every linked local and foreign issue, and report failures', async () => {
  const issues = [
    { ...repository, number: 322 },
    { owner: 'other', repo: 'project', number: 7 },
    { ...repository, number: 8 },
  ];
  const snapshot = { issues, headSha, defaultBranch: 'main', pr: { base: { ref: 'stack' }, html_url: 'https://github.com/link-assistant/agent/pull/326' } };
  const calls = [];
  const run = async args => {
    calls.push(args);
    if (args[0] === 'api') return json({ state: args[1].endsWith('/8') ? 'closed' : 'open' });
    assert.equal(args[0], 'issue');
    assert.equal(args[1], 'close');
    return json({});
  };
  assert.deepEqual(await closeLinkedIssuesAfterMerge(snapshot, { run }), []);
  assert.deepEqual(
    calls.filter(args => args[0] === 'issue').map(args => args[args.indexOf('--repo') + 1]),
    ['link-assistant/agent', 'other/project']
  );
  const errors = [];
  assert.equal((await closeLinkedIssuesAfterMerge(snapshot, { run: async () => json({ state: 'unknown' }), logger: async message => errors.push(message) })).length, 3);
  assert.equal(errors.length, 3);
  assert.equal((await closeLinkedIssuesAfterMerge(snapshot, { run: async args => (args[0] === 'api' ? json({ state: 'open' }) : { code: 1, stderr: 'forbidden' }) })).length, 3);
  assert.equal((await closeLinkedIssuesAfterMerge(snapshot, { run: async args => (args[0] === 'api' ? json({ state: 'open' }) : { code: 1, stderr: '' }) })).length, 3);
  assert.deepEqual(await closeLinkedIssuesAfterMerge(snapshot, { run: async args => (args[0] === 'api' ? json({ state: 'open' }) : { stdout: '' }) }), []);
  assert.deepEqual(await closeLinkedIssuesAfterMerge({ ...snapshot, pr: { base: { ref: 'main' } } }, { run }), []);
  assert.deepEqual(await closeLinkedIssuesAfterMerge(null, { run }), []);
});

test('deleted references recover the primary issue from the branch, never the PR number', () => {
  assert.equal(resolvePrimaryIssueNumber({ body: 'Fixes #7', branch: 'issue-322-hash', ...repository }), '322');
  assert.equal(resolvePrimaryIssueNumber({ body: 'Fixes other/project#322\nFixes #7', branch: 'feature', ...repository }), '7');
  assert.equal(resolvePrimaryIssueNumber({ body: 'Related to #322; does not close #322', branch: 'feature', ...repository }), null);
});

test('repository mode includes all 105 open issues while selecting only 100 native attachments', async () => {
  const entries = Array.from({ length: 105 }, (_, i) => ({ number: i + 1, id: i + 1000, title: `Issue ${i + 1}` }));
  const prepared = await prepareRepositoryModeIssue({ repository, run: async () => json(entries) });
  assert.equal(prepared.selected.length, 100);
  assert.equal(prepared.allIssues.length, 105);
  assert.equal(prepared.skipped, 0);
  assert.equal(parseRequiredClosingReferences(prepared.body).length, 105);
  assert.match(prepared.title, /all 105/);
  assert.doesNotMatch(prepared.body, /intentionally left out/);
});

test('queue preserves known issue context even if its branch and description lose the reference', async () => {
  for (const issue of [{ number: 322 }, null]) {
    let options;
    const processor = new MergeQueueProcessor({
      ...repository,
      checkPRMergeable: async () => ({ mergeable: true }),
      checkPRCIStatus: async () => ({ status: 'success' }),
      mergePullRequest: async (_owner, _repo, _pr, received) => {
        options = received;
        return { success: false, error: 'Issue links remain unverified' };
      },
    });
    const item = { pr: { number: 326, headRefName: 'maintenance' }, issue, getDescription: () => 'PR #326' };
    await processor.processItem(item);
    assert.equal(options.issueNumber, issue?.number ?? null);
    assert.equal(processor.stats.failed, 1);
    assert.equal(processor.stats.merged, 0);
  }
});

test('the actual shared merge boundary blocks missing links and merges once they are verified', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'issue-2335-merge-test-'));
  try {
    const fixtureFile = join(directory, 'responses.json');
    const callsFile = join(directory, 'calls.jsonl');
    const ghFixture = new URL('../experiments/issue-2335/gh-fixture.mjs', import.meta.url);
    await chmod(ghFixture, 0o755);
    await symlink(fileURLToPath(ghFixture), join(directory, 'gh'));
    const f = fixture();
    f.responses.set('repos/link-assistant/agent/issues/322/timeline', [
      { event: 'cross-referenced', source: { issue: { number: 326, state: 'open', html_url: 'https://github.com/link-assistant/agent/pull/326', pull_request: {}, body: 'Fixes #322' } } },
      { event: 'cross-referenced', source: { issue: { number: 7, state: 'open', html_url: 'https://github.com/link-assistant/agent/pull/7', pull_request: {}, body: 'Related to #322. Does not close #322.' } } },
      { event: 'cross-referenced', source: { issue: { number: 8, state: 'open', html_url: 'https://github.com/foreign/project/pull/8', pull_request: {}, body: 'Fixes link-assistant/agent#322' } } },
    ]);
    const invoke = async (method = 'merge') => {
      await writeFile(fixtureFile, JSON.stringify(Object.fromEntries(f.responses)));
      await writeFile(callsFile, '');
      const moduleUrl = new URL('../src/github-merge.lib.mjs', import.meta.url).href;
      const code = `import { mergePullRequest, getLinkedPRsFromTimeline } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(await ${method === 'merge' ? "mergePullRequest('link-assistant', 'agent', 326, {issueNumber:322})" : "getLinkedPRsFromTimeline('link-assistant', 'agent', 322)"}));`;
      const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, ISSUE_2335_GH_FIXTURE: fixtureFile, ISSUE_2335_GH_CALLS: callsFile }, maxBuffer: 1024 * 1024 });
      const calls = (await readFile(callsFile, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line));
      return { result: JSON.parse(stdout.trim().split('\n').at(-1)), calls };
    };
    assert.deepEqual(
      (await invoke('timeline')).result.map(pr => pr.number),
      [326]
    );
    f.pr.body = 'Related to #322.';
    const blocked = await invoke();
    assert.equal(blocked.result.success, false);
    assert.equal(blocked.result.category, 'missing_closing_references');
    assert.equal(
      blocked.calls.some(args => args[0] === 'pr' && args[1] === 'merge'),
      false
    );
    f.pr.body = 'Fixes #322';
    const allowed = await invoke();
    assert.equal(allowed.result.success, true);
    assert.ok(allowed.calls.some(args => args[0] === 'pr' && args[1] === 'merge'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
