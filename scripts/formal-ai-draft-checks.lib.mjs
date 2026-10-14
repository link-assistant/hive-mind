/**
 * Mirror a draft's dispatched check runs onto its pull request.
 *
 * A pull request opened with the workflow `GITHUB_TOKEN` starts no
 * `pull_request` runs, so the draft workflow dispatches the checks on the head
 * branch. A `workflow_dispatch` run is attached to no pull request, though, so
 * the pull request showed none of them. Each dispatched run is posted as a
 * commit status on the head SHA, which the pull request does show.
 *
 * @module formal-ai-draft-checks
 */

/** Status contexts read `dispatched / <workflow file>`. */
export const CHECK_STATUS_CONTEXT_PREFIX = 'dispatched';

/** GitHub rejects a longer status description. */
const MAX_DESCRIPTION = 140;

const contextFor = workflow => `${CHECK_STATUS_CONTEXT_PREFIX} / ${workflow}`;
const truncate = text => (text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1)}…` : text);
const workflowFileOf = run => String(run?.path || '').split('@')[0];

/**
 * The newest `workflow_dispatch` run of each workflow on `sha`, in `workflows` order.
 *
 * @param {object[]} runs `GET /repos/{repo}/actions/runs` entries
 * @param {{sha: string, workflows: string[]}} options
 * @returns {{workflow: string, run: (object|null)}[]}
 */
export function selectDispatchedRuns(runs, { sha, workflows }) {
  const candidates = (runs || []).filter(run => run.head_sha === sha && run.event === 'workflow_dispatch');
  return workflows.map(workflow => {
    const matching = candidates.filter(run => workflowFileOf(run).endsWith(`/${workflow}`));
    const newest = matching.reduce((best, run) => (!best || Date.parse(run.created_at) > Date.parse(best.created_at) ? run : best), null);
    return { workflow, run: newest };
  });
}

const FAILED_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure', 'action_required', 'stale']);

const stateFor = run => {
  if (run.status !== 'completed') return 'pending';
  if (run.conclusion === 'cancelled') return 'error';
  if (FAILED_CONCLUSIONS.has(run.conclusion)) return 'failure';
  return 'success';
};

/**
 * The commit status for one selected run.
 *
 * @param {{workflow: string, run: object}} entry
 * @returns {{state: string, context: string, description: string, target_url: string}}
 */
export function commitStatusForRun({ workflow, run }) {
  const progress = run.status === 'completed' ? run.conclusion || 'completed' : run.status;
  return { state: stateFor(run), context: contextFor(workflow), description: truncate(`${run.name || workflow}: ${progress}`), target_url: run.html_url };
}

/**
 * The status for a workflow whose dispatched run never appeared.
 *
 * @param {string} workflow
 * @param {string} description
 */
export function missingRunStatus(workflow, description) {
  return { state: 'error', context: contextFor(workflow), description: truncate(description) };
}

/** True once every workflow has a run and every run has completed. */
export const allRunsCompleted = selected => selected.every(({ run }) => run?.status === 'completed');

/** Identifies a status, so an unchanged one is not posted again. */
export const statusKey = status => [status.context, status.state, status.description, status.target_url || ''].join('\u0000');
