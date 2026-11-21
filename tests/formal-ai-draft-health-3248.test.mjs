#!/usr/bin/env node
/**
 * Issue #3248 health suggestion: 53 of 60 drafts failed for one known reason
 * (`File not found: …/e.g`) and the daily health job stayed green, because it
 * only counted attempts. It now fails when the same decision code or the same
 * first error repeats in consecutive runs, and names it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findRepeatedFailure, formatRepeatedFailureReport, normalizeErrorKey, REPEATED_FAILURE_THRESHOLD, runOutcomeFromAnnotations, trackingIssueSearchPhrase } from '../scripts/formal-ai-draft-health.lib.mjs';
import { DRAFT_DECISION_ANNOTATION_TITLE, DRAFT_FAILURE_ANNOTATION_TITLE } from '../scripts/formal-ai-draft.lib.mjs';

const E_G = suffix => `Agent reported error: Error: File not found: /tmp/gh-issue-solver-${suffix}/e.g`;
let nextId = 1;
const outcome = (overrides = {}) => {
  const id = nextId++;
  return { url: `https://github.com/link-assistant/hive-mind/actions/runs/${id}`, createdAt: new Date(Date.UTC(2026, 9, 7, 0, id)).toISOString(), status: 'completed', conclusion: 'failure', decisionCode: 'run', firstError: E_G(1791727879000 + id), ...overrides };
};

test('error keys ignore the parts that differ per run', () => {
  assert.equal(normalizeErrorKey(E_G('1791727879522')), normalizeErrorKey(E_G('1791800000000')));
  assert.equal(normalizeErrorKey(E_G('1791727879522')), 'Agent reported error: Error: File not found: /tmp/gh-issue-solver-…/e.g');
  assert.equal(normalizeErrorKey('session 12973819-edf2-46a1-9507-73725ece23dd failed at 0x7f3a9c00 after 123456 ms'), 'session … failed at … after … ms');
  assert.ok(normalizeErrorKey('x'.repeat(500)).length <= 200);
});

test('a run outcome is read from the annotations the draft job writes', () => {
  const run = { html_url: 'https://github.com/o/r/actions/runs/1', created_at: '2026-10-14T05:22:00Z', status: 'completed', conclusion: 'failure' };
  const annotations = [
    { annotation_level: 'notice', title: DRAFT_DECISION_ANNOTATION_TITLE, message: 'run' },
    { annotation_level: 'failure', title: DRAFT_FAILURE_ANNOTATION_TITLE, message: E_G('1') },
    { annotation_level: 'failure', title: '', message: 'Process completed with exit code 1.' },
  ];
  assert.deepEqual(runOutcomeFromAnnotations(run, annotations), { url: run.html_url, createdAt: run.created_at, status: 'completed', conclusion: 'failure', decisionCode: 'run', firstError: E_G('1') });
  assert.deepEqual(runOutcomeFromAnnotations(run, []), { url: run.html_url, createdAt: run.created_at, status: 'completed', conclusion: 'failure', decisionCode: null, firstError: null });
});

test('five consecutive runs failing with the same first error fail the health check, naming it', () => {
  assert.equal(REPEATED_FAILURE_THRESHOLD, 5);
  const outcomes = Array.from({ length: 5 }, () => outcome());
  const streak = findRepeatedFailure(outcomes);
  assert.equal(streak.count, 5);
  assert.equal(streak.key, 'Agent reported error: Error: File not found: /tmp/gh-issue-solver-…/e.g');
  assert.deepEqual(streak.runs, outcomes.map(entry => entry.url).reverse(), 'newest first');
  assert.equal(findRepeatedFailure(outcomes.slice(0, 4)), null, 'four is below the threshold');
});

test('a success, or a different error, ends the streak', () => {
  const failing = Array.from({ length: 6 }, () => outcome());
  assert.equal(findRepeatedFailure([...failing, outcome({ conclusion: 'success', firstError: null })]), null, 'the newest run succeeded');
  assert.equal(findRepeatedFailure([...failing, outcome({ firstError: 'docker exited 125' })]), null, 'the newest run failed differently');
  assert.equal(findRepeatedFailure([...failing.slice(0, 3), outcome({ conclusion: 'success' }), ...failing.slice(3)]), null);
});

test('skips the policy chose, cancelled runs and runs still in progress neither count nor break the streak', () => {
  const outcomes = [outcome(), outcome(), outcome({ conclusion: 'success', decisionCode: 'opt-out-label', firstError: null }), outcome(), outcome({ conclusion: 'cancelled', firstError: null }), outcome(), outcome(), outcome({ status: 'in_progress', conclusion: null, firstError: null })];
  const streak = findRepeatedFailure(outcomes);
  assert.equal(streak?.count, 5);
});

test('a repeated non-policy decision code is a failure even when the job is green', () => {
  const outcomes = Array.from({ length: 5 }, () => outcome({ conclusion: 'success', decisionCode: 'no-issue-in-event', firstError: null }));
  assert.equal(findRepeatedFailure(outcomes)?.key, 'decision_code no-issue-in-event');
});

test('failed runs with no recorded error still form a streak of their own', () => {
  const outcomes = Array.from({ length: 5 }, () => outcome({ firstError: null }));
  assert.equal(findRepeatedFailure(outcomes)?.key, 'failure with no recorded first error');
  assert.equal(findRepeatedFailure(outcomes, { threshold: 6 }), null);
});

test('the report names the failure and its tracking issue, or asks for one', () => {
  const streak = findRepeatedFailure(Array.from({ length: 5 }, () => outcome()));
  assert.equal(trackingIssueSearchPhrase(streak.key), 'Agent reported error: Error: File not found: /tmp/gh-issue-solver-');
  assert.equal(trackingIssueSearchPhrase('decision_code no-issue-in-event'), 'no-issue-in-event');
  const tracked = formatRepeatedFailureReport(streak, { number: 3248, title: 'Formal AI Draft workflow fails on every new issue', html_url: 'https://github.com/link-assistant/hive-mind/issues/3248' });
  assert.match(tracked, /The last 5 draft runs failed with the same first error/);
  assert.ok(tracked.includes(streak.key));
  assert.ok(tracked.includes('Tracking issue: #3248 Formal AI Draft workflow fails on every new issue (https://github.com/link-assistant/hive-mind/issues/3248)'), tracked);
  for (const url of streak.runs) assert.ok(tracked.includes(url));
  assert.match(formatRepeatedFailureReport(streak, null), /No open issue mentions it; open one/);
});
