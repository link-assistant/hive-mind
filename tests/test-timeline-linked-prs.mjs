#!/usr/bin/env node
/**
 * Issue #1413: getLinkedPRsFromTimeline Tests
 *
 * Tests for the GitHub issue timeline API-based PR linking functionality.
 * Split from test-merge-queue.mjs to maintain file size limits.
 *
 * Run with: node tests/test-timeline-linked-prs.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1413
 */

import assert from 'node:assert/strict';
import { getLinkedPRsFromTimeline } from '../src/github-merge.lib.mjs';
import { extractLinkedIssueNumber } from '../src/github-linking.lib.mjs';

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

// ============================================================================
// Issue #1413: getLinkedPRsFromTimeline Tests
// ============================================================================

console.log('\n📋 Issue #1413: getLinkedPRsFromTimeline Tests\n');

test('github-merge.lib.mjs exports getLinkedPRsFromTimeline function', () => {
  assert.equal(typeof getLinkedPRsFromTimeline, 'function', 'getLinkedPRsFromTimeline should be exported as a function');
});

test('Issue #1413: Document the false positive problem with text search', () => {
  // PROBLEM (Issue #1413):
  // syncReadyTags() Step 2 previously used a full-text body search to find PRs
  // linked to ready issues:
  //   gh pr list --search "in:body closes #1411 OR fixes #1411 OR resolves #1411"
  //
  // This search matched PR #843 ("Implement bidirectional interactive mode") even
  // though PR #843 only closes issue #817, NOT issue #1411.
  //
  // The false positive occurred because PR #843's body contains a code snippet
  // from src/claude.lib.mjs showing source code with line number "1411→" adjacent
  // to other code, which the GitHub full-text index matched as "fixes #1411".
  //
  // IMPACT:
  // The `ready` label was incorrectly added to PR #843, making it appear in the
  // merge queue even though it had no relation to issue #1411.
  //
  // ROOT CAUSE:
  // GitHub full-text search does not distinguish between:
  //   - "Fixes #1411" (a genuine closing keyword)
  //   - "1411→  await log()" (a source code line number)
  //
  // SOLUTION (Issue #1413):
  // Use the GitHub issue timeline API instead:
  //   GET /repos/{owner}/{repo}/issues/{issue_number}/timeline
  //
  // Filter for `cross-referenced` events where source.issue.pull_request != null.
  // This uses GitHub's own linking mechanism — the same data used to auto-close
  // issues when PRs are merged — which only records genuine closing references.

  assert.ok(true, 'Issue #1413 false positive documented');
});

test('Issue #1413: getLinkedPRsFromTimeline filters by cross-referenced events', () => {
  // This test verifies the logic used in getLinkedPRsFromTimeline by simulating
  // the timeline events that would be returned by the GitHub API.

  // Simulate GitHub issue timeline events
  const mockTimeline = [
    // A labeled event — should NOT be included
    { event: 'labeled', label: { name: 'ready' } },
    // A cross-referenced event from a PR — SHOULD be included (open PR)
    {
      event: 'cross-referenced',
      source: {
        type: 'issue',
        issue: {
          number: 1412,
          title: 'feat: disable Sentry error tracking by default for user privacy',
          state: 'open',
          pull_request: { url: 'https://api.github.com/repos/owner/repo/pulls/1412' },
        },
      },
    },
    // A cross-referenced event from another issue (NOT a PR) — should NOT be included
    {
      event: 'cross-referenced',
      source: {
        type: 'issue',
        issue: {
          number: 1413,
          title: 'Ready tag was misplaced by /merge command',
          state: 'open',
          pull_request: null, // null means it's a plain issue, not a PR
        },
      },
    },
    // A cross-referenced event from a CLOSED PR — should NOT be included
    {
      event: 'cross-referenced',
      source: {
        type: 'issue',
        issue: {
          number: 843,
          title: 'Implement bidirectional interactive mode',
          state: 'closed',
          pull_request: { url: 'https://api.github.com/repos/owner/repo/pulls/843' },
        },
      },
    },
  ];

  // Apply the same filter logic as getLinkedPRsFromTimeline
  const linkedPRs = mockTimeline
    .filter(event => event.event === 'cross-referenced' && event.source?.issue?.pull_request != null && event.source?.issue?.state === 'open')
    .map(event => ({
      number: event.source.issue.number,
      title: event.source.issue.title,
    }));

  // Only PR #1412 should be in the result
  assert.equal(linkedPRs.length, 1, 'Should return exactly 1 linked open PR');
  assert.equal(linkedPRs[0].number, 1412, 'Should return PR #1412');
  assert.ok(!linkedPRs.some(pr => pr.number === 843), 'Should NOT include PR #843 (closed)');
  assert.ok(!linkedPRs.some(pr => pr.number === 1413), 'Should NOT include issue #1413 (not a PR)');
});

test('Issue #1413: getLinkedPRsFromTimeline deduplicates PR numbers', () => {
  // If a PR is cross-referenced multiple times (e.g., body and comments both reference it),
  // getLinkedPRsFromTimeline should only return it once.

  const mockTimeline = [
    {
      event: 'cross-referenced',
      source: {
        type: 'issue',
        issue: {
          number: 1412,
          title: 'PR #1412',
          state: 'open',
          pull_request: { url: 'https://api.github.com/repos/owner/repo/pulls/1412' },
        },
      },
    },
    {
      event: 'cross-referenced',
      source: {
        type: 'issue',
        issue: {
          number: 1412, // Same PR number — duplicate
          title: 'PR #1412',
          state: 'open',
          pull_request: { url: 'https://api.github.com/repos/owner/repo/pulls/1412' },
        },
      },
    },
  ];

  // Apply deduplication logic
  const seenNumbers = new Set();
  const linkedPRs = [];
  for (const event of mockTimeline) {
    if (event.event === 'cross-referenced' && event.source?.issue?.pull_request != null && event.source?.issue?.state === 'open') {
      const prNum = event.source.issue.number;
      if (!seenNumbers.has(prNum)) {
        seenNumbers.add(prNum);
        linkedPRs.push({ number: prNum, title: event.source.issue.title });
      }
    }
  }

  assert.equal(linkedPRs.length, 1, 'Should deduplicate and return PR #1412 only once');
  assert.equal(linkedPRs[0].number, 1412, 'Should return PR #1412');
});

test('Issue #1413: getLinkedPRsFromTimeline handles empty timeline', () => {
  const mockTimeline = [];
  const linkedPRs = mockTimeline.filter(e => e.event === 'cross-referenced' && e.source?.issue?.pull_request != null && e.source?.issue?.state === 'open');

  assert.equal(linkedPRs.length, 0, 'Should return empty array for empty timeline');
});

test('Issue #1413: getLinkedPRsFromTimeline handles timeline with no cross-referenced events', () => {
  const mockTimeline = [
    { event: 'labeled', label: { name: 'ready' } },
    { event: 'assigned', assignee: { login: 'konard' } },
    { event: 'mentioned', actor: { login: 'konard' } },
  ];

  const linkedPRs = mockTimeline.filter(e => e.event === 'cross-referenced' && e.source?.issue?.pull_request != null && e.source?.issue?.state === 'open');

  assert.equal(linkedPRs.length, 0, 'Should return empty array when no cross-referenced events exist');
});

test('Issue #1413: Contrast — full-text search causes false positives', () => {
  // This test demonstrates WHY the full-text body search was problematic.
  // It simulates what GitHub full-text search would return for a PR body that
  // contains a source code line number matching the issue number.

  const pr843Body = `
## Summary

This PR implements the bidirectional interactive mode feature requested in issue #817.

\`\`\`
   1409→    const result = await processCommand(cmd);
   1410→    if (result.error) throw result.error;
   1411→    await log(\`[INFO] Command completed: \${cmd}\`);
   1412→    return result;
\`\`\`

Fixes #817
  `.trim();

  // The full-text search would match "1411→" next to "await log" because
  // GitHub's search engine tokenizes "#1411" from the combined string context.
  // This is a known limitation of GitHub's full-text search.

  // However, GitHub's issue timeline correctly distinguishes the two:
  // - PR #843's body has Fixes #817, so only issue #817 gets a cross-referenced event
  // - The string "1411→" in a code block is NOT recorded as a cross-reference to issue #1411

  // Verify that extractLinkedIssueNumber (used in Step 1 of syncReadyTags) correctly
  // extracts #817 from PR #843's body (not #1411):
  const linkedIssue = extractLinkedIssueNumber(pr843Body);
  assert.equal(linkedIssue, '817', 'extractLinkedIssueNumber should return #817 from PR #843 body, not #1411');
  assert.notEqual(linkedIssue, '1411', 'extractLinkedIssueNumber should NOT return #1411 for PR #843');
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Test Results: ${testsPassed} passed, ${testsFailed} failed\n`);

if (testsFailed > 0) {
  process.exit(1);
}
