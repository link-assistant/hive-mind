#!/usr/bin/env node
/**
 * Issue #4055: Dependabot group pull request #2285 stayed open from 2026-09-22
 * to 2026-11-13. Each daily job deferred to it and passed, so no newer update
 * was proposed for 52 days and nothing turned red.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { findStuckDependabotPullRequests, formatStuckReport } from '../scripts/dependabot-health.lib.mjs';

const banner = '[//]: # (dependabot-start)\n⚠️  **Dependabot is rebasing this PR** ⚠️ \n\n[//]: # (dependabot-end)\n\n';
const now = Date.parse('2026-11-13T19:00:00Z');
const pull = overrides => ({ number: 2285, state: 'open', html_url: 'https://github.com/link-assistant/hive-mind/pull/2285', title: 'Bump the "all-dependencies" group with 1 update across multiple ecosystems', user: { login: 'dependabot[bot]' }, created_at: '2026-09-22T14:37:56Z', body: banner.repeat(37) + 'Bumps @sentry/node.', ...overrides });

test('the recorded pull request #2285 is reported with both symptoms', () => {
  const [stuck, ...rest] = findStuckDependabotPullRequests([pull()], { now });
  assert.equal(rest.length, 0);
  assert.equal(stuck.number, 2285);
  assert.deepEqual(stuck.reasons, ['open for 52 days (limit 14)', '37 unfinished "Dependabot is rebasing this PR" banners']);
  assert.match(formatStuckReport([stuck]), /dependabot-core#16791[\s\S]*close it/);
});

test('a fresh pull request, a single rebase and other authors pass', () => {
  assert.deepEqual(findStuckDependabotPullRequests([pull({ created_at: '2026-11-10T14:00:00Z', body: banner })], { now }), []);
  assert.deepEqual(findStuckDependabotPullRequests([pull({ user: { login: 'konard' } })], { now }), []);
  assert.deepEqual(findStuckDependabotPullRequests([pull({ state: 'closed' })], { now }), []);
});

test('a young pull request that never finishes rebasing is reported', () => {
  const [stuck] = findStuckDependabotPullRequests([pull({ created_at: '2026-11-11T14:00:00Z', body: banner.repeat(3) })], { now });
  assert.deepEqual(stuck.reasons, ['3 unfinished "Dependabot is rebasing this PR" banners']);
});

test('a daily workflow runs the check with read-only access', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/dependabot-health.yml', import.meta.url), 'utf8');
  assert.match(workflow, /schedule:\s*\n\s*- cron:/);
  assert.match(workflow, /pull-requests: read/);
  assert.doesNotMatch(workflow, /: write/);
  assert.match(workflow, /node scripts\/dependabot-health\.mjs/);
});
