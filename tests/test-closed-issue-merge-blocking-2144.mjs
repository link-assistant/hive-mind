#!/usr/bin/env node

/**
 * Unit Tests: Issue #2144 - a closed issue must not stop the automation
 *
 * Reproduces the reported incident: an open, mergeable pull request whose
 * linked issue had been closed made `--auto-restart-until-mergeable` stop on
 * its very first check, and it stopped without posting any GitHub comment.
 *
 * The expected behaviour verified here:
 *   1. A closed / inaccessible linked issue is NOT a terminal state — the loop
 *      keeps making the pull request mergeable, and the issue state is returned
 *      as a non-terminal `mergeBlockers` entry.
 *   2. Pull-request-scoped and repository-scoped states stay terminal.
 *   3. A merge blocker only holds back `--auto-merge`, and then the user is
 *      asked to reopen the issue or merge manually.
 *   4. Every stop path publishes the exact reason as a GitHub comment.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2144
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkGitHubTerminalState } from '../src/github-terminal-state.lib.mjs';
import { AUTOMATION_STOPPED_MARKER, AUTO_MERGE_BLOCKED_MARKER, STOP_REASONS, buildAutoMergeBlockedComment, buildAutomationStopComment, describeStopReason, reportAutomationStop } from '../src/automation-stop-reporting.lib.mjs';
import { TOOL_GENERATED_COMMENT_MARKERS } from '../src/tool-comments.lib.mjs';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

const test = async (description, fn) => {
  try {
    await fn();
    console.log(`  ${GREEN}✅ PASS:${RESET} ${description}`);
    passed++;
  } catch (error) {
    console.log(`  ${RED}❌ FAIL:${RESET} ${description}`);
    console.log(`      Error: ${error.message}`);
    failed++;
  }
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const out = value => ({
  toString: () => (typeof value === 'string' ? value : JSON.stringify(value)),
});

const commandText = (strings, values) => strings.reduce((acc, part, index) => `${acc}${part}${index < values.length ? String(values[index]) : ''}`, '');

function createRunner(responses) {
  const calls = [];
  const runner = async (strings, ...values) => {
    const command = commandText(strings, values);
    calls.push(command);
    const response = responses.find(entry => command.includes(entry.includes));
    if (!response) {
      throw new Error(`Unexpected command: ${command}`);
    }
    return {
      code: response.code ?? 0,
      stdout: out(response.stdout ?? ''),
      stderr: out(response.stderr ?? ''),
    };
  };
  runner.calls = calls;
  return runner;
}

const repoOk = { full_name: 'acme/widgets', default_branch: 'main' };

const openPr = {
  number: 7,
  state: 'open',
  merged: false,
  head: { ref: 'issue-3-fix', repo: { full_name: 'acme/widgets' } },
  base: { ref: 'main', repo: { full_name: 'acme/widgets' } },
};

const baseResponses = [
  { includes: 'repos/acme/widgets --jq', stdout: repoOk },
  { includes: 'repos/acme/widgets/pulls/7', stdout: openPr },
  { includes: 'repos/acme/widgets/branches/issue-3-fix', stdout: { name: 'issue-3-fix' } },
  { includes: 'repos/acme/widgets/branches/main', stdout: { name: 'main' } },
];

const checkState = runner =>
  checkGitHubTerminalState({
    owner: 'acme',
    repo: 'widgets',
    issueNumber: 3,
    prNumber: 7,
    commandRunner: runner,
  });

const root = join(import.meta.dirname, '..');
const readSrc = name => readFileSync(join(root, 'src', name), 'utf8');

console.log('================================================================================');
console.log('Unit Tests: Issue #2144 - closed issues do not block preparation to merge');
console.log('================================================================================\n');

// ---------------------------------------------------------------------------
// 1. Terminal state classification
// ---------------------------------------------------------------------------

await test('Closed linked issue is non-terminal and reported as a merge blocker', async () => {
  const runner = createRunner([...baseResponses, { includes: 'repos/acme/widgets/issues/3', stdout: { number: 3, state: 'closed' } }]);

  const result = await checkState(runner);

  assert(result.terminal === false, 'closed issue must not stop the loop');
  assert(result.reason === null, `no stop reason expected, got: ${result.reason}`);
  assert(result.mergeBlockers.length === 1, `expected 1 merge blocker, got ${result.mergeBlockers.length}`);
  assert(result.mergeBlockers[0].reason === 'issue_closed', `unexpected reason: ${result.mergeBlockers[0].reason}`);
  assert(result.data.issue.state === 'closed', 'issue data should be returned to the caller');
});

await test('Inaccessible linked issue is non-terminal and reported as a merge blocker', async () => {
  const runner = createRunner([...baseResponses, { includes: 'repos/acme/widgets/issues/3', code: 1, stderr: 'gh: Not Found (HTTP 404)' }]);

  const result = await checkState(runner);

  assert(result.terminal === false, 'deleted issue must not stop the loop');
  assert(result.mergeBlockers[0].reason === 'issue_unavailable', `unexpected reason: ${result.mergeBlockers[0].reason}`);
  assert(result.mergeBlockers[0].details.length > 0, 'blocker should carry the GitHub error as evidence');
  assert(/manually/i.test(result.mergeBlockers[0].resolution), 'blocker should offer merging manually');
});

await test('Open linked issue yields no merge blockers', async () => {
  const runner = createRunner([...baseResponses, { includes: 'repos/acme/widgets/issues/3', stdout: { number: 3, state: 'open' } }]);

  const result = await checkState(runner);

  assert(result.terminal === false, 'open issue is not terminal');
  assert(result.mergeBlockers.length === 0, 'open issue must not block auto-merge');
});

await test('Closed pull request stays terminal even with an open issue', async () => {
  const runner = createRunner([
    { includes: 'repos/acme/widgets --jq', stdout: repoOk },
    { includes: 'repos/acme/widgets/pulls/7', stdout: { ...openPr, state: 'closed', merged: false } },
  ]);

  const result = await checkState(runner);

  assert(result.terminal === true, 'a closed pull request is the real stopper condition');
  assert(result.reason === 'pull_request_closed', `unexpected reason: ${result.reason}`);
  assert(result.mergeBlockers.length === 0, 'terminal states carry no merge blockers');
});

await test('Merged pull request stays terminal and successful', async () => {
  const runner = createRunner([
    { includes: 'repos/acme/widgets --jq', stdout: repoOk },
    { includes: 'repos/acme/widgets/pulls/7', stdout: { ...openPr, state: 'closed', merged: true } },
  ]);

  const result = await checkState(runner);

  assert(result.terminal === true && result.success === true, 'a merged pull request stops the loop successfully');
  assert(result.reason === 'pull_request_merged', `unexpected reason: ${result.reason}`);
});

await test('Repository and branch losses stay terminal', async () => {
  const repoGone = await checkState(createRunner([{ includes: 'repos/acme/widgets', code: 1, stderr: 'gh: Not Found (HTTP 404)' }]));
  assert(repoGone.terminal === true && repoGone.reason === 'repository_unavailable', `unexpected: ${repoGone.reason}`);

  const branchGone = await checkState(
    createRunner([
      { includes: 'repos/acme/widgets --jq', stdout: repoOk },
      { includes: 'repos/acme/widgets/pulls/7', stdout: openPr },
      { includes: 'repos/acme/widgets/branches/issue-3-fix', code: 1, stderr: 'gh: Not Found (HTTP 404)' },
    ])
  );
  assert(branchGone.terminal === true && branchGone.reason === 'source_branch_unavailable', `unexpected: ${branchGone.reason}`);
});

await test('Issue check is skipped when the issue number equals the PR number', async () => {
  const runner = createRunner(baseResponses);
  const result = await checkGitHubTerminalState({ owner: 'acme', repo: 'widgets', issueNumber: 7, prNumber: 7, commandRunner: runner });

  assert(result.terminal === false, 'self-referencing numbers must not stop the loop');
  assert(result.mergeBlockers.length === 0, 'no blockers when there is no separate issue');
  assert(!runner.calls.some(call => call.includes('/issues/7')), 'the issue endpoint should not be queried');
});

// ---------------------------------------------------------------------------
// 2. Stop reason descriptions and comment bodies
// ---------------------------------------------------------------------------

await test('Every stop reason has a title, a detail and next steps', async () => {
  for (const [reason, entry] of Object.entries(STOP_REASONS)) {
    assert(typeof entry.title === 'string' && entry.title.length > 0, `${reason} needs a title`);
    assert(typeof entry.detail === 'string' && entry.detail.length > 0, `${reason} needs a detail`);
    assert(Array.isArray(entry.nextSteps) && entry.nextSteps.length > 0, `${reason} needs next steps`);
  }
});

await test('Unknown stop reasons still produce a reportable description', async () => {
  const description = describeStopReason('something_new');
  assert(description.known === false, 'unknown reasons should be flagged');
  assert(description.canComment === true, 'unknown reasons must still be reported');
  assert(description.title.includes('something_new'), 'the raw reason should survive into the title');
  assert(description.nextSteps.length > 0, 'unknown reasons still need next steps');
});

await test('Comment targets that are gone are not commented on', async () => {
  assert(describeStopReason('repository_unavailable').canComment === false, 'cannot comment on a deleted repository');
  assert(describeStopReason('pull_request_unavailable').canComment === false, 'cannot comment on a deleted pull request');
  assert(describeStopReason('pull_request_closed').canComment === true, 'a closed pull request can still be commented on');
});

await test('The stop comment states the mode, the reason and the next steps', async () => {
  const body = buildAutomationStopComment({
    reason: 'tool_failure',
    mode: 'auto-restart-until-mergeable',
    message: 'Claude exited with code 1',
    details: ['session 8cf80dad'],
  });

  assert(body.includes(AUTOMATION_STOPPED_MARKER), 'the comment must carry the tracking marker');
  assert(body.includes('`--auto-restart-until-mergeable`'), 'the comment must name the mode that stopped');
  assert(body.includes('`tool_failure`'), 'the comment must carry the machine-readable reason code');
  assert(body.includes('Claude exited with code 1'), 'the comment must include the concrete message');
  assert(body.includes('session 8cf80dad'), 'the comment must include the evidence details');
  assert(body.includes('What to do next'), 'the comment must tell the user what to do');
});

await test('The auto-merge blocked comment asks to reopen the issue or merge manually', async () => {
  const body = buildAutoMergeBlockedComment({
    blockers: [
      {
        reason: 'issue_closed',
        message: 'Issue #905 has been closed.',
        resolution: 'Reopen issue #905 so auto-merge can complete, or merge this pull request manually.',
      },
    ],
    issueNumber: 905,
  });

  assert(body.includes(AUTO_MERGE_BLOCKED_MARKER), 'the comment must carry the tracking marker');
  assert(body.includes('Issue #905 has been closed.'), 'the comment must state the blocker');
  assert(body.includes('`issue_closed`'), 'the comment must carry the machine-readable reason code');
  assert(/reopen issue #905/i.test(body), 'the comment must ask the user to reopen the issue');
  assert(/merge this pull request manually/i.test(body), 'the comment must offer a manual merge');
});

await test('Both markers are registered as tool-generated comments', async () => {
  assert(TOOL_GENERATED_COMMENT_MARKERS.includes(AUTOMATION_STOPPED_MARKER), 'stop comments must not count as AI-authored feedback');
  assert(TOOL_GENERATED_COMMENT_MARKERS.includes(AUTO_MERGE_BLOCKED_MARKER), 'auto-merge blocked comments must not count as AI-authored feedback');
});

// ---------------------------------------------------------------------------
// 3. reportAutomationStop behaviour
// ---------------------------------------------------------------------------

await test('reportAutomationStop skips targets that no longer exist', async () => {
  const result = await reportAutomationStop({
    $: () => {
      throw new Error('must not be called');
    },
    owner: 'acme',
    repo: 'widgets',
    targetNumber: 7,
    reason: 'repository_unavailable',
    mode: 'auto-merge',
  });

  assert(result.posted === false, 'nothing can be posted to a deleted repository');
  assert(result.skipped === 'target_unavailable', `unexpected skip reason: ${result.skipped}`);
});

await test('reportAutomationStop never throws when the comment API fails', async () => {
  const result = await reportAutomationStop({
    $: () => {
      throw new Error('gh exploded');
    },
    owner: 'acme',
    repo: 'widgets',
    targetNumber: 7,
    reason: 'tool_failure',
    mode: 'watch',
  });

  assert(result.posted === false, 'a failed post is reported, not thrown');
  assert(typeof result.error === 'string' && result.error.length > 0, 'the failure cause should be returned');
});

await test('reportAutomationStop does nothing without a comment target', async () => {
  const result = await reportAutomationStop({ $: null, owner: 'acme', repo: 'widgets', targetNumber: null, reason: 'tool_failure' });
  assert(result.posted === false && result.skipped === 'missing_target', `unexpected result: ${JSON.stringify(result)}`);
});

// ---------------------------------------------------------------------------
// 4. Wiring: every stop path reports, and the merge gate exists
// ---------------------------------------------------------------------------

await test('Auto-restart-until-mergeable reports every stop reason on GitHub', async () => {
  const src = readSrc('solve.auto-merge.lib.mjs');
  assert(src.includes("await import('./automation-stop-reporting.lib.mjs')"), 'the loop must load the stop reporter');

  for (const reason of ['auto_resume_limit_reached', 'tool_failure_after_resume', 'tool_failure', 'terminal_github_entity_error']) {
    assert(src.includes(reason), `the loop should handle ${reason}`);
  }

  const reportCalls = src.match(/reportAutomationStop\(/g) || [];
  assert(reportCalls.length >= 5, `expected every stop path to report, found ${reportCalls.length} calls`);
  assert(src.includes('issueMergeBlockers'), 'the loop must carry issue merge blockers instead of stopping');
  assert(src.includes('reportAutoMergeBlockedByIssue'), 'the loop must gate --auto-merge on issue merge blockers');
});

await test('The one-shot auto-merge attempt gates the merge on issue blockers', async () => {
  const src = readSrc('solve.auto-merge-attempt.lib.mjs');
  assert(src.includes('const issueMergeBlockers = terminalState.mergeBlockers'), 'blockers must be captured from the terminal state check');

  const gateIndex = src.indexOf('if (issueMergeBlockers.length > 0)');
  const mergeIndex = src.indexOf('await mergePullRequest(');
  assert(gateIndex > 0 && mergeIndex > gateIndex, 'the blocker gate must run before the merge call');
  assert(src.includes("reason: 'merge_failed'"), 'a rejected merge must be reported');
});

await test('Watch mode reports why it stopped', async () => {
  const src = readSrc('solve.watch.lib.mjs');
  assert(src.includes('reportAutomationStop'), 'watch mode must publish its stop reason');
  assert(src.includes('mergeBlockers'), 'watch mode must treat issue states as non-terminal blockers');
});

console.log('\n================================================================================');
console.log(`Results: ${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : ''}${failed} failed${RESET}`);
console.log('================================================================================');

if (failed > 0) {
  process.exit(1);
}
