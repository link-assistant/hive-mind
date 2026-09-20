#!/usr/bin/env node

/**
 * Unit Tests: Issue #1861 - CodeRabbit review credit limits must not trigger auto-restart.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1861
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReadyForReviewComment, isExternalReviewLimitCheck, splitExternalReviewLimitChecks } from '../src/external-review-limit.lib.mjs';
import { READY_FOR_REVIEW_MARKER, TOOL_GENERATED_COMMENT_MARKERS, isToolGeneratedComment } from '../src/tool-comments.lib.mjs';

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
console.log('Unit Tests: Issue #1861 - external review credit limit handling');
console.log('================================================================================\n');

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const autoMergeSrc = readFileSync(join(repoRoot, 'src', 'solve.auto-merge.lib.mjs'), 'utf8');
const blockerSrc = readFileSync(join(repoRoot, 'src', 'solve.auto-merge-helpers.lib.mjs'), 'utf8');

test('CodeRabbit insufficient review credits are classified as an external review limit', () => {
  assert(
    isExternalReviewLimitCheck({
      name: 'CodeRabbit',
      type: 'status',
      conclusion: 'failure',
      description: 'Insufficient review credits',
      html_url: 'https://github.com/ProverCoderAI/docker-git/pull/387#issuecomment-4646545475',
    }),
    'Expected CodeRabbit insufficient credits status to be treated as a non-actionable external review limit'
  );
});

test('CodeRabbit usage-credit language from the incident comment is classified as a review limit', () => {
  assert(
    isExternalReviewLimitCheck({
      name: 'CodeRabbit',
      description: 'Review limit reached. Your organization has run out of usage credits. Purchase more in billing tab.',
    }),
    'Expected CodeRabbit review-limit and usage-credit language to be recognized'
  );
});

test('ordinary GitHub Actions failures remain actionable CI failures', () => {
  assert(
    !isExternalReviewLimitCheck({
      name: 'Check / test',
      type: 'check_run',
      conclusion: 'failure',
      description: 'npm test failed',
      html_url: 'https://github.com/link-assistant/hive-mind/actions/runs/1',
    }),
    'Expected a normal GitHub Actions failure to remain actionable'
  );
});

test('quota-only failures do not leave actionable CI failures for auto-restart', () => {
  const { limitedChecks, actionableFailedChecks } = splitExternalReviewLimitChecks([
    {
      name: 'CodeRabbit',
      type: 'status',
      conclusion: 'failure',
      description: 'Insufficient review credits',
    },
  ]);

  assert(limitedChecks.length === 1, `Expected one external review limit check, got ${limitedChecks.length}`);
  assert(actionableFailedChecks.length === 0, `Expected no actionable CI failures, got ${actionableFailedChecks.length}`);
});

test('mixed CodeRabbit limit and real CI failure still trigger auto-restart for real failure', () => {
  const { limitedChecks, actionableFailedChecks } = splitExternalReviewLimitChecks([
    {
      name: 'CodeRabbit',
      type: 'status',
      conclusion: 'failure',
      description: 'Insufficient review credits',
    },
    {
      name: 'Final build',
      type: 'check_run',
      conclusion: 'failure',
      description: 'Build failed',
    },
  ]);

  assert(limitedChecks.length === 1, `Expected one external review limit check, got ${limitedChecks.length}`);
  assert(actionableFailedChecks.length === 1, `Expected one actionable CI failure, got ${actionableFailedChecks.length}`);
  assert(actionableFailedChecks[0].name === 'Final build', 'Expected Final build to remain actionable');
});

test('ready-for-review comment lists skipped checks and avoids ready-to-merge wording', () => {
  const comment = buildReadyForReviewComment({
    blocker: {
      details: ['CodeRabbit — Insufficient review credits'],
    },
    ciStatus: {
      passedChecks: [{ name: 'Check', description: 'Passed' }],
    },
  });

  assert(comment.includes(`## 🟡 ${READY_FOR_REVIEW_MARKER}`), 'Expected Ready for review heading');
  assert(comment.includes('**Checks not executed:**'), 'Expected a skipped-checks section');
  assert(comment.includes('CodeRabbit — Insufficient review credits'), 'Expected skipped CodeRabbit reason');
  assert(comment.includes('No new AI session was started'), 'Expected explicit no-restart guidance');
  assert(!comment.includes('Ready to merge'), 'Expected comment to avoid Ready to merge wording');
});

test('ready-for-review comments are treated as tool-generated', () => {
  const comment = buildReadyForReviewComment({
    blocker: {
      details: ['CodeRabbit — Insufficient review credits'],
    },
  });

  assert(TOOL_GENERATED_COMMENT_MARKERS.includes(READY_FOR_REVIEW_MARKER), 'Expected Ready for review marker to be registered');
  assert(isToolGeneratedComment(comment), 'Expected Ready for review comments to be filtered as tool-generated comments');
});

test('production blocker code separates review limits from ci_failure blockers', () => {
  assert(blockerSrc.includes('splitExternalReviewLimitChecks'), 'Expected getMergeBlockers to split external review limit checks from actionable failures');
  assert(blockerSrc.includes("type: 'external_review_limit'"), 'Expected getMergeBlockers to emit external_review_limit blockers');
  assert(blockerSrc.includes("type: 'ci_failure'"), 'Expected getMergeBlockers to keep ci_failure blockers for actionable failures');
});

test('auto-restart loop exits with Ready for review for quota-only external review failures', () => {
  assert(autoMergeSrc.includes('external_review_limit'), 'Expected watchUntilMergeable to handle external_review_limit blockers');
  assert(autoMergeSrc.includes('buildReadyForReviewComment'), 'Expected watchUntilMergeable to post a Ready for review handoff comment');
  assert(autoMergeSrc.includes("reason: 'external_review_limit'"), 'Expected watchUntilMergeable to stop with external_review_limit reason');
});

console.log('\n================================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================================');

if (failed > 0) {
  process.exit(1);
}
