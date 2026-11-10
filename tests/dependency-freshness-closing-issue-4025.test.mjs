#!/usr/bin/env node
/**
 * A freshness exception must not link an issue its own pull request closes
 * (issue #4025).
 *
 * PR #3786 ("Fixes #3785") pinned Codex, Qwen Code, Gemini CLI and OpenCode
 * with exceptions linking #3785. The merge closed #3785, the 12 exceptions
 * became "Exception issue is closed or invalid", and `detect-changes` failed on
 * every later pull request (Checks and release run 42611647973). The gate now
 * rejects such an exception while the pull request is still open.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';

import { checkDependencyRecords, issuesClosedBy } from '../scripts/dependency-freshness.lib.mjs';

const repo = 'link-assistant/hive-mind';
const url = number => `https://github.com/${repo}/issues/${number}`;

// GitHub's closing keywords, in the forms solver and human PR bodies use.
assert.deepEqual([...issuesClosedBy('### Issue Reference\nFixes #3785', repo)], [url(3785)]);
assert.deepEqual([...issuesClosedBy('Closes: https://github.com/Link-Assistant/Hive-Mind/issues/12', repo)], [url(12)]);
assert.deepEqual([...issuesClosedBy('resolved link-assistant/hive-mind#7 and fixes other/repo#8', repo)].sort(), [url(7), 'https://github.com/other/repo/issues/8'].sort());
assert.equal(issuesClosedBy('Refs #3785, see #12; does not fix anything', repo).size, 0, 'plain references close nothing');
assert.equal(issuesClosedBy(null, repo).size, 0, 'a push or an empty body closes nothing');

const pin = exception => ({ kind: 'unpinned-for-test', name: '@openai/codex', current: '0.164.0', location: 'Dockerfile:254', exception });
const openIssue = async () => true;

let result = await checkDependencyRecords([pin(url(3785))], { resolveOpenIssue: openIssue, closingIssues: issuesClosedBy('Fixes #3785', repo) });
assert.equal(result.exceptions.length, 0);
assert.match(result.errors[0]?.error ?? '', /closes when this pull request merges: https:\/\/github\.com\/link-assistant\/hive-mind\/issues\/3785\. Link a separate open tracking issue/);

result = await checkDependencyRecords([pin(url(4027))], { resolveOpenIssue: openIssue, closingIssues: issuesClosedBy('Fixes #3785', repo) });
assert.equal(result.errors.length, 0, 'a separate tracking issue is accepted');
assert.equal(result.exceptions.length, 1);

result = await checkDependencyRecords([pin(url(3785))], { resolveOpenIssue: openIssue });
assert.equal(result.errors.length, 0, 'without a pull request body only the open-issue check applies');

console.log('dependency-freshness-closing-issue-4025.test.mjs: all assertions passed');
