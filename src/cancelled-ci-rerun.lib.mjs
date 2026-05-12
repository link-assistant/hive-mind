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

export { CANCELLED_CI_REVIEW_MARKER };

export const getRetriggerableWorkflowRuns = (runs = []) => runs.filter(run => CANCELLED_OR_STALE_CONCLUSIONS.has(run?.conclusion));

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
