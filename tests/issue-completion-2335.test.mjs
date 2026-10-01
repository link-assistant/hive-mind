/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateClosingReferencesGate } from '../src/solve.ensure-sub-issues.detect.lib.mjs';
import { readFile, access, mkdtemp, writeFile, symlink, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import { checkIssueCompletionBeforeMerge, closeVerifiedIssuesAfterMerge, completionJson, fetchRequiredIssueScope, fetchRequirementsSnapshot } from '../src/issue-completion.lib.mjs';
import { REQUIREMENTS_START, REQUIREMENTS_END, createRequirementsReportTemplate, evaluateRequirementsReport, extractExplicitRequirements, formatRequirementsReport, issueKey, parseRequirementsReport, requirementFeedback, requirementSourceDigest } from '../src/issue-requirements.lib.mjs';
import { repairRequiredIssueLinks } from '../src/pr-issue-link-repair.lib.mjs';
import { runIssueCompletionUntilVerified } from '../src/solve.issue-completion.lib.mjs';
import { prepareRepositoryModeIssue } from '../src/solve.repository-mode.run.lib.mjs';
import { parseRequiredClosingReferences, REPOSITORY_MODE_MARKER, REQUIRED_CLOSING_REFERENCES_HEADING } from '../src/solve.repository-mode.lib.mjs';
import { resolvePrimaryIssueNumber } from '../src/github-linking.lib.mjs';
import { MergeQueueProcessor } from '../src/telegram-merge-queue.lib.mjs';

const headSha = 'a'.repeat(40);
const repository = { owner: 'link-assistant', repo: 'agent' };
const context = { ...repository, issueNumber: 322, prNumber: 326 };
const source = (number, body = '## Done when\n- All peers work.') => ({ number, title: `Issue ${number}`, body });
const json = value => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });

/** Finite, fully paginated GitHub fixture. Unknown requests fail the test. */
function fixture() {
  const responses = new Map([
    ['repos/link-assistant/agent/pulls/326', { body: 'Fixes #322', head: { sha: headSha, ref: 'issue-322-example' }, base: { ref: 'main' } }],
    ['repos/link-assistant/agent', { default_branch: 'main' }],
    ['repos/link-assistant/agent/issues/322', source(322)],
    ['repos/link-assistant/agent/issues/322/sub_issues', [[]]],
    ['repos/link-assistant/agent/issues/322/comments', [[]]],
    ['repos/link-assistant/agent/issues/326/comments', [[]]],
    ['repos/link-assistant/agent/pulls/326/comments', [[]]],
    ['repos/link-assistant/agent/pulls/326/reviews', [[]]],
    ['graphql', [{ data: { repository: { pullRequest: { closingIssuesReferences: { nodes: [{ number: 322, repository: { nameWithOwner: 'link-assistant/agent' } }] } } } } }]],
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
    if (args[1] === 'graphql' || /\/(?:comments|reviews|sub_issues)$/.test(args[1])) {
      assert.ok(args.includes('--paginate'));
      assert.ok(args.includes('--slurp'));
    }
    const response = responses.get(args[1]);
    return typeof response === 'function' ? response(args) : json(response);
  };
  const add = (owner, repo, number, body) => {
    responses.set(`repos/${owner}/${repo}/issues/${number}`, source(number, body));
    responses.set(`repos/${owner}/${repo}/issues/${number}/sub_issues`, [[]]);
    responses.set(`repos/${owner}/${repo}/issues/${number}/comments`, [[]]);
  };
  const report = async () => {
    const snapshot = await fetchRequirementsSnapshot({ ...context, run });
    const report = createRequirementsReportTemplate(snapshot);
    for (const issue of report.issues) for (const item of issue.requirements) Object.assign(item, { status: 'done', evidence: 'Automated peer-install regression test passes.' });
    pr.body = `${pr.body.split(REQUIREMENTS_START)[0].trim()}\n\n${formatRequirementsReport(report)}`;
    return report;
  };
  return { responses, calls, files, pr, run, add, report, check: () => checkIssueCompletionBeforeMerge({ ...context, run }) };
}

test('ordinary issue: removing the primary closing reference blocks merge', () => {
  const result = evaluateClosingReferencesGate({ ensureEnabled: false, issueBody: '## Done when\n- All peers work.', subIssues: [], prText: 'Related to #322. This PR does not close #322.', owner: 'link-assistant', repo: 'agent', issueNumber: 322, prNumber: 326 });
  assert.equal(result.enabled, true);
  assert.equal(result.blocker.reason, 'missing_closing_references');
  assert.deepEqual(
    result.missing.map(issue => issue.number),
    [322]
  );
});

test('passing CI and valid links cannot authorize a partial or undocumented implementation', async () => {
  const f = fixture();
  assert.equal((await f.check()).blocker.reason, 'incomplete_issue_requirements');
  const report = await f.report();
  report.issues[0].requirements[0].status = 'blocked';
  f.pr.body = `Fixes #322\n${formatRequirementsReport(report)}`;
  const result = await f.check();
  assert.match(result.blocker.details.join('\n'), /unfinished or unverified.*All peers work/);
});

test('the reported PR #326 remains blocked even after its closing link is repaired', async () => {
  const f = fixture();
  const incident = JSON.parse(await readFile(new URL('../docs/case-studies/issue-2335/data/agent-pr-326.json', import.meta.url), 'utf8'));
  const issue = JSON.parse(await readFile(new URL('../docs/case-studies/issue-2335/data/agent-issue-322.json', import.meta.url), 'utf8'));
  f.responses.set('repos/link-assistant/agent/issues/322', source(322, issue.body));
  f.pr.body = incident.body;
  assert.equal((await f.check()).blocker.reason, 'missing_closing_references');
  assert.equal((await repairRequiredIssueLinks({ ...context, run: f.run })).updated, true);
  assert.equal((await f.check()).blocker.reason, 'incomplete_issue_requirements');
  const report = await f.report();
  assert.equal(report.issues[0].requirements.length, 3);
  report.issues[0].requirements[0].status = 'blocked';
  f.pr.body = `Fixes #322\n${formatRequirementsReport(report)}`;
  assert.equal((await f.check()).blocker.reason, 'incomplete_issue_requirements');
});

test('current complete evidence plus GitHub-confirmed links allows merging', async () => {
  const f = fixture();
  await f.report();
  const logs = [];
  const result = await checkIssueCompletionBeforeMerge({ ...context, run: f.run, verbose: true, logger: async message => logs.push(message) });
  assert.equal(result.blocker, null);
  assert.equal(result.headSha, headSha);
  assert.match(logs[0], /1 issue/);
});

test('new commits, issue edits, comments, inline reviews and review bodies invalidate old evidence', async () => {
  for (const endpoint of ['repos/link-assistant/agent/issues/322', 'repos/link-assistant/agent/issues/322/comments', 'repos/link-assistant/agent/issues/326/comments', 'repos/link-assistant/agent/pulls/326/comments', 'repos/link-assistant/agent/pulls/326/reviews']) {
    const f = fixture();
    await f.report();
    f.responses.set(endpoint, endpoint.endsWith('/322') ? source(322, '## Done when\n- New requirement') : [[], [{ id: 9, body: '- [ ] Add the missing behavior' }]]);
    assert.ok((await f.check()).blocker, endpoint);
  }
  const f = fixture();
  await f.report();
  f.pr.head.sha = 'b'.repeat(40);
  assert.match((await f.check()).blocker.details[0], /current pull request commit/);
});

test('GitHub errors and malformed responses never become permission to merge', async () => {
  for (const endpoint of fixture().responses.keys()) {
    const f = fixture();
    await f.report();
    f.responses.set(endpoint, () => ({ code: 1, stdout: '', stderr: 'HTTP 403 unreadable' }));
    assert.equal((await f.check()).blocker.reason, 'issue_completion_verification_failed', endpoint);
  }
  for (const value of [null, {}, { head: { sha: 'bad' }, body: '' }, { head: { sha: headSha }, body: 3 }]) {
    const f = fixture();
    f.responses.set('repos/link-assistant/agent/pulls/326', value);
    assert.equal((await f.check()).blocker.reason, 'issue_completion_verification_failed');
  }
  for (const value of [null, {}, source(323), { ...source(322), body: 4 }, { ...source(322), pull_request: {} }]) {
    const f = fixture();
    f.responses.set('repos/link-assistant/agent/issues/322', value);
    assert.equal((await f.check()).blocker.reason, 'issue_completion_verification_failed');
  }
  for (const value of [{}, [null], [[{ number: 0 }]]]) {
    const f = fixture();
    f.responses.set('repos/link-assistant/agent/issues/322/sub_issues', value);
    assert.equal((await f.check()).blocker.reason, 'issue_completion_verification_failed');
  }
  await assert.rejects(completionJson(async () => ({ stdout: 'bad' }), ['api', 'fixture']));
  await assert.rejects(completionJson(async () => json({ errors: ['GraphQL failed'] }), ['api', 'graphql']));
  await assert.rejects(
    completionJson(async () => ({ code: 1, stdout: '', stderr: '' }), ['api', 'fixture']),
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
  const repaired = await repairRequiredIssueLinks({ ...context, run: f.run });
  assert.match(repaired.body, /Fixes #7\nFixes other\/project#7\nFixes other\/project#8/);
  assert.equal(repaired.updated, true);
  assert.equal((await f.check()).blocker.reason, 'incomplete_issue_requirements');
  for (const path of f.files) await assert.rejects(access(path), /ENOENT/);
});

test('unreadable repository-mode requirements block verification', async () => {
  const f = fixture();
  f.responses.set('repos/link-assistant/agent/issues/322', source(322, REPOSITORY_MODE_MARKER));
  assert.equal((await f.check()).blocker.reason, 'issue_completion_verification_failed');
});

test('native links must match the exact repositories and all pages', async () => {
  const f = fixture();
  f.add('other', 'project', 7);
  f.pr.body += '\nFixes other/project#7';
  await f.report();
  assert.equal((await f.check()).blocker.reason, 'unverified_issue_links');
  f.responses.get('graphql').push({ data: { repository: { pullRequest: { closingIssuesReferences: { nodes: [{ number: 7, repository: { nameWithOwner: 'other/project' } }] } } } } });
  assert.equal((await f.check()).blocker, null);
  f.responses.set('graphql', [{ data: {} }]);
  assert.equal((await f.check()).blocker.reason, 'issue_completion_verification_failed');
});

test('non-default base branches still require evidence; PR-only workflows remain available', async () => {
  const f = fixture();
  f.pr.base.ref = 'feature';
  await f.report();
  f.responses.delete('graphql');
  assert.equal((await f.check()).blocker, null);
  f.pr.base = {};
  assert.equal((await f.check()).blocker.reason, 'issue_completion_verification_failed');
  f.pr.head.ref = 'feature';
  f.pr.body = 'Maintenance with no linked issue.';
  assert.equal((await checkIssueCompletionBeforeMerge({ ...repository, prNumber: 326, run: f.run })).blocker, null);
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

test('requirements reports reject missing, duplicated, stale, blocked, omitted and empty evidence', async () => {
  const f = fixture();
  const report = await f.report();
  const snapshot = await fetchRequirementsSnapshot({ ...context, run: f.run });
  const evaluate = value => evaluateRequirementsReport({ ...snapshot, prBody: formatRequirementsReport(value) });
  assert.equal(evaluate(report), null);
  const variants = [r => r.issues.pop(), r => r.issues.push(r.issues[0]), r => r.issues.push({ owner: 'foreign', repo: 'repo', number: 1 }), r => r.issues.push(null), r => (r.issues[0].sourceDigest = 'stale'), r => (r.issues[0].requirements = []), r => (r.issues[0].requirements = null), r => (r.issues[0].requirements[0].text = 'Unrelated criterion'), r => (r.issues[0].requirements[0].evidence = ' '), r => (r.issues[0].requirements[0].status = 'pending'), r => (r.issues[0].requirements[0] = null), r => (r.headSha = 'stale'), r => (r.version = 2)];
  for (const mutate of variants) {
    const variant = globalThis.structuredClone(report);
    mutate(variant);
    assert.ok(evaluate(variant));
  }
  assert.ok(evaluateRequirementsReport({ ...snapshot, prBody: '', headSha: '' }));
  for (const body of ['', `${REQUIREMENTS_END}${REQUIREMENTS_START}`, `${REQUIREMENTS_START}bad${REQUIREMENTS_END}`, `${formatRequirementsReport(report)}${formatRequirementsReport(report)}`]) assert.equal(parseRequirementsReport(body), null);
  assert.deepEqual(parseRequirementsReport(`${REQUIREMENTS_START}\n${JSON.stringify(report)}\n${REQUIREMENTS_END}`), report);
});

test('requirements extraction preserves inline identifiers and captures feedback checkboxes', () => {
  assert.deepEqual(extractExplicitRequirements('## Done when\n- Upgrade `web-tree-sitter`.\n### Verification\n1. Install packed artifact.\n## Context\n- Not a criterion.\n- [ ] Added in review.\n```\n- [ ] Example only\n```'), ['Upgrade web-tree-sitter.', 'Install packed artifact.', 'Added in review.']);
  const snapshot = { headSha, issues: [{ ...repository, number: 322, sourceDigest: 'digest', explicitRequirements: [] }] };
  assert.equal(createRequirementsReportTemplate(snapshot).issues[0].requirements[0].status, 'pending');
  assert.equal(requirementSourceDigest({ body: 'first' }), requirementSourceDigest({ body: 'first', comments: [{ id: 9, body: '' }] }));
  assert.notEqual(requirementSourceDigest({ body: 'first' }), requirementSourceDigest({ body: 'second' }));
  assert.notEqual(requirementSourceDigest({}), requirementSourceDigest({ comments: [{ id: 8, body: 'Please fix Auto-merge blocked and all the unfinished requirements.' }] }));
  assert.equal(requirementSourceDigest({}), requirementSourceDigest({ comments: [{ id: 8, body: '<!-- hive-mind:working-session-summary -->\n## Working session summary\nBookkeeping.' }] }));
});

test('empty issue bodies and scoped reference recovery keep valid and invalid sources distinct', async () => {
  const f = fixture();
  assert.equal((await fetchRequirementsSnapshot({ ...repository, prNumber: 326, run: f.run })).issues[0].number, 322);
  f.pr.head.ref = 'maintenance';
  f.pr.body = 'Fixes other/project#7\nFixes link-assistant/agent#322';
  f.add('other', 'project', 7, null);
  const snapshot = await fetchRequirementsSnapshot({ ...repository, prNumber: 326, run: f.run });
  assert.deepEqual(snapshot.issues.map(issueKey), ['link-assistant/agent#322', 'other/project#7']);
  assert.deepEqual(snapshot.issues[1].explicitRequirements, []);
  for (const bad of [null, {}, source(8), { ...source(7), title: null }, { ...source(7), body: 9 }, { ...source(7), pull_request: {} }]) {
    f.responses.set('repos/other/project/issues/7', bad);
    assert.equal((await checkIssueCompletionBeforeMerge({ ...repository, prNumber: 326, run: f.run })).blocker.reason, 'issue_completion_verification_failed');
  }
  f.pr.body = '';
  assert.equal((await checkIssueCompletionBeforeMerge({ ...repository, prNumber: 326, run: f.run })).blocker, null);
  delete f.pr.head.ref;
  assert.equal((await checkIssueCompletionBeforeMerge({ ...repository, prNumber: 326, run: f.run })).blocker, null);
  f.pr.body = 'Fixes #322';
  await f.report();
  f.responses.set('repos/link-assistant/agent', {});
  assert.equal((await f.check()).blocker.reason, 'issue_completion_verification_failed');
});

test('feedback bookkeeping, ordering, report defaults and repair response failures are explicit', async () => {
  assert.deepEqual(requirementFeedback(null), []);
  assert.deepEqual(
    requirementFeedback([
      { id: 2, body: 'Second' },
      { id: 1, body: 'First' },
      { id: 3, body: '## Auto-merge blocked\nReported automatically by hive-mind.' },
    ]).map(item => item.id),
    [1, 2]
  );
  assert.deepEqual(extractExplicitRequirements(null), []);
  const f = fixture();
  const report = await f.report();
  const snapshot = await fetchRequirementsSnapshot({ ...context, run: f.run });
  assert.ok(evaluateRequirementsReport({ ...snapshot, prBody: formatRequirementsReport(report), headSha: null }));
  const noExplicit = { ...snapshot, issues: snapshot.issues.map(({ explicitRequirements: _ignored, ...issue }) => issue) };
  assert.equal(evaluateRequirementsReport({ ...noExplicit, prBody: formatRequirementsReport(report) }), null);
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

test('non-default branch merges close every verified local and foreign issue, and report failures', async () => {
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
  assert.deepEqual(await closeVerifiedIssuesAfterMerge(snapshot, { run }), []);
  assert.deepEqual(
    calls.filter(args => args[0] === 'issue').map(args => args[args.indexOf('--repo') + 1]),
    ['link-assistant/agent', 'other/project']
  );
  const errors = [];
  assert.equal((await closeVerifiedIssuesAfterMerge(snapshot, { run: async () => json({ state: 'unknown' }), logger: async message => errors.push(message) })).length, 3);
  assert.equal(errors.length, 3);
  assert.equal((await closeVerifiedIssuesAfterMerge(snapshot, { run: async args => (args[0] === 'api' ? json({ state: 'open' }) : { code: 1, stderr: 'forbidden' }) })).length, 3);
  assert.equal((await closeVerifiedIssuesAfterMerge(snapshot, { run: async args => (args[0] === 'api' ? json({ state: 'open' }) : { code: 1, stderr: '' }) })).length, 3);
  assert.deepEqual(await closeVerifiedIssuesAfterMerge(snapshot, { run: async args => (args[0] === 'api' ? json({ state: 'open' }) : { stdout: '' }) }), []);
  assert.deepEqual(await closeVerifiedIssuesAfterMerge({ ...snapshot, pr: { base: { ref: 'main' } } }, { run }), []);
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

test('completion retries run automatically, stop after verification, and respect finite failure limits', async () => {
  const blocker = { reason: 'incomplete_issue_requirements', message: 'missing evidence', details: ['criterion'], resolution: 'complete work' };
  const params = { ...context, argv: {} };
  let executions = 0;
  let checks = 0;
  const options = {
    repair: async () => {},
    check: async () => ({ blocker: checks++ < 2 ? blocker : null }),
    execute: async iteration => {
      executions++;
      assert.match(iteration.feedbackLines.join('\n'), /same PR/);
      return { success: true, sessionId: 'session' };
    },
    limit: 5,
  };
  const result = await runIssueCompletionUntilVerified(params, options);
  assert.equal(executions, 2);
  assert.equal(result.completionBlocker, null);
  executions = 0;
  options.check = async () => ({ blocker });
  options.limit = 2;
  assert.ok((await runIssueCompletionUntilVerified(params, options)).completionBlocker);
  assert.equal(executions, 2);
  executions = 0;
  options.limit = Infinity;
  options.execute = async () => {
    executions++;
    return { success: false };
  };
  await runIssueCompletionUntilVerified(params, options);
  assert.equal(executions, 3);
  executions = 0;
  options.execute = async () => {
    executions++;
    return { limitReached: true };
  };
  await runIssueCompletionUntilVerified(params, options);
  assert.equal(executions, 1);
  options.check = async () => ({ blocker: { ...blocker, reason: 'issue_completion_verification_failed' } });
  options.execute = async () => {
    executions++;
    return { success: true };
  };
  executions = 0;
  await runIssueCompletionUntilVerified(params, options);
  assert.equal(executions, 2);
  assert.equal(await runIssueCompletionUntilVerified({}, options), null);
});

test('default retries use the shared tool iteration and clean up; usage errors never merge', async () => {
  const blocker = { reason: 'incomplete_issue_requirements', message: 'unfinished', details: ['unfinished'], resolution: 'finish' };
  let cleanups = 0;
  const params = { ...context, cleanupClaudeFile: async () => cleanups++ };
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === './solve.restart-shared.lib.mjs' && context.parentURL.endsWith('/solve.issue-completion.lib.mjs')) return { url: 'data:text/javascript,export async function executeToolIteration(){return {success:true,sessionId:"fixture"}}', shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  try {
    let checks = 0;
    const result = await runIssueCompletionUntilVerified(params, { repair: async () => {}, check: async () => ({ blocker: checks++ ? null : blocker }) });
    assert.equal(result.sessionId, 'fixture');
    assert.equal(cleanups, 1);
  } finally {
    hooks.deregister();
  }
  const options = { repair: async () => {}, check: async () => ({ blocker }), execute: async () => ({ errorInfo: { usageLimitReached: true } }) };
  assert.ok((await runIssueCompletionUntilVerified({ ...params, argv: { 'ensure-all-sub-issues-addressed': 1 } }, options)).completionBlocker);
  options.execute = async () => ({ errorInfo: { type: 'usage_limit' } });
  assert.ok((await runIssueCompletionUntilVerified({ ...params, argv: { ensureAllSubIssuesAddressed: 1 } }, options)).completionBlocker);
  options.check = async () => ({ blocker: null });
  assert.equal(await runIssueCompletionUntilVerified(params, options), null);
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
        return { success: false, error: 'Completion remains blocked' };
      },
    });
    const item = { pr: { number: 326, headRefName: 'maintenance' }, issue, getDescription: () => 'PR #326' };
    await processor.processItem(item);
    assert.equal(options.issueNumber, issue?.number ?? null);
    assert.equal(processor.stats.failed, 1);
    assert.equal(processor.stats.merged, 0);
  }
});

test('the actual shared merge boundary blocks missing evidence and pins verified merges to their SHA', { timeout: 30000 }, async () => {
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
    const blocked = await invoke();
    assert.equal(blocked.result.success, false);
    assert.equal(blocked.result.category, 'incomplete_issue_requirements');
    assert.equal(
      blocked.calls.some(args => args[0] === 'pr' && args[1] === 'merge'),
      false
    );
    const snapshotScript = fileURLToPath(new URL('../src/issue-requirements-snapshot.mjs', import.meta.url));
    const snapshotOptions = { env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, ISSUE_2335_GH_FIXTURE: fixtureFile, ISSUE_2335_GH_CALLS: callsFile }, maxBuffer: 1024 * 1024 };
    const { stdout } = await promisify(execFile)(process.execPath, [snapshotScript, 'link-assistant/agent', '322', '326'], snapshotOptions);
    const template = parseRequirementsReport(stdout);
    assert.equal(template.headSha, headSha);
    assert.equal(template.issues[0].requirements[0].status, 'pending');
    assert.equal(template.issues[0].requirements[0].evidence, '');
    await assert.rejects(promisify(execFile)(process.execPath, [snapshotScript, 'bad', '0', '326'], snapshotOptions), /Usage:/);
    f.responses.set('repos/link-assistant/agent/pulls/326', {});
    await writeFile(fixtureFile, JSON.stringify(Object.fromEntries(f.responses)));
    await assert.rejects(promisify(execFile)(process.execPath, [snapshotScript, 'link-assistant/agent', '322', '326'], snapshotOptions), /Cannot prepare requirements report:/);
    f.responses.set('repos/link-assistant/agent/pulls/326', f.pr);
    await f.report();
    const allowed = await invoke();
    assert.equal(allowed.result.success, true);
    const args = allowed.calls.find(args => args[0] === 'pr' && args[1] === 'merge');
    assert.equal(args[args.indexOf('--match-head-commit') + 1], headSha);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
