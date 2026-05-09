#!/usr/bin/env node

/**
 * Unit Tests: Issue #1769 - cancelled CI rerun failure must not wait forever.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1769
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANCELLED_CI_REVIEW_MARKER,
  buildCancelledCIReviewComment,
  getRetriggerableWorkflowRuns,
  shouldStopForCancelledCIReview,
} from '../src/cancelled-ci-rerun.lib.mjs';
import { TOOL_GENERATED_COMMENT_MARKERS } from '../src/tool-comments.lib.mjs';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

const test = (description, fn) => {
  try {
    fn();
    console.log(`  ${GREEN}PASS:${RESET} ${description}`);
    passed++;
  } catch (e) {
    console.log(`  ${RED}FAIL:${RESET} ${description}`);
    console.log(`      Error: ${e.message}`);
    failed++;
  }
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

console.log('================================================================================');
console.log('Unit Tests: Issue #1769 - cancelled CI rerun failure handling');
console.log('================================================================================\n');

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const autoMergeSrc = readFileSync(join(repoRoot, 'src', 'solve.auto-merge.lib.mjs'), 'utf8');

test('cancelled CI auto-rerun failure exits with a human-review reason instead of waiting forever', () => {
  assert(
    autoMergeSrc.includes('ci_cancelled_requires_review'),
    'watchUntilMergeable should return ci_cancelled_requires_review when cancelled CI cannot be re-triggered automatically',
  );
});

test('cancelled CI auto-rerun failure posts a review comment before exiting', () => {
  assert(
    autoMergeSrc.includes('buildCancelledCIReviewComment'),
    'watchUntilMergeable should build a cancelled-CI review comment for manual action',
  );
  assert(
    autoMergeSrc.includes('post_cancelled_ci_review_comment'),
    'watchUntilMergeable should report comment-posting failures with a cancelled-CI-specific context',
  );
});

test('cancelled/stale workflow runs are the only automatic rerun candidates', () => {
  const runs = getRetriggerableWorkflowRuns([
    { id: 1, conclusion: 'success' },
    { id: 2, conclusion: 'cancelled' },
    { id: 3, conclusion: 'stale' },
    { id: 4, conclusion: 'failure' },
  ]);

  assert(runs.length === 2, `Expected 2 retriggerable runs, got ${runs.length}`);
  assert(runs.map(run => run.id).join(',') === '2,3', 'Expected only cancelled and stale runs to be retriggerable');
});

test('rerun permission failures require human review', () => {
  const retriggerableRuns = [{ id: 25595105760, name: 'Check', conclusion: 'cancelled' }];
  const rerunFailures = [{ run: retriggerableRuns[0], error: 'gh: Must have admin rights to Repository. (HTTP 403)' }];

  assert(
    shouldStopForCancelledCIReview({ retriggerableRuns, rerunTriggered: false, rerunFailures }),
    'Expected rerun failures without a successful rerun to stop for human review',
  );
  assert(
    !shouldStopForCancelledCIReview({ retriggerableRuns, rerunTriggered: true, rerunFailures }),
    'Expected a successful automatic rerun to keep the watcher waiting',
  );
});

test('human-review comment includes rerun failure, manual action, and timeout guidance', () => {
  const run = {
    id: 25595105760,
    name: 'Check',
    status: 'completed',
    conclusion: 'cancelled',
    html_url: 'https://github.com/ProverCoderAI/docker-git/actions/runs/25595105760',
  };
  const comment = buildCancelledCIReviewComment({
    blocker: {
      sha: '188b756629c97061b0b62d4b5450ed47224502ae',
      details: ['E2E (Clone cache) [cancelled] - https://github.com/ProverCoderAI/docker-git/actions/runs/25595105760/job/75139593668'],
    },
    runs: [run],
    rerunFailures: [{ run, error: 'gh: Must have admin rights to Repository. (HTTP 403)' }],
    rerunAttempted: true,
  });

  assert(comment.includes('Cancelled CI/CD Requires Review'), 'Expected comment to carry the review marker');
  assert(comment.includes('Must have admin rights'), 'Expected comment to include the rerun permission failure');
  assert(comment.includes('re-run the workflow manually'), 'Expected comment to ask for manual workflow re-run');
  assert(comment.includes('timeout-minutes'), 'Expected comment to tell reviewers to treat workflow timeouts as CI failures');
});

test('cancelled-CI review comments are marked as tool-generated comments', () => {
  assert(
    TOOL_GENERATED_COMMENT_MARKERS.includes(CANCELLED_CI_REVIEW_MARKER),
    'Expected cancelled-CI review comments to be excluded from AI-authored comment detection',
  );
});

console.log('\n================================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================================');

if (failed > 0) {
  process.exit(1);
}
