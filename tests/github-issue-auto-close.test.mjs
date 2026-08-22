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
import { gitHubAutoClosesOnMerge, classifyIssueLinkStatus, buildNonDefaultBranchExplanation, ensureLinkedIssueClosedAfterMerge } from '../src/github-issue-auto-close.lib.mjs';

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
// ensureLinkedIssueClosedAfterMerge (with a fake $ exec)
// ---------------------------------------------------------------------------
console.log('\n📋 ensureLinkedIssueClosedAfterMerge\n');

// Build a fake command-stream `$` that matches commands to canned responses.
function makeFake$(responder) {
  return (strings, ...values) => {
    // Reconstruct the command for matching.
    let cmd = '';
    strings.forEach((s, i) => {
      cmd += s;
      if (i < values.length) cmd += String(values[i]);
    });
    return Promise.resolve(responder(cmd.trim()));
  };
}

const ok = stdout => ({ code: 0, stdout, stderr: '' });

test('closes the issue when PR targeted a non-default branch', async () => {
  const calls = [];
  const $ = makeFake$(cmd => {
    calls.push(cmd);
    if (cmd.startsWith('gh pr view')) return ok(JSON.stringify({ baseRefName: 'issue-47', body: 'Fixes #49', title: 'x' }));
    if (cmd.startsWith('gh api repos/')) return ok('main');
    if (cmd.startsWith('gh issue view')) return ok(JSON.stringify({ state: 'OPEN', stateReason: '' }));
    if (cmd.startsWith('gh issue close')) return ok('');
    return ok('');
  });

  const result = await ensureLinkedIssueClosedAfterMerge({ $, owner: 'o', repo: 'r', prNumber: 65, issueNumber: 49 });
  assert.equal(result.closed, true);
  assert.equal(result.reason, 'closed-explicitly');
  assert.ok(calls.some(c => c.startsWith('gh issue close 49')));
});

test('skips when PR merged into the default branch (GitHub handles it)', async () => {
  const $ = makeFake$(cmd => {
    if (cmd.startsWith('gh pr view')) return ok(JSON.stringify({ baseRefName: 'main', body: 'Fixes #49', title: 'x' }));
    if (cmd.startsWith('gh api repos/')) return ok('main');
    return ok('');
  });
  const result = await ensureLinkedIssueClosedAfterMerge({ $, owner: 'o', repo: 'r', prNumber: 65, issueNumber: 49 });
  assert.equal(result.closed, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'github-auto-closes');
});

test('skips when the issue is already closed', async () => {
  const $ = makeFake$(cmd => {
    if (cmd.startsWith('gh pr view')) return ok(JSON.stringify({ baseRefName: 'feature', body: 'Fixes #49', title: 'x' }));
    if (cmd.startsWith('gh api repos/')) return ok('main');
    if (cmd.startsWith('gh issue view')) return ok(JSON.stringify({ state: 'CLOSED' }));
    return ok('');
  });
  const result = await ensureLinkedIssueClosedAfterMerge({ $, owner: 'o', repo: 'r', prNumber: 65, issueNumber: 49 });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'already-closed');
});

test('skips when PR has no closing keyword', async () => {
  const $ = makeFake$(cmd => {
    if (cmd.startsWith('gh pr view')) return ok(JSON.stringify({ baseRefName: 'feature', body: 'References #49 only', title: 'x' }));
    if (cmd.startsWith('gh api repos/')) return ok('main');
    return ok('');
  });
  const result = await ensureLinkedIssueClosedAfterMerge({ $, owner: 'o', repo: 'r', prNumber: 65, issueNumber: 49 });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'no-closing-keyword');
});

test('derives the issue number from the PR body when not provided', async () => {
  const $ = makeFake$(cmd => {
    if (cmd.startsWith('gh pr view')) return ok(JSON.stringify({ baseRefName: 'feature', body: 'Closes #50', title: 'x' }));
    if (cmd.startsWith('gh api repos/')) return ok('main');
    if (cmd.startsWith('gh issue view')) return ok(JSON.stringify({ state: 'OPEN' }));
    if (cmd.startsWith('gh issue close')) return ok('');
    return ok('');
  });
  const result = await ensureLinkedIssueClosedAfterMerge({ $, owner: 'o', repo: 'r', prNumber: 66 });
  assert.equal(result.closed, true);
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
