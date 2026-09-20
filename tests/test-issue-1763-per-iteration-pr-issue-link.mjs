#!/usr/bin/env node

/**
 * Regression tests for issue #1763.
 *
 * If the AI agent rewrites the PR body during a watch / auto-restart-until-mergeable
 * / finalize iteration without including a GitHub closing keyword, the link from PR
 * to issue is silently lost. The verifyResults end-of-run check is too late: any
 * iteration may end up being the last one (interrupt, billing limit, max-iters cap,
 * mergeable, …) and skip the final verification entirely.
 *
 * The fix is to call ensurePullRequestIssueLink after every successful iteration
 * inside each iteration loop. These tests pin that behaviour at the source level
 * so future refactors don't silently drop the call again.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1763
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { ensureIssueLinkInPullRequestBody } from '../src/pr-issue-linking.lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`PASS: ${testName}`);
    testsPassed++;
  } else {
    console.log(`FAIL: ${testName}`);
    if (details) {
      console.log(`   Details: ${details}`);
    }
    testsFailed++;
  }
}

console.log('Testing issue #1763 per-iteration PR ↔ issue link verification');
console.log('='.repeat(70));

async function readSource(relPath) {
  return await fs.readFile(path.join(repoRoot, relPath), 'utf8');
}

// Source-level pin: each iteration loop must import and invoke
// ensurePullRequestIssueLink, so that an iteration that turns out to be the
// last one still restores the closing keyword the AI may have stripped from
// the PR body.
const iterationSites = [
  {
    file: 'src/solve.watch.lib.mjs',
    description: 'watch / temporary-watch iteration loop',
    iterationContextMarker: 'Resuming watch mode',
  },
  {
    file: 'src/solve.auto-merge.lib.mjs',
    description: 'auto-restart-until-mergeable iteration loop',
    iterationContextMarker: 'Checking if PR is now mergeable',
  },
  {
    file: 'src/solve.auto-ensure.lib.mjs',
    description: 'finalize requirements-check iteration loop',
    iterationContextMarker: 'FINALIZE iteration',
  },
];

for (const site of iterationSites) {
  const source = await readSource(site.file);

  assert(source.includes('ensurePullRequestIssueLink'), `${site.file} imports/uses ensurePullRequestIssueLink`, 'The per-iteration link verification helper must be wired in.');

  assert(source.includes('await ensurePullRequestIssueLink({'), `${site.file} calls ensurePullRequestIssueLink in the iteration loop`);

  // Sanity check that the call lives near the iteration completion boundary,
  // not just in an unrelated import block. We search for the iteration
  // context marker that occurs nearest to (and after) the call so refactors
  // that move surrounding strings around don't trip the test spuriously.
  const callIndex = source.indexOf('await ensurePullRequestIssueLink({');
  let nearestMarkerDistance = Infinity;
  let searchFrom = 0;
  while (true) {
    const markerIndex = source.indexOf(site.iterationContextMarker, searchFrom);
    if (markerIndex === -1) break;
    const distance = Math.abs(callIndex - markerIndex);
    if (distance < nearestMarkerDistance) {
      nearestMarkerDistance = distance;
    }
    searchFrom = markerIndex + 1;
  }
  assert(callIndex !== -1 && nearestMarkerDistance < 2000, `${site.file} invokes ensurePullRequestIssueLink near the ${site.description}`, `callIndex=${callIndex}, nearestMarkerDistance=${nearestMarkerDistance}`);

  // Defensive wrapping: the call must be inside a try/catch so a transient
  // gh failure cannot break the iteration loop.
  const callSnippet = source.slice(Math.max(0, callIndex - 400), callIndex);
  assert(/try\s*\{[^}]*$/m.test(callSnippet) || callSnippet.includes('try {'), `${site.file} wraps the call in try/catch so transient failures don't break the loop`);

  // Issue-number guard: the call should be skipped when no issue number is
  // available, matching the contract of ensurePullRequestIssueLink itself.
  const guardSnippet = source.slice(Math.max(0, callIndex - 600), callIndex);
  assert(guardSnippet.includes('issueNumber'), `${site.file} guards the call on a present issueNumber`);
}

// Behaviour pin: the helper must restore "Fixes #N" when the AI overwrites
// the PR body without a closing keyword (the exact scenario from the original
// kefine#54 / kefine PR #55 incident that motivated #1763).
const overwrittenBody = ['This PR implements the frontend refactor for issue #54.', '', '## Summary', '- Switched layout to flex', '- Updated header copy'].join('\n');

const restored = ensureIssueLinkInPullRequestBody(overwrittenBody, {
  issueNumber: 54,
  owner: 'lefinepro',
  repo: 'kefine',
});

assert(restored.updated === true, 'Bare "issue #N" mention without keyword is treated as missing');
assert(restored.body.endsWith('\n\nFixes #54'), 'Closing keyword is appended when AI strips it during an iteration');
assert(restored.body.startsWith('This PR implements the frontend refactor for issue #54.'), 'Original PR body content is preserved verbatim');

console.log('\n' + '='.repeat(70));
console.log(`Total tests: ${testsPassed + testsFailed}`);
console.log(`Passed: ${testsPassed}`);
console.log(`Failed: ${testsFailed}`);

if (testsFailed > 0) {
  process.exit(1);
}
