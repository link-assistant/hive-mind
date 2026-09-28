/**
 * Issue #2295: honest CI status reporting for workflow runs that never executed.
 *
 * On pull requests from forks, GitHub holds `pull_request` workflow runs until a
 * maintainer approves them. Such a run is `status: completed` with
 * `conclusion: action_required` and has zero jobs, so it publishes no check-runs.
 * If the same commit also has a `pull_request_target` workflow (which runs without
 * approval), its check-runs are all success/skipped and the combined status is
 * "success". hive-mind used to trust that rollup and posted
 * "✅ Ready to merge — All CI checks have passed" three times on
 * paranjko/external-test-lab#177 while no CI job had run at all.
 *
 * These helpers are pure so the decision and the published wording can be
 * tested without GitHub.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2295
 * @see https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/approving-workflow-runs-from-public-forks
 */

/**
 * Workflow-run conclusions that mean the run finished without executing any job.
 * `skipped` is excluded on purpose: a skipped run is a deliberate "nothing to do".
 * `cancelled` is excluded because it usually means a newer run superseded it.
 */
export const NON_EXECUTED_RUN_CONCLUSIONS = Object.freeze(['action_required', 'stale']);

/** Marker/heading used instead of "Ready to merge" while CI waits for approval. */
export const CI_AWAITING_APPROVAL_MARKER = 'CI has not run yet';

/**
 * Keep only the newest run of each workflow (and event) for a commit.
 * Pushing the same head again creates a new run while the old one stays
 * `action_required` forever; only the newest run says whether CI ran.
 * The GitHub API lists runs newest first, which is the fallback order.
 *
 * @param {Array<Object>} workflowRuns
 * @returns {Array<Object>}
 */
export function getLatestRunPerWorkflow(workflowRuns) {
  if (!Array.isArray(workflowRuns)) return [];
  const latest = new Map();
  for (const run of workflowRuns) {
    if (!run) continue;
    const key = `${run.workflow_id ?? run.path ?? run.name}|${run.event ?? ''}`;
    const current = latest.get(key);
    if (!current || (run.created_at && current.created_at && run.created_at > current.created_at)) {
      latest.set(key, run);
    }
  }
  return [...latest.values()];
}

/**
 * Completed workflow runs that never executed (awaiting approval or stale),
 * considering only the newest run of each workflow.
 *
 * @param {Array<{name?: string, path?: string, workflow_id?: number, event?: string, created_at?: string, status?: string, conclusion?: string, html_url?: string}>} workflowRuns
 * @returns {Array<{name: string, conclusion: string, url: (string|null)}>}
 */
export function findNonExecutedWorkflowRuns(workflowRuns) {
  return getLatestRunPerWorkflow(workflowRuns)
    .filter(run => run.status === 'completed' && NON_EXECUTED_RUN_CONCLUSIONS.includes(run.conclusion))
    .map(run => ({
      name: run.name || run.path || 'unnamed workflow',
      conclusion: run.conclusion,
      url: run.html_url || null,
    }));
}

/**
 * Runs from {@link findNonExecutedWorkflowRuns} that wait for a maintainer approval.
 *
 * @param {Array<{conclusion: string}>} nonExecutedRuns
 * @returns {Array<{name: string, conclusion: string, url: (string|null)}>}
 */
export function getRunsAwaitingApproval(nonExecutedRuns) {
  return (nonExecutedRuns || []).filter(run => run.conclusion === 'action_required');
}

const formatRunNames = runs => [...new Set(runs.map(run => run.name))].join(', ');

/**
 * The CI bullet line of the "Ready to merge" / "Auto-merged" comments.
 * Previously duplicated inline in solve.auto-merge.lib.mjs.
 *
 * @param {Object} options
 * @param {boolean} [options.noCiConfigured]
 * @param {boolean} [options.noCiTriggered]
 * @param {string} [options.workflowRunConclusions]
 * @param {Array<{name: string, conclusion: string}>} [options.nonExecutedWorkflowRuns]
 * @returns {string}
 */
export function buildCiStatusLine({ noCiConfigured = false, noCiTriggered = false, workflowRunConclusions = null, nonExecutedWorkflowRuns = [] } = {}) {
  if (noCiConfigured) {
    return '- No CI/CD checks are configured for this repository';
  }
  const awaitingApproval = getRunsAwaitingApproval(nonExecutedWorkflowRuns);
  if (awaitingApproval.length > 0) {
    return `- ⚠️ CI has not run: ${awaitingApproval.length} workflow run(s) are waiting for a maintainer to approve them (action_required): ${formatRunNames(awaitingApproval)}`;
  }
  if (nonExecutedWorkflowRuns && nonExecutedWorkflowRuns.length > 0) {
    const conclusions = [...new Set(nonExecutedWorkflowRuns.map(run => run.conclusion))].join(', ');
    return `- ⚠️ ${nonExecutedWorkflowRuns.length} CI workflow run(s) completed without executing (${conclusions}): ${formatRunNames(nonExecutedWorkflowRuns)}`;
  }
  if (noCiTriggered) {
    return workflowRunConclusions ? `- CI workflows completed without executing (${workflowRunConclusions})` : '- CI workflows exist but were not triggered for this commit';
  }
  return '- All CI checks have passed';
}

/**
 * Build the comment posted when auto-restart-until-mergeable finds no blockers.
 *
 * When CI runs are waiting for approval, the pull request is NOT declared ready
 * to merge: its code has not been tested by the repository's CI.
 *
 * @param {Object} options
 * @param {string} options.readyMarker - READY_TO_MERGE_MARKER from tool-comments.lib.mjs
 * @param {string} options.ciLine - from {@link buildCiStatusLine}
 * @param {Array<{name: string, conclusion: string, url: (string|null)}>} [options.nonExecutedWorkflowRuns]
 * @param {string} [options.issueLine] - optional trailing note
 * @returns {{heading: string, body: string, awaitingApproval: boolean}}
 */
export function buildMergeReadinessComment({ readyMarker, ciLine, nonExecutedWorkflowRuns = [], issueLine = '' }) {
  const footer = '\n\n---\n*Monitored by hive-mind with --auto-restart-until-mergeable flag*';
  const awaitingApproval = getRunsAwaitingApproval(nonExecutedWorkflowRuns);
  if (awaitingApproval.length > 0) {
    const heading = `## ⏸️ ${CI_AWAITING_APPROVAL_MARKER}`;
    const runLinks = awaitingApproval.map(run => (run.url ? `- [${run.name}](${run.url})` : `- ${run.name}`)).join('\n');
    const body = `${heading}\n\nThere are no merge conflicts or pending changes, but this pull request is **not** confirmed ready to merge:\n${ciLine}\n\n${runLinks}\n\nA maintainer can approve these runs from the Actions tab if they want CI to run.${issueLine}${footer}`;
    return { heading, body, awaitingApproval: true };
  }
  const heading = `## ✅ ${readyMarker}`;
  const body = `${heading}\n\nThis pull request is now ready to be merged:\n${ciLine}\n- No merge conflicts\n- No pending changes${issueLine}${footer}`;
  return { heading, body, awaitingApproval: false };
}
