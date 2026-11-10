#!/usr/bin/env node
// @hive-mind-test-suite default,pr-essential
/**
 * Issue #3248 item 6: make a draft's checks visible on its pull request.
 *
 * A pull request opened with the workflow `GITHUB_TOKEN` starts no
 * `pull_request` runs, so the draft workflow dispatches the checks on the head
 * branch instead. Those runs passed (e.g. 38517135151), but PR #3225 showed only
 * CodeQL: a `workflow_dispatch` run is not attached to any pull request. The
 * reporter mirrors each dispatched run as a commit status on the head SHA.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readFileSync } from 'node:fs';

import { allRunsCompleted, CHECK_STATUS_CONTEXT_PREFIX, commitStatusForRun, missingRunStatus, selectDispatchedRuns, statusKey, unfinishedRunStatus } from '../scripts/formal-ai-draft-checks.lib.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const WORKFLOWS = ['release.yml', 'security.yml'];
const run = (overrides = {}) => ({ id: 1, name: 'Checks and release', path: '.github/workflows/release.yml', head_sha: SHA, event: 'workflow_dispatch', status: 'completed', conclusion: 'success', created_at: '2026-10-14T05:40:00Z', html_url: 'https://github.com/link-assistant/hive-mind/actions/runs/38517135151', ...overrides });

test('the newest dispatched run of each checks workflow on the head SHA is selected', () => {
  const runs = [run({ id: 1, created_at: '2026-10-14T05:40:00Z', conclusion: 'failure' }), run({ id: 2, created_at: '2026-10-14T05:50:00Z' }), run({ id: 3, head_sha: 'f'.repeat(40) }), run({ id: 4, event: 'pull_request' }), run({ id: 5, name: 'Security', path: '.github/workflows/security.yml@refs/heads/issue-3215-x' }), run({ id: 6, name: 'Links', path: '.github/workflows/links.yml' })];
  const selected = selectDispatchedRuns(runs, { sha: SHA, workflows: WORKFLOWS });
  assert.deepEqual(
    selected.map(entry => [entry.workflow, entry.run?.id ?? null]),
    [
      ['release.yml', 2],
      ['security.yml', 5],
    ]
  );
  assert.deepEqual(
    selectDispatchedRuns([], { sha: SHA, workflows: WORKFLOWS }).map(entry => entry.run),
    [null, null]
  );
});

test('each run becomes a commit status that links it', () => {
  assert.equal(CHECK_STATUS_CONTEXT_PREFIX, 'dispatched');
  assert.deepEqual(commitStatusForRun({ workflow: 'release.yml', run: run() }), {
    state: 'success',
    context: 'dispatched / release.yml',
    description: 'Checks and release: success',
    target_url: 'https://github.com/link-assistant/hive-mind/actions/runs/38517135151',
  });
  assert.equal(commitStatusForRun({ workflow: 'release.yml', run: run({ status: 'in_progress', conclusion: null }) }).state, 'pending');
  assert.equal(commitStatusForRun({ workflow: 'release.yml', run: run({ status: 'queued', conclusion: null }) }).description, 'Checks and release: queued');
  for (const conclusion of ['failure', 'timed_out', 'startup_failure', 'action_required', 'stale']) assert.equal(commitStatusForRun({ workflow: 'release.yml', run: run({ conclusion }) }).state, 'failure', conclusion);
  for (const conclusion of ['neutral', 'skipped']) assert.equal(commitStatusForRun({ workflow: 'release.yml', run: run({ conclusion }) }).state, 'success', conclusion);
  assert.equal(commitStatusForRun({ workflow: 'release.yml', run: run({ conclusion: 'cancelled' }) }).state, 'error');
  assert.ok(commitStatusForRun({ workflow: 'release.yml', run: run({ name: 'x'.repeat(300) }) }).description.length <= 140, 'GitHub limits a status description to 140 characters');
});

test('a workflow that never produced a run is reported, not left pending forever', () => {
  assert.deepEqual(missingRunStatus('links.yml', 'no run appeared'), { state: 'error', context: 'dispatched / links.yml', description: 'no run appeared' });
});

test('the reporter stops once every selected run has completed', () => {
  assert.equal(allRunsCompleted(selectDispatchedRuns([run(), run({ id: 5, path: '.github/workflows/security.yml' })], { sha: SHA, workflows: WORKFLOWS })), true);
  assert.equal(allRunsCompleted(selectDispatchedRuns([run(), run({ id: 5, path: '.github/workflows/security.yml', status: 'in_progress', conclusion: null })], { sha: SHA, workflows: WORKFLOWS })), false);
  assert.equal(allRunsCompleted(selectDispatchedRuns([run()], { sha: SHA, workflows: WORKFLOWS })), false, 'a run that has not appeared yet is not complete');
});

test('a status is posted again only when it changes', () => {
  const pending = commitStatusForRun({ workflow: 'release.yml', run: run({ status: 'in_progress', conclusion: null }) });
  assert.equal(statusKey(pending), statusKey({ ...pending }));
  assert.notEqual(statusKey(pending), statusKey(commitStatusForRun({ workflow: 'release.yml', run: run() })));
});

// Issue #4029: release run 42614946918 finished green after 109 minutes, past
// the 80-minute deadline, and its draft head kept `pending` forever.
test('a run still unfinished at the deadline gets a terminal status, not pending forever', () => {
  const status = unfinishedRunStatus({ workflow: 'release.yml', run: run({ status: 'in_progress', conclusion: null }) }, 200);
  assert.deepEqual(status, { state: 'error', context: 'dispatched / release.yml', description: 'Checks and release: still in_progress after 200 min; open the run for its result', target_url: run().html_url });
  const script = readFileSync(new URL('../scripts/formal-ai-draft-checks.mjs', import.meta.url), 'utf8');
  assert.match(script, /run\.status !== 'completed'\) await post\(unfinishedRunStatus\(/u);
  assert.doesNotMatch(script, /until the next report/u);
});

test('the reporter follows dispatched runs longer than the slowest observed release run', () => {
  const workflow = readFileSync(new URL('../.github/workflows/formal-ai-draft.yml', import.meta.url), 'utf8');
  const job = workflow.slice(workflow.indexOf('\n  report-checks:'));
  const timeout = Number(/timeout-minutes: (\d+)/u.exec(job)[1]);
  const deadline = Number(/CHECKS_DEADLINE_MINUTES: '(\d+)'/u.exec(job)[1]);
  // Dispatched release runs took up to 137 minutes (run 39215011890).
  assert.ok(deadline >= 150, `deadline ${deadline} min`);
  // Setup and the final post must fit between the deadline and the job timeout.
  assert.ok(timeout >= deadline + 10, `timeout ${timeout} min, deadline ${deadline} min`);
});
