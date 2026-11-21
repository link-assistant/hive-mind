#!/usr/bin/env node
/**
 * Issue #4055: twelve Formal AI drafts in a row failed because the release
 * image was never published, first as `…:2.40.0`, then as `…:2.40.1`. The
 * daily health check stayed green: the version was part of the error key, so
 * the newest streak was three runs (2.40.1) and the threshold is five.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findRepeatedFailure, normalizeErrorKey, trackingIssueSearchPhrase } from '../scripts/formal-ai-draft-health.lib.mjs';

const unavailable = version => `[DRAFT_IMAGE_UNAVAILABLE] Could not pull konard/hive-mind:${version} after 1 attempt: Error response from daemon: manifest for konard/hive-mind:${version} not found: manifest unknown: manifest unknown`;
// Run ids and versions copied from the real draft runs (newest first), see dev/log/issues/4055/pulls/4056.
const recorded = [
  [43410453638, '2026-11-13T10:37:05Z', '2.40.1'],
  [43386885069, '2026-11-13T07:35:51Z', '2.40.1'],
  [43274283479, '2026-11-12T17:54:17Z', '2.40.1'],
  [43211868523, '2026-11-12T11:45:24Z', '2.40.0'],
  [43183538810, '2026-11-12T08:30:43Z', '2.40.0'],
  [43089189750, '2026-11-11T19:39:12Z', '2.40.0'],
];
const outcomes = recorded.map(([id, createdAt, version]) => ({ url: `https://github.com/link-assistant/hive-mind/actions/runs/${id}`, createdAt, status: 'completed', conclusion: 'failure', decisionCode: 'run', firstError: unavailable(version) }));

test('a release version in the error does not split a streak', () => {
  assert.equal(normalizeErrorKey(unavailable('2.40.0')), normalizeErrorKey(unavailable('2.40.1')));
  assert.equal(normalizeErrorKey(unavailable('2.40.1')), '[DRAFT_IMAGE_UNAVAILABLE] Could not pull konard/hive-mind:… after 1 attempt: Error response from daemon: manifest for konard/hive-mind:… not found: manifest unknown: manifest unknown');
  assert.equal(normalizeErrorKey('needs node v20.11.1-rc.2 or newer'), 'needs node … or newer');
  assert.equal(normalizeErrorKey('after 1 attempt'), 'after 1 attempt', 'a lone small number is kept');
});

test('the 2.40.0 → 2.40.1 image failures fail the health check', () => {
  const streak = findRepeatedFailure(outcomes);
  assert.ok(streak, 'six consecutive DRAFT_IMAGE_UNAVAILABLE failures are a streak');
  assert.equal(streak.count, 6);
  assert.deepEqual(
    streak.runs,
    outcomes.map(entry => entry.url)
  );
});

test('an error that starts with a code is tracked by that code', () => {
  assert.equal(trackingIssueSearchPhrase(normalizeErrorKey(unavailable('2.40.1'))), 'DRAFT_IMAGE_UNAVAILABLE');
});
