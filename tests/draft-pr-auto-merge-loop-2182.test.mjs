#!/usr/bin/env node

/**
 * Regression test for issue #2182: a task stayed "Processing" for 4d 12h 13m 35s.
 *
 * Reported symptom: `/claude <issue> --auto-merge` kept a Telegram task in the
 * "Processing" state for more than four days. The captured log (102k lines) shows
 * 2693 monitoring checks, each of them:
 *
 *   ✅ PR IS MERGEABLE!
 *   ❌ Merge failed: GraphQL: Pull Request is still a draft (mergePullRequest)
 *      Will continue monitoring...
 *
 * Root causes, all fixed here:
 *   RC-A  executeToolIteration() drafts the PR before each restart iteration
 *         (issue #2123) but never restored "ready for review" afterwards.
 *   RC-B  checkPRMergeable() never asked GitHub for `isDraft`, and GitHub reports
 *         mergeable=MERGEABLE / mergeStateStatus=CLEAN for a draft PR whose only
 *         blocker is the draft flag — so the loop saw zero blockers.
 *   RC-C  a failed `gh pr merge` was never classified: every failure, terminal or
 *         not, printed "Will continue monitoring..." and retried forever.
 *   RC-D  the monitoring loop had no wall-clock timeout at all.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2182
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyMergeError, evaluatePullRequestMergeability, MERGE_ERROR_CATEGORIES, MAX_CONSECUTIVE_MERGE_FAILURES } from '../src/merge-error-classification.lib.mjs';
import { normalizeWatchTimeoutHours, DEFAULT_WATCH_TIMEOUT_HOURS } from '../src/solve.auto-merge.lib.mjs';
import { waitForPRReady } from '../src/telegram-merge-wait.lib.mjs';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

const test = async (description, fn) => {
  try {
    await fn();
    console.log(`  ${GREEN}PASS:${RESET} ${description}`);
    passed++;
  } catch (e) {
    console.log(`  ${RED}FAIL:${RESET} ${description}`);
    console.log(`      Error: ${e.message}`);
    failed++;
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const readSrc = name => readFileSync(join(__dirname, '..', 'src', name), 'utf8');

console.log('================================================================================');
console.log('Regression: a draft PR must not spin the auto-merge loop forever (Issue #2182)');
console.log('================================================================================\n');

console.log('RC-B: GitHub reports a draft PR as MERGEABLE/CLEAN\n');

await test('the exact API answer observed on the stuck PR is NOT treated as mergeable', () => {
  // Verified live against link-assistant/hive-mind#2183 while it was a draft:
  // { isDraft: true, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" }
  const result = evaluatePullRequestMergeability({ isDraft: true, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' });
  assert(result.mergeable === false, 'a draft PR must never be reported as mergeable');
  assert(result.isDraft === true, 'the draft flag must be propagated to the caller');
  assert(/draft/i.test(result.reason), `reason should mention the draft state, got ${JSON.stringify(result.reason)}`);
});

await test('a ready PR with the same API answer is still mergeable', () => {
  const result = evaluatePullRequestMergeability({ isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' });
  assert(result.mergeable === true, `expected mergeable, got ${JSON.stringify(result)}`);
  assert(result.isDraft === false, 'isDraft must be false for a ready PR');
});

await test('mergeStateStatus DRAFT is reported as a draft even without the isDraft field', () => {
  const result = evaluatePullRequestMergeability({ mergeable: 'UNKNOWN', mergeStateStatus: 'DRAFT' });
  assert(result.mergeable === false && /draft/i.test(result.reason), `expected a draft reason, got ${JSON.stringify(result)}`);
});

await test('conflicting and blocked states keep their previous behaviour', () => {
  const conflicting = evaluatePullRequestMergeability({ isDraft: false, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' });
  assert(conflicting.mergeable === false, 'a conflicting PR is not mergeable');
  const blocked = evaluatePullRequestMergeability({ isDraft: false, mergeable: 'UNKNOWN', mergeStateStatus: 'BLOCKED' });
  assert(blocked.mergeable === false, 'a blocked PR is not mergeable');
});

console.log('\nRC-C: merge failures must be classified instead of retried blindly\n');

await test('the observed merge error is classified as a recoverable draft failure', () => {
  const classification = classifyMergeError('GraphQL: Pull Request is still a draft (mergePullRequest)');
  assert(classification.category === MERGE_ERROR_CATEGORIES.DRAFT, `expected the draft category, got ${classification.category}`);
  assert(classification.recoverable === true, 'a draft failure is recoverable: the PR can be marked ready');
  assert(classification.terminal === false, 'a draft failure is not terminal on its own');
  assert(typeof classification.resolution === 'string' && classification.resolution.length > 0, 'a resolution hint must be provided');
});

await test('permission and closed-PR failures are terminal', () => {
  const closed = classifyMergeError('Pull request is closed');
  assert(closed.category === MERGE_ERROR_CATEGORIES.CLOSED && closed.terminal === true, `expected a terminal closed classification, got ${JSON.stringify(closed)}`);
  const permission = classifyMergeError('GraphQL: Resource not accessible by integration (mergePullRequest)');
  assert(permission.terminal === true, `expected a terminal permission classification, got ${JSON.stringify(permission)}`);
});

await test('unknown failures are non-terminal but still counted', () => {
  const unknown = classifyMergeError('something completely unexpected');
  assert(unknown.category === MERGE_ERROR_CATEGORIES.UNKNOWN, `expected the unknown category, got ${unknown.category}`);
  assert(unknown.terminal === false, 'unknown failures must stay retryable');
  assert(MAX_CONSECUTIVE_MERGE_FAILURES > 0 && MAX_CONSECUTIVE_MERGE_FAILURES <= 10, 'a bounded retry budget must exist');
});

console.log('\nRC-D: the monitoring loop must have a wall-clock timeout\n');

await test('the default watch timeout is finite', () => {
  assert(DEFAULT_WATCH_TIMEOUT_HOURS > 0, 'a positive default timeout must exist');
  assert(normalizeWatchTimeoutHours(undefined) === DEFAULT_WATCH_TIMEOUT_HOURS, 'an absent option falls back to the default');
});

await test('0 and negative values mean "unlimited", explicit values are honoured', () => {
  assert(normalizeWatchTimeoutHours(0) === 0, '0 means unlimited');
  assert(normalizeWatchTimeoutHours(-1) === 0, 'negative values mean unlimited');
  assert(normalizeWatchTimeoutHours('3') === 3, 'numeric strings are accepted');
  assert(normalizeWatchTimeoutHours('not a number') === DEFAULT_WATCH_TIMEOUT_HOURS, 'garbage falls back to the default');
});

await test('4d 12h — the duration from the issue title — exceeds the default timeout', () => {
  const observedHours = (4 * 24 * 60 * 60 + 12 * 3600 + 13 * 60 + 35) / 3600;
  assert(observedHours > DEFAULT_WATCH_TIMEOUT_HOURS, `the reported ${observedHours.toFixed(1)}h run must be cut short by the ${DEFAULT_WATCH_TIMEOUT_HOURS}h default`);
});

console.log('\nThe Telegram merge queue must skip drafts instead of waiting out the timeout\n');

await test('waitForPRReady returns the draft status immediately', async () => {
  const processor = {
    isCancelled: false,
    log: () => {},
    sleep: async () => {},
    getProgressUpdate: () => ({}),
    checkPRMergeable: async () => ({ mergeable: false, isDraft: true, reason: 'PR is a draft' }),
  };
  const item = { pr: { number: 141 } };
  const result = await waitForPRReady(
    processor,
    item,
    { mergeable: false, isDraft: true, reason: 'PR is a draft' },
    {
      MergeItemStatus: { CHECKING_CI: 'checking_ci', WAITING_READY: 'waiting_ready' },
      conflictSkipReason: 'conflict',
      timeoutMs: 60 * 60 * 1000,
      pollIntervalMs: 1,
    }
  );
  assert(result.success === false && result.status === 'draft', `expected an immediate draft skip, got ${JSON.stringify(result)}`);
  assert(/draft/i.test(result.error), 'the error must name the real reason');
});

console.log('\nWiring: every merge path must handle the draft state (Issue #2182 R10)\n');

const githubMergeSrc = readSrc('github-merge.lib.mjs');
const restartSrc = readSrc('solve.restart-shared.lib.mjs');
const autoMergeSrc = readSrc('solve.auto-merge.lib.mjs');
// Issue #1593: the guard rails live in their own module so solve.auto-merge.lib.mjs
// stays under the 1350-line advisory threshold.
const guardsSrc = readSrc('solve.auto-merge-guards.lib.mjs');
const attemptSrc = readSrc('solve.auto-merge-attempt.lib.mjs');
const helpersSrc = readSrc('solve.auto-merge-helpers.lib.mjs');
const queueSrc = readSrc('telegram-merge-queue.lib.mjs');
const waitSrc = readSrc('telegram-merge-wait.lib.mjs');

await test('RC-A: executeToolIteration restores "ready for review" after the tool run', () => {
  const iterationStart = restartSrc.indexOf('export const executeToolIteration');
  assert(iterationStart !== -1, 'executeToolIteration must exist');
  const readyCall = restartSrc.indexOf('ensurePullRequestIsReady(', iterationStart);
  const draftCall = restartSrc.indexOf('ensurePullRequestIsDraft(', iterationStart);
  assert(readyCall !== -1, 'executeToolIteration must call ensurePullRequestIsReady — otherwise the PR stays a draft forever (issue #2182)');
  assert(draftCall < readyCall, 'the ready conversion must come after the draft conversion');
});

await test('RC-B: checkPRMergeable asks GitHub for isDraft and uses the shared evaluator', () => {
  assert(githubMergeSrc.includes('isDraft,mergeable,mergeStateStatus'), 'checkPRMergeable must request isDraft from the API');
  assert(githubMergeSrc.includes('evaluatePullRequestMergeability('), 'checkPRMergeable must use the shared evaluator');
});

await test('RC-C: mergePullRequest classifies its failures', () => {
  assert(githubMergeSrc.includes('classifyMergeError('), 'mergePullRequest must classify merge errors');
  assert(githubMergeSrc.includes('terminal: classification.terminal'), 'the classification must reach the caller');
});

await test('the auto-merge watch loop stops instead of only logging "Will continue monitoring"', () => {
  assert(guardsSrc.includes('MAX_CONSECUTIVE_MERGE_FAILURES'), 'the watch loop must bound consecutive merge failures');
  assert(guardsSrc.includes("action: 'stop', reason: 'merge_failed'"), 'exhausted merge failures must be reported and stop the loop');
  assert(autoMergeSrc.includes("decision.action === 'stop'"), 'the watch loop must honour the guard decision instead of only logging');
  assert(autoMergeSrc.includes("reason: 'watch_timeout'"), 'the wall-clock timeout must be reported');
});

await test('the auto-merge watch loop self-heals a draft PR', () => {
  assert(autoMergeSrc.includes("blockers.find(b => b.type === 'draft')"), 'the watch loop must react to the draft blocker');
  assert(autoMergeSrc.includes('resolveDraftBlocker('), 'the watch loop must delegate to the draft guard');
  assert(guardsSrc.includes('ensurePullRequestIsReady('), 'the guard must mark the PR ready again');
  assert(guardsSrc.includes('MAX_DRAFT_SELF_HEALS'), 'the self-heal must be bounded');
});

await test('getMergeBlockers emits a dedicated draft blocker on every path', () => {
  assert(helpersSrc.includes("type: mergeStatus.isDraft ? 'draft' : 'not_mergeable'"), 'the main path must emit a draft blocker');
  assert(helpersSrc.includes('earlyMergeStatus.isDraft'), 'the no_checks path must emit a draft blocker before its early returns');
});

await test('the single-shot merge attempt also self-heals and classifies', () => {
  assert(attemptSrc.includes('ensurePullRequestIsReady('), 'attemptAutoMerge must restore "ready for review" before giving up');
  assert(attemptSrc.includes('classifyMergeError('), 'attemptAutoMerge must classify merge failures');
});

await test('the Telegram merge queue treats a draft as a skip, not a timeout', () => {
  assert(waitSrc.includes('latestCheck?.isDraft'), 'waitForPRReady must detect drafts');
  assert(queueSrc.includes("=== 'draft'"), 'the queue must map the draft status to SKIPPED');
});

console.log('');
console.log('================================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================================');

process.exit(failed === 0 ? 0 : 1);
