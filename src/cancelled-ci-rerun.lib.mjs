#!/usr/bin/env node

/**
 * Helpers for cancelled/stale CI handling in auto-merge mode.
 *
 * GitHub can expose several operational cases as a cancelled/stale status:
 * manual cancellation, concurrency cancellation, queue/run limits, or a
 * workflow/job timeout. If hive-mind cannot re-trigger the run, a human has to
 * inspect the logs because polling the same conclusion will not make progress.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1769
 */

import { CANCELLED_CI_REVIEW_MARKER } from './tool-comments.lib.mjs';

const CANCELLED_OR_STALE_CONCLUSIONS = new Set(['cancelled', 'stale']);

/**
 * Issue #1952: Workflow-run conclusions that represent a genuine CI failure rather than a
 * re-triggerable cancellation.
 *
 * GitHub surfaces a job that hit its `timeout-minutes` limit as a check-run with
 * `conclusion: 'cancelled'`, but the parent workflow_run concludes `'failure'` (a step that
 * exceeds `timeout-minutes` likewise produces `'failure'`; an infrastructure/setup error
 * produces `'startup_failure'`; the legacy max-execution timeout produces `'timed_out'`).
 *
 * `getDetailedCIStatus` only inspects check-runs, so it cannot tell a timeout failure
 * (check-run cancelled + workflow_run failed) apart from a deliberate manual/concurrency
 * cancellation (check-run cancelled + workflow_run cancelled). Cross-referencing the
 * workflow-run conclusion lets the caller treat a timeout/failure as a CI failure (which the
 * AI should fix / auto-restart) instead of a re-triggerable cancellation that stops for human
 * review.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1952
 */
const FAILURE_LIKE_WORKFLOW_RUN_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure']);

export { CANCELLED_CI_REVIEW_MARKER, FAILURE_LIKE_WORKFLOW_RUN_CONCLUSIONS };

export const getRetriggerableWorkflowRuns = (runs = []) => runs.filter(run => CANCELLED_OR_STALE_CONCLUSIONS.has(run?.conclusion));

/**
 * Issue #1952: Workflow runs that have not yet reached a terminal state.
 *
 * The issue requires waiting "until all checks are success, fail or cancelled, to auto
 * restart". Even when every check-run already looks cancelled, a workflow run may still be
 * `queued`/`in_progress` (e.g. a retrying matrix leg), so the auto-merge loop must keep
 * waiting rather than prematurely classifying the result.
 *
 * @param {Array<{status?: string}>} runs - Workflow runs for the commit SHA.
 * @returns {Array} Runs whose `status` is not `'completed'`.
 */
export const getIncompleteWorkflowRuns = (runs = []) => runs.filter(run => run?.status && run.status !== 'completed');

/**
 * Issue #1952: Completed workflow runs whose conclusion represents a genuine failure
 * (failure / timed_out / startup_failure), including the timeout-cancellation case.
 *
 * @param {Array<{status?: string, conclusion?: string}>} runs - Workflow runs for the commit SHA.
 * @returns {Array} Completed runs with a failure-like conclusion.
 */
export const getFailedWorkflowRuns = (runs = []) => runs.filter(run => run?.status === 'completed' && FAILURE_LIKE_WORKFLOW_RUN_CONCLUSIONS.has(run?.conclusion));

/**
 * Issue #1952: Decide how a "cancelled" CI status (per check-runs) should be reclassified
 * after cross-referencing the workflow runs for the same commit SHA.
 *
 * - `pending`  → at least one workflow run is still queued/in progress; keep waiting so we only
 *                act once every check has reached a terminal state.
 * - `failure`  → at least one completed workflow run failed/timed out/failed to start; the
 *                cancellation reflects a real failure (e.g. a job hit `timeout-minutes`) and must
 *                be treated as a CI failure, not a re-triggerable cancellation.
 * - `cancelled`→ no failures and nothing pending; this is a genuine re-triggerable cancellation
 *                (manual cancel, concurrency cancel, stale) that the existing rerun flow handles.
 *
 * @param {{runs?: Array}} params
 * @returns {{classification: 'pending'|'failure'|'cancelled', incompleteRuns: Array, failedRuns: Array}}
 */
export const classifyCancelledCIByWorkflowRuns = ({ runs = [] } = {}) => {
  const incompleteRuns = getIncompleteWorkflowRuns(runs);
  if (incompleteRuns.length > 0) {
    return { classification: 'pending', incompleteRuns, failedRuns: [] };
  }

  const failedRuns = getFailedWorkflowRuns(runs);
  if (failedRuns.length > 0) {
    return { classification: 'failure', incompleteRuns, failedRuns };
  }

  return { classification: 'cancelled', incompleteRuns, failedRuns };
};

export const shouldStopForCancelledCIReview = ({ retriggerableRuns = [], rerunTriggered = false, rerunFailures = [] }) => {
  if (rerunTriggered) {
    return false;
  }

  return retriggerableRuns.length === 0 || rerunFailures.length > 0;
};

const formatMarkdownList = (items, fallback) => {
  if (!items || items.length === 0) {
    return `- ${fallback}`;
  }

  return items.map(item => `- ${item}`).join('\n');
};

const formatRunReference = run => {
  if (!run) {
    return 'Unknown workflow run';
  }

  const name = run.name || run.path || (run.id ? `Workflow run ${run.id}` : 'Workflow run');
  const runId = run.id ? ` (${run.id})` : '';
  const status = [run.status, run.conclusion].filter(Boolean).join('/');
  const statusPart = status ? ` [${status}]` : '';
  const urlPart = run.html_url ? ` - ${run.html_url}` : '';

  return `${name}${runId}${statusPart}${urlPart}`;
};

const formatRerunFailure = failure => {
  const runPart = formatRunReference(failure?.run);
  const error = failure?.error || 'Unknown error';
  return `${runPart}: ${error}`;
};

export const buildCancelledCIReviewComment = ({ blocker, runs = [], rerunFailures = [], rerunAttempted = false, sha }) => {
  const cancelledDetails = blocker?.details || [];
  const effectiveSha = sha || blocker?.sha;
  const shaLine = effectiveSha ? `\n\n**Commit:** ${effectiveSha}` : '';
  const rerunSummary = rerunAttempted ? 'Automatic re-run was attempted, but no workflow run was successfully re-triggered.' : 'Automatic re-run was not possible.';

  return `## ${CANCELLED_CI_REVIEW_MARKER}

Hive Mind detected cancelled or stale CI/CD checks and cannot get them running automatically.${shaLine}

**Cancelled checks**
${formatMarkdownList(cancelledDetails, 'No cancelled check details were available.')}

**Workflow runs inspected**
${formatMarkdownList(runs.map(formatRunReference), 'No cancelled/stale workflow run was found for this commit SHA.')}

**Automatic re-run result**
${rerunSummary}
${formatMarkdownList(rerunFailures.map(formatRerunFailure), 'No successful automatic re-run was recorded.')}

**Action required**
1. Review the cancelled CI logs to decide whether this was a real timeout/failure or a deliberate manual cancellation.
2. If the cancelled check is required, re-run the workflow manually from GitHub Actions or push a new commit.
3. If the cancellation was deliberate and non-blocking, decide whether this PR can be merged outside automation.

If workflow/job \`timeout-minutes\` or a runner execution limit caused the cancellation, treat it as a CI failure and fix the timeout, test, or infrastructure before merging.

---
Hive Mind is stopping because continuing to poll the same cancelled/stale check would not change the mergeability result.`;
};
