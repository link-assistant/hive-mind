#!/usr/bin/env node
/**
 * Tests for the issue auto-close diagnosis & fallback library.
 *
 * Reproduces the root cause of issue #1895: a PR with a valid closing keyword
 * (e.g. "Fixes #49") that targets a NON-default branch is not registered by
 * GitHub as a closing reference and its issue is not auto-closed on merge.
 *
 * Run with: node tests/github-issue-auto-close.test.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1895
 */

import assert from 'node:assert/strict';
import { gitHubAutoClosesOnMerge, classifyIssueLinkStatus, buildNonDefaultBranchExplanation } from '../src/github-issue-auto-close.lib.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`✅ ${name}`);
      passed++;
    })
    .catch(error => {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${error.message}`);
      failed++;
    });
}

// ---------------------------------------------------------------------------
// gitHubAutoClosesOnMerge
// ---------------------------------------------------------------------------
console.log('\n📋 gitHubAutoClosesOnMerge\n');

test('returns true when PR targets the default branch', () => {
  assert.equal(gitHubAutoClosesOnMerge('main', 'main'), true);
  assert.equal(gitHubAutoClosesOnMerge('master', 'master'), true);
});

test('returns false when PR targets a non-default branch (the #1895 case)', () => {
  assert.equal(gitHubAutoClosesOnMerge('issue-47-76af108c0f24', 'main'), false);
});

test('returns null when branch info is unknown', () => {
  assert.equal(gitHubAutoClosesOnMerge(null, 'main'), null);
  assert.equal(gitHubAutoClosesOnMerge('main', null), null);
  assert.equal(gitHubAutoClosesOnMerge(undefined, undefined), null);
});

// ---------------------------------------------------------------------------
// classifyIssueLinkStatus
// ---------------------------------------------------------------------------
console.log('\n📋 classifyIssueLinkStatus\n');

test('non-default base + keyword present → requires manual close (#1895)', () => {
  const status = classifyIssueLinkStatus({
    prBody: 'Fixes #49.',
    issueNumber: 49,
    baseBranch: 'issue-47-76af108c0f24',
    defaultBranch: 'main',
    githubLinked: false,
  });
  assert.equal(status.hasClosingKeyword, true);
  assert.equal(status.autoCloses, false);
  assert.equal(status.targetsNonDefaultBranch, true);
  assert.equal(status.requiresManualClose, true);
  assert.equal(status.reason, 'non-default-base-branch');
});

test('default base + keyword present, not yet linked → link pending (not manual)', () => {
  const status = classifyIssueLinkStatus({
    prBody: 'Closes #50',
    issueNumber: 50,
    baseBranch: 'main',
    defaultBranch: 'main',
    githubLinked: false,
  });
  assert.equal(status.hasClosingKeyword, true);
  assert.equal(status.requiresManualClose, false);
  assert.equal(status.reason, 'keyword-present-link-pending');
});

test('no keyword in body → missing-keyword (historical advice applies)', () => {
  const status = classifyIssueLinkStatus({
    prBody: 'This references #50 but does not close it.',
    issueNumber: 50,
    baseBranch: 'issue-47',
    defaultBranch: 'main',
    githubLinked: false,
  });
  assert.equal(status.hasClosingKeyword, false);
  assert.equal(status.requiresManualClose, false);
  assert.equal(status.reason, 'missing-keyword');
});

test('already github-linked → reason github-linked, no manual close', () => {
  const status = classifyIssueLinkStatus({
    prBody: 'Fixes #50',
    issueNumber: 50,
    baseBranch: 'main',
    defaultBranch: 'main',
    githubLinked: true,
  });
  assert.equal(status.reason, 'github-linked');
  assert.equal(status.requiresManualClose, false);
});

test('cross-repo (fork) keyword detected', () => {
  const status = classifyIssueLinkStatus({
    prBody: 'Fixes owner/repo#49',
    issueNumber: 49,
    owner: 'owner',
    repo: 'repo',
    baseBranch: 'feature',
    defaultBranch: 'main',
  });
  assert.equal(status.hasClosingKeyword, true);
  assert.equal(status.reason, 'non-default-base-branch');
});

// ---------------------------------------------------------------------------
// buildNonDefaultBranchExplanation
// ---------------------------------------------------------------------------
console.log('\n📋 buildNonDefaultBranchExplanation\n');

test('explanation names the branches and the issue', () => {
  const lines = buildNonDefaultBranchExplanation({ issueNumber: 49, baseBranch: 'issue-47', defaultBranch: 'main' });
  const text = lines.join('\n');
  assert.match(text, /issue-47/);
  assert.match(text, /main/);
  assert.match(text, /#49/);
  assert.match(text, /not be closed automatically/i);
});

// ---------------------------------------------------------------------------
// Issue #3357: the post-merge close moved to post-merge-issue-closing.lib.mjs,
// one implementation for every merge path (tests/post-merge-issue-closing-3355
// and tests/unified-issue-closing-3357 cover it).
// ---------------------------------------------------------------------------
test('the per-path post-merge close helper is gone', async () => {
  const autoClose = await import('../src/github-issue-auto-close.lib.mjs');
  assert.equal(autoClose.ensureLinkedIssueClosedAfterMerge, undefined);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
process.on('exit', () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Tests passed: ${passed}`);
  console.log(`Tests failed: ${failed}`);
  console.log('='.repeat(50));
  if (failed > 0) process.exitCode = 1;
});
