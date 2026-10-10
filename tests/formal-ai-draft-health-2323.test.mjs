#!/usr/bin/env node
/** Issue #2323 R6: green draft runs whose model step never ran must not hide inactivity. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DRAFT_STEP, eligibleIssues, evaluateDraftHealth, isExecutedAttempt } from '../scripts/formal-ai-draft-health.lib.mjs';

const since = '2026-09-26T00:00:00Z';
const issue = (number, overrides = {}) => ({ number, created_at: '2026-09-27T00:00:00Z', user: { type: 'User', login: 'human' }, labels: [], ...overrides });
const job = (step = {}) => [{ steps: [{ name: DRAFT_STEP, started_at: '2026-09-27T00:01:00Z', conclusion: 'success', ...step }] }];

test('only issues the workflow would attempt during the window are eligible', () => {
  const issues = [
    issue(1),
    issue(2, { created_at: '2026-09-20T00:00:00Z' }),
    issue(3, { pull_request: {} }),
    issue(4, { user: { type: 'Bot', login: 'bot' } }),
    issue(5, { labels: [{ name: 'no-formal-ai-draft' }] }),
    // A completed draft adds this label afterwards; the issue was still eligible when opened.
    issue(6, { labels: [{ name: 'formal-ai-draft' }] }),
  ];
  assert.deepEqual(
    eligibleIssues(issues, since).map(entry => entry.number),
    [1, 6]
  );
});

test('a run counts only when the draft step actually started', () => {
  assert.equal(isExecutedAttempt({ event: 'issues' }, job()), true);
  assert.equal(isExecutedAttempt({ event: 'workflow_dispatch' }, job({ conclusion: 'failure' })), true, 'a failed session is still an executed attempt');
  assert.equal(isExecutedAttempt({ event: 'issues' }, job({ conclusion: 'skipped' })), false, 'the former no-draft-token skip was green but executed nothing');
  assert.equal(isExecutedAttempt({ event: 'issues' }, job({ started_at: null })), false);
  assert.equal(isExecutedAttempt({ event: 'schedule' }, job()), false, 'the health job itself is not a draft attempt');
  assert.equal(isExecutedAttempt({ event: 'issues' }, [{ steps: [{ name: 'Decide whether to attempt a draft', started_at: 'x', conclusion: 'success' }] }]), false);
});

test('eligible issues without any executed attempt fail the check', () => {
  assert.equal(evaluateDraftHealth({ eligible: 25, attempts: 0 }).healthy, false);
  assert.match(evaluateDraftHealth({ eligible: 25, attempts: 0 }).report, /25 eligible issues, 0 executed attempts/);
  assert.equal(evaluateDraftHealth({ eligible: 25, attempts: 1 }).healthy, true);
  assert.equal(evaluateDraftHealth({ eligible: 0, attempts: 0 }).healthy, true, 'a quiet week is not a failure');
});
