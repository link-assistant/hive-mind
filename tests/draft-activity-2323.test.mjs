/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessDraftActivity } from '../scripts/draft-activity.lib.mjs';

const since = '2026-09-23T00:00:00Z';
const issue = { number: 1, created_at: '2026-09-28T00:00:00Z', user: { type: 'User' }, labels: [] };
const run = { id: 2, created_at: '2026-09-28T00:01:00Z', html_url: 'https://github.com/o/r/actions/runs/2', conclusion: 'success' };
const jobs = conclusion => [{ steps: [{ name: 'Open the Formal AI draft', status: 'completed', conclusion }] }];

test('a green run whose attempt was skipped fails the no-silent-state monitor', () => {
  const report = assessDraftActivity({ issues: [issue], runs: [run], jobsByRun: { 2: jobs('skipped') }, since });
  assert.equal(report.executed.length, 0);
  assert.equal(report.ok, false);
});
test('a failed model attempt is an executed draft, and its URL is reported', () => {
  const report = assessDraftActivity({ issues: [issue], runs: [run], jobsByRun: { 2: jobs('failure') }, since });
  assert.equal(report.ok, true);
  assert.equal(report.executed[0].html_url, run.html_url);
});
test('a step cancelled before it starts is not an executed model attempt', () => {
  assert.equal(assessDraftActivity({ issues: [issue], runs: [run], jobsByRun: { 2: jobs('cancelled') }, since }).ok, false);
  const started = [{ steps: [{ name: 'Open the Formal AI draft', status: 'completed', conclusion: 'cancelled', started_at: '2026-09-28T00:01:00Z' }] }];
  assert.equal(assessDraftActivity({ issues: [issue], runs: [run], jobsByRun: { 2: started }, since }).ok, true);
});
test('old runs cannot hide recent inactivity and opt-out/bot/PR issues do not require drafts', () => {
  assert.equal(assessDraftActivity({ issues: [issue], runs: [{ ...run, created_at: '2026-09-01T00:00:00Z' }], jobsByRun: { 2: jobs('success') }, since }).ok, false);
  const issues = [
    { ...issue, pull_request: {} },
    { ...issue, user: { type: 'Bot' } },
    { ...issue, labels: [{ name: 'no-formal-ai-draft' }] },
  ];
  assert.equal(assessDraftActivity({ issues, runs: [], jobsByRun: {}, since }).ok, true);
});
