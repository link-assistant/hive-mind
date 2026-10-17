#!/usr/bin/env node
/** Issue #2406: automated merges require a current, complete requirements report for every required issue. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, writeFile, symlink, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { checkIssueCompletionBeforeMerge, fetchRequirementSources } from '../src/issue-completion.lib.mjs';
import { REQUIREMENTS_START, REQUIREMENTS_END, createRequirementsReportTemplate, evaluateRequirementsReport, extractExplicitRequirements, formatRequirementsReport, parseRequirementsReport, preserveRequirementsReport, requirementFeedback, requirementSourceDigest } from '../src/issue-requirements.lib.mjs';
import { runIssueCompletionUntilVerified } from '../src/solve.issue-completion.lib.mjs';
import { buildAutoMergeBlockedComment } from '../src/automation-stop-reporting.lib.mjs';

const headSha = 'a'.repeat(40);
const repository = { owner: 'link-assistant', repo: 'agent' };
const context = { ...repository, issueNumber: 322, prNumber: 326 };
const source = (number, body = '## Done when\n- All peers work.') => ({ number, title: `Issue ${number}`, body, state: 'open', created_at: '2020-01-01T00:00:00Z' });
const json = value => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });
const linkPage = (...keys) => ({ data: { repository: { pullRequest: { closingIssuesReferences: { nodes: keys.map(key => ({ number: Number(key.split('#')[1]), repository: { nameWithOwner: key.split('#')[0] } })) } } } } });

/** Finite, fully paginated GitHub fixture. Unknown requests fail the test. */
function fixture() {
  const responses = new Map([
    ['repos/link-assistant/agent/pulls/326', { body: 'Fixes #322', head: { sha: headSha, ref: 'issue-322-example' }, base: { ref: 'main' }, created_at: '2021-01-01T00:00:00Z', html_url: 'https://github.com/link-assistant/agent/pull/326' }],
    ['repos/link-assistant/agent', { default_branch: 'main' }],
    ['repos/link-assistant/agent/issues/322', source(322)],
    ['repos/link-assistant/agent/issues/322/sub_issues', [[]]],
    ['repos/link-assistant/agent/issues/322/comments', [[]]],
    ['repos/link-assistant/agent/issues/326/comments', [[]]],
    ['repos/link-assistant/agent/pulls/326/comments', [[]]],
    ['repos/link-assistant/agent/pulls/326/reviews', [[]]],
    ['graphql', [linkPage('link-assistant/agent#322')]],
  ]);
  const calls = [];
  const pr = responses.get('repos/link-assistant/agent/pulls/326');
  const run = async args => {
    calls.push(args);
    assert.equal(args[0], 'api');
    assert.ok(responses.has(args[1]), `unexpected endpoint ${args[1]}`);
    if (/\/(?:comments|reviews|sub_issues)$/.test(args[1])) assert.ok(args.includes('--paginate') && args.includes('--slurp'), args[1]);
    const response = responses.get(args[1]);
    return typeof response === 'function' ? response(args) : json(response);
  };
  /** Fill the template the agent is given, marking every requirement done. */
  const report = async (mutate = () => {}) => {
    const { requirements } = await fetchRequirementSources({ ...context, issues: [{ ...repository, number: 322 }], run });
    const value = createRequirementsReportTemplate({ headSha: pr.head.sha, issues: requirements });
    for (const issue of value.issues) for (const item of issue.requirements) Object.assign(item, { status: 'done', evidence: 'tests/peers.test.mjs passes.' });
    mutate(value);
    pr.body = `Fixes #322\n\n${formatRequirementsReport(value)}`;
    return value;
  };
  return { responses, calls, pr, run, report, check: (extra = {}) => checkIssueCompletionBeforeMerge({ ...context, run, requirementsReport: true, ...extra }) };
}

test('with --requirements-report, valid closing links alone do not authorize an automated merge', async () => {
  const f = fixture();
  const result = await f.check();
  assert.equal(result.blocker.reason, 'incomplete_issue_requirements');
  assert.match(result.blocker.details.join('\n'), /Missing or malformed requirements report/);
  assert.equal(result.headSha, headSha);
});

test('a current, complete report with evidence for every criterion allows the merge', async () => {
  const f = fixture();
  await f.report();
  const logs = [];
  const result = await f.check({ verbose: true, logger: async message => logs.push(message) });
  assert.equal(result.blocker, null);
  assert.equal(result.headSha, headSha);
  assert.ok(result.snapshot.issues.length === 1, 'the link snapshot is passed through for post-merge closing');
  assert.ok(logs.some(line => /Requirements verified for 1 issue/.test(line)));
});

test('missing links are still reported first, before any report is evaluated', async () => {
  const f = fixture();
  f.pr.body = 'Related to #322. This does not close #322.';
  assert.equal((await f.check()).blocker.reason, 'missing_closing_references');
});

test('pending, blocked, unfinished or evidence-free criteria keep the merge blocked', async () => {
  for (const mutate of [r => (r.issues[0].requirements[0].status = 'pending'), r => (r.issues[0].requirements[0].evidence = ' '), r => (r.issues[0].requirements = []), r => r.issues[0].requirements.splice(0, 1, { text: 'Something else', status: 'done', evidence: 'x' })]) {
    const f = fixture();
    await f.report(mutate);
    const { blocker } = await f.check();
    assert.equal(blocker?.reason, 'incomplete_issue_requirements');
    assert.equal(blocker.retryable, true);
  }
  const f = fixture();
  await f.report(r => Object.assign(r.issues[0].requirements[0], { status: 'blocked', evidence: 'Upstream API returns 403; see upstream issue.' }));
  const { blocker } = await f.check();
  assert.equal(blocker.reason, 'incomplete_issue_requirements');
  assert.match(blocker.details.join('\n'), /blocked.*All peers work/);
  assert.equal(blocker.retryable, false, 'honestly blocked work needs a human, not another identical restart');
});

test('a new commit, issue edit, issue comment, PR comment, inline comment or review invalidates the report', async () => {
  const feedback = [[{ id: 9, body: '- [ ] Also support IPv6 peers' }]];
  for (const [endpoint, value] of [
    ['repos/link-assistant/agent/issues/322', source(322, '## Done when\n- All peers work.\n- New requirement.')],
    ['repos/link-assistant/agent/issues/322/comments', feedback],
    ['repos/link-assistant/agent/issues/326/comments', feedback],
    ['repos/link-assistant/agent/pulls/326/comments', feedback],
    ['repos/link-assistant/agent/pulls/326/reviews', feedback],
  ]) {
    const f = fixture();
    await f.report();
    f.responses.set(endpoint, value);
    assert.ok((await f.check()).blocker, endpoint);
  }
  const f = fixture();
  await f.report();
  f.pr.head.sha = 'b'.repeat(40);
  assert.match((await f.check()).blocker.details[0], /current pull request commit/);
});

test('tool bookkeeping comments do not invalidate the report, quoted phrases in user feedback do', async () => {
  const f = fixture();
  await f.report();
  f.responses.set('repos/link-assistant/agent/issues/326/comments', [
    [
      { id: 1, body: '## 🤖 Solution Draft Log\nThis log file contains the complete transcript.\n\nNow working session is ended.' },
      { id: 2, body: '<!-- hive-mind:working-session-summary -->\n## Working session summary\nDone.' },
    ],
  ]);
  assert.equal((await f.check()).blocker, null);
  f.responses.set('repos/link-assistant/agent/issues/326/comments', [[{ id: 3, body: 'Please fix the Auto-merge blocked state and finish the work.' }]]);
  assert.ok((await f.check()).blocker);
});

test('every unreadable or malformed GitHub response fails closed', async () => {
  for (const endpoint of fixture().responses.keys()) {
    const f = fixture();
    await f.report();
    f.responses.set(endpoint, () => ({ code: 1, stdout: '', stderr: 'HTTP 403 unreadable' }));
    const { blocker } = await f.check();
    assert.ok(['issue_completion_verification_failed', 'issue_link_verification_failed'].includes(blocker?.reason), endpoint);
  }
  for (const endpoint of ['repos/link-assistant/agent/issues/322/comments', 'repos/link-assistant/agent/pulls/326/reviews']) {
    const f = fixture();
    await f.report();
    f.responses.set(endpoint, { not: 'an array' });
    assert.equal((await f.check()).blocker.reason, 'issue_completion_verification_failed', endpoint);
  }
});

test('pull requests without any linked issue keep merging without a report', async () => {
  const f = fixture();
  f.pr.head.ref = 'maintenance';
  f.pr.body = 'Maintenance with no linked issue.';
  const result = await checkIssueCompletionBeforeMerge({ ...repository, prNumber: 326, run: f.run, requirementsReport: true });
  assert.equal(result.blocker, null);
  assert.equal(result.headSha, headSha);
});

test('the report parser, extractor and digest are strict and deterministic', () => {
  assert.deepEqual(extractExplicitRequirements('## Done when\n- Upgrade `web-tree-sitter`.\n### Verification\n1. Install packed artifact.\n## Context\n- Not a criterion.\n- [ ] Added in review.\n```\n- [ ] Example only\n```'), ['Upgrade web-tree-sitter.', 'Install packed artifact.', 'Added in review.']);
  const report = { version: 1, headSha, issues: [] };
  for (const body of ['', `${REQUIREMENTS_END}${REQUIREMENTS_START}`, `${REQUIREMENTS_START}bad${REQUIREMENTS_END}`, `${formatRequirementsReport(report)}${formatRequirementsReport(report)}`, formatRequirementsReport({ ...report, version: 2 })]) assert.equal(parseRequirementsReport(body), null);
  assert.deepEqual(parseRequirementsReport(`${REQUIREMENTS_START}\n${JSON.stringify(report)}\n${REQUIREMENTS_END}`), report);
  assert.deepEqual(parseRequirementsReport(formatRequirementsReport(report)), report);
  assert.equal(requirementSourceDigest({ body: 'first' }), requirementSourceDigest({ body: 'first', comments: [{ id: 9, body: '' }] }));
  assert.notEqual(requirementSourceDigest({ body: 'first' }), requirementSourceDigest({ body: 'second' }));
  assert.deepEqual(
    requirementFeedback([
      { id: 2, body: 'b' },
      { id: 1, body: 'a' },
    ]).map(c => c.id),
    [1, 2]
  );
  const template = createRequirementsReportTemplate({ headSha, issues: [{ ...repository, number: 322, sourceDigest: 'd', explicitRequirements: [] }] });
  assert.equal(template.issues[0].requirements[0].status, 'pending');
  assert.ok(evaluateRequirementsReport({ prBody: formatRequirementsReport(template), headSha, issues: [{ ...repository, number: 322, sourceDigest: 'd', explicitRequirements: [] }] }));
});

test("hive-mind's own status comments posted after the report do not make it stale", async () => {
  const { trackToolCommentId, resetTrackedToolCommentIds } = await import('../src/tool-comments.lib.mjs');
  const digest = feedback => requirementSourceDigest({ body: 'issue', feedback });
  const before = digest([{ id: 1, body: 'Please also add docs.' }]);
  // Posted by solve.mjs once CI is green, after the agent wrote its report.
  const status = ['## ✅ Ready to merge\n\nThis pull request is now ready to be merged:', '## 🔄 Auto-restart 1/5\n\nDetected uncommitted changes', '## ⚠️ Auto-merge blocked\n\nAuto-merge (`--auto-merge`) cannot merge', '## 🛑 Automation stopped: CI failed', '## Cancelled CI/CD Requires Review\n\nx'];
  assert.equal(digest([{ id: 1, body: 'Please also add docs.' }, ...status.map((body, i) => ({ id: 10 + i, body }))]), before);
  // A tracked comment of this run is bookkeeping whatever it says.
  trackToolCommentId(99);
  assert.equal(
    digest([
      { id: 1, body: 'Please also add docs.' },
      { id: 99, body: 'anything' },
    ]),
    before
  );
  resetTrackedToolCommentIds();
  // A person quoting or titling with a marker is still feedback.
  for (const body of ['The bot said "Ready to merge" but the docs are missing.', '## Ready to merge?\nNo.', '## Ready to merge\nNot yet.'])
    assert.notEqual(
      digest([
        { id: 1, body: 'Please also add docs.' },
        { id: 2, body },
      ]),
      before,
      body
    );
});

test('a stalled git pull cannot hang the completion restart loop', async () => {
  const { mkdtempSync, writeFileSync, chmodSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { syncCompletionBranch } = await import('../src/solve.issue-completion.lib.mjs');
  const bin = mkdtempSync(join(tmpdir(), 'stalled-git-'));
  writeFileSync(join(bin, 'git'), '#!/bin/sh\nsleep 30\n');
  chmodSync(join(bin, 'git'), 0o755);
  const warnings = [];
  const started = Date.now();
  await syncCompletionBranch({ tempDir: bin, branchName: 'issue-1', timeoutMs: 300, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, logger: async line => warnings.push(line) });
  assert.ok(Date.now() - started < 10_000, 'the pull was abandoned at its timeout');
  assert.match(warnings.join('\n'), /git pull failed .*continuing with local state/);
});

test('rewriting a placeholder description keeps an existing requirements report', () => {
  const block = formatRequirementsReport({ version: 1, headSha, issues: [] });
  assert.equal(preserveRequirementsReport(`old\n${block}`, 'new body'), `new body\n\n${block}`);
  assert.equal(preserveRequirementsReport('old', 'new body'), 'new body');
  assert.equal(preserveRequirementsReport(`old\n${block}`, `new\n${block}`), `new\n${block}`);
});

test('with --requirements-report, completion retries stop when verified and are bounded', async () => {
  const params = { ...context, issueUrl: 'u', branchName: 'b', tempDir: '/tmp/x', argv: { requirementsReport: true } };
  const synced = [];
  // The real loop pulls the branch before each restart; record it instead.
  const restart = (input, deps) => runIssueCompletionUntilVerified(input, { sync: async options => synced.push(options.branchName), ...deps });
  const incomplete = { reason: 'incomplete_issue_requirements', message: 'Issue requirements have not been verified for this pull request.', details: ['link-assistant/agent#322: unfinished'], resolution: 'Finish.', retryable: true };
  // Verified after one restart.
  let checks = 0;
  const executed = [];
  const verified = await restart(params, { check: async () => ({ blocker: checks++ === 0 ? incomplete : null }), execute: async iteration => (executed.push(iteration), { sessionId: 's1' }) });
  assert.equal(executed.length, 1);
  assert.equal(verified.sessionId, 's1');
  assert.equal(verified.completionBlocker, null);
  assert.ok(executed[0].feedbackLines.some(line => /every requirement/i.test(line)));
  assert.ok(executed[0].feedbackLines.includes('link-assistant/agent#322: unfinished'));
  assert.equal(executed[0].argv.promptEnsureAllRequirementsAreMet, true);
  assert.deepEqual(synced, ['b'], 'the branch is synced before the restart');
  // Never verified: bounded by the default limit.
  const bounded = [];
  const result = await restart(params, { check: async () => ({ blocker: incomplete }), execute: async iteration => (bounded.push(iteration), {}) });
  assert.equal(bounded.length, 3);
  assert.equal(result.completionBlocker.reason, 'incomplete_issue_requirements');
  // Already verified: nothing runs.
  assert.equal(await restart(params, { check: async () => ({ blocker: null }), execute: async () => assert.fail('no restart') }), null);
  // Missing PR or issue: nothing runs.
  assert.equal(await restart({ ...params, prNumber: null }, { check: async () => assert.fail('no check'), execute: async () => assert.fail('no restart') }), null);
  // Usage limit stops immediately.
  let limited = 0;
  await restart(params, { check: async () => ({ blocker: incomplete }), execute: async () => (limited++, { limitReached: true }) });
  assert.equal(limited, 1);
  // Explicitly blocked work is not retried.
  await restart(params, { check: async () => ({ blocker: { ...incomplete, retryable: false } }), execute: async () => assert.fail('no restart for blocked work') });
  // Unreadable evidence: three consecutive failures stop the loop.
  let failures = 0;
  await restart({ ...params, argv: { requirementsReport: true, ensureAllSubIssuesAddressed: 'unlimited' } }, { check: async () => ({ blocker: { ...incomplete, reason: 'issue_completion_verification_failed' } }), execute: async () => (failures++, {}) });
  assert.equal(failures, 2);
  // Three consecutive tool or API errors stop the loop too.
  let errors = 0;
  await restart({ ...params, argv: { requirementsReport: true, ensureAllSubIssuesAddressed: 'unlimited' } }, { check: async () => ({ blocker: incomplete }), execute: async () => (errors++, { apiError: true }) });
  assert.equal(errors, 3);
  // Dry runs never restart.
  assert.equal(await restart({ ...params, argv: { requirementsReport: true, dryRun: true } }, { check: async () => assert.fail('no check'), execute: async () => assert.fail('no restart') }), null);
});

test('the requirements report is experimental and off by default (issue #3469)', async () => {
  const { isRequirementsReportEnabled } = await import('../src/issue-completion.prompts.lib.mjs');
  assert.equal(isRequirementsReportEnabled({}, {}), false);
  assert.equal(isRequirementsReportEnabled({ requirementsReport: true }, {}), true);
  assert.equal(isRequirementsReportEnabled({ requirementsReport: false }, { HIVE_MIND_REQUIREMENTS_REPORT: 'true' }), false, 'the flag wins over the environment');
  for (const value of ['true', '1', 'yes', 'on']) assert.equal(isRequirementsReportEnabled({}, { HIVE_MIND_REQUIREMENTS_REPORT: value }), true, value);
  for (const value of ['', 'false', '0', 'off']) assert.equal(isRequirementsReportEnabled({}, { HIVE_MIND_REQUIREMENTS_REPORT: value }), false, value);
  // Links still guard the merge, but no report is read or required.
  const f = fixture();
  const result = await f.check({ requirementsReport: false });
  assert.equal(result.blocker, null);
  assert.equal(result.headSha, headSha);
  assert.ok(!f.calls.some(args => /\/reviews$/.test(args[1])), 'no review feedback is read for a report');
  const unlinked = fixture();
  unlinked.pr.body = 'No closing keyword.';
  assert.ok((await unlinked.check({ requirementsReport: false })).blocker, 'missing links still block');
  // No completion restart runs, and no GitHub read happens for it.
  const params = { ...context, issueUrl: 'u', branchName: 'b', tempDir: '/tmp/x', argv: {} };
  assert.equal(await runIssueCompletionUntilVerified(params, { check: async () => assert.fail('no check'), execute: async () => assert.fail('no restart'), sync: async () => assert.fail('no sync') }), null);
  // The solve option exists, is marked experimental and has no default, so the environment can enable it.
  const { SOLVE_OPTION_DEFINITIONS } = await import('../src/solve.config.lib.mjs');
  assert.match(SOLVE_OPTION_DEFINITIONS['requirements-report'].description, /^\[EXPERIMENTAL\].*Disabled by default/);
  assert.equal(SOLVE_OPTION_DEFINITIONS['requirements-report'].default, undefined);
});

test('the blocked-merge comment does not call an incomplete pull request ready', () => {
  const comment = buildAutoMergeBlockedComment({ blockers: [{ reason: 'incomplete_issue_requirements', message: 'Issue requirements have not been verified for this pull request.', details: ['link-assistant/agent#322: unfinished'], resolution: 'Finish.' }], issueNumber: 322 });
  assert.doesNotMatch(comment, /it is ready/);
  assert.doesNotMatch(comment, /Reopen issue #322/);
  assert.match(comment, /requirements report/);
  assert.match(comment, /incomplete_issue_requirements/);
});

test('every merge path uses the completion check and pins the merged commit', async () => {
  const read = name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
  const merge = await read('github-merge.lib.mjs');
  assert.match(merge, /checkIssueCompletionBeforeMerge\(/);
  assert.match(merge, /--match-head-commit \$\{/);
  assert.match(await read('solve.ensure-sub-issues.lib.mjs'), /checkIssueCompletionBeforeMerge\(/);
  const solve = await read('solve.mjs');
  const loop = solve.indexOf('runIssueCompletionUntilVerified(');
  assert.ok(loop > solve.indexOf('await runEnsureAllSubIssuesAddressed('), 'completion retries run after the closing references are repaired');
  assert.ok(loop < solve.indexOf('await attachLogAfterPostSolveRestarts('), 'and before the log is uploaded again');
});

test('the shared merge boundary refuses an unreported pull request and merges a reported one at its head', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'issue-2406-merge-test-'));
  try {
    const fixtureFile = join(directory, 'responses.json');
    const callsFile = join(directory, 'calls.jsonl');
    const ghFixture = new URL('../experiments/issue-2335/gh-fixture.mjs', import.meta.url);
    await chmod(ghFixture, 0o755);
    await symlink(fileURLToPath(ghFixture), join(directory, 'gh'));
    const f = fixture();
    const invoke = async (switchEnv = { HIVE_MIND_REQUIREMENTS_REPORT: 'true' }) => {
      await writeFile(fixtureFile, JSON.stringify(Object.fromEntries(f.responses)));
      await writeFile(callsFile, '');
      const moduleUrl = new URL('../src/github-merge.lib.mjs', import.meta.url).href;
      const code = `import { mergePullRequest } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(await mergePullRequest('link-assistant', 'agent', 326, {issueNumber:322})));`;
      const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, HIVE_MIND_REQUIREMENTS_REPORT: '', ...switchEnv, PATH: `${directory}:${process.env.PATH}`, ISSUE_2335_GH_FIXTURE: fixtureFile, ISSUE_2335_GH_CALLS: callsFile }, maxBuffer: 1024 * 1024 });
      const calls = (await readFile(callsFile, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line));
      return { result: JSON.parse(stdout.trim().split('\n').at(-1)), merge: calls.find(args => args[0] === 'pr' && args[1] === 'merge') };
    };
    // Issue #3469: off by default, a linked pull request merges without a report.
    const unreported = await invoke({});
    assert.equal(unreported.result.success, true);
    assert.equal(unreported.merge[unreported.merge.indexOf('--match-head-commit') + 1], headSha);
    const blocked = await invoke();
    assert.equal(blocked.result.success, false);
    assert.equal(blocked.result.category, 'incomplete_issue_requirements');
    assert.equal(blocked.merge, undefined);
    await f.report();
    const allowed = await invoke();
    assert.equal(allowed.result.success, true);
    assert.ok(allowed.merge.includes('--match-head-commit'));
    assert.equal(allowed.merge[allowed.merge.indexOf('--match-head-commit') + 1], headSha);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
