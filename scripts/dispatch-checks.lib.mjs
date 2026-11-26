/**
 * Pure helpers for scripts/dispatch-checks.mjs.
 *
 * Issue #4149: the draft job (run 45618587462) failed with "Dispatched
 * release.yml, but no run appeared for <sha>" although the dispatched run
 * 45622194807 was created 3 seconds after the dispatch. The script looked the
 * run up with `gh run list --workflow --branch --event`, a filtered listing
 * that GitHub fills in eventually: it stayed empty for the whole 2-minute
 * window. The dispatch endpoint returns the created run itself when asked
 * (`return_run_details: true`, GitHub changelog 2026-02-19; gh >= 2.87.0 sends
 * it too), so the listing is now only a fallback, and a run that still cannot
 * be found is a warning: the dispatch succeeded, and report-checks posts a
 * failing commit status if the run really never starts.
 */

export const ALLOWED_CHECK_WORKFLOWS = Object.freeze(['release.yml', 'security.yml', 'links.yml', 'workflows.yml']);

/** How long the fallback lookup waits for the dispatched run, in polls. */
export const LOOKUP_ATTEMPTS = 36;
export const LOOKUP_INTERVAL_MS = 5000;

/**
 * Request body of `POST /repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches`.
 * @param {string} ref branch the workflow runs on
 */
export const dispatchRequestBody = ref => ({ ref, inputs: { mode: 'checks' }, return_run_details: true });

/**
 * Run URL from the dispatch response; empty when GitHub answered 204 (old
 * GHES, or the details were not returned).
 * @param {object|null} response parsed dispatch response
 */
export const dispatchedRunUrl = response => (typeof response?.html_url === 'string' ? response.html_url : '');

/**
 * Find the dispatched run in a `GET /repos/{o}/{r}/actions/runs?head_sha=` page.
 * @param {Array<object>} runs workflow_runs of the REST response
 * @param {{workflow: string, sha: string, started: number}} match
 */
export const findDispatchedRun = (runs, { workflow, sha, started }) => (runs || []).find(run => run?.head_sha === sha && run?.event === 'workflow_dispatch' && typeof run?.path === 'string' && run.path.replace(/@.*$/, '') === `.github/workflows/${workflow}` && Date.parse(run.created_at) >= started) || null;

/**
 * Annotation for a dispatch whose run could not be found.
 * @param {string} workflow
 * @param {string} sha
 */
export const missingRunWarning = (workflow, sha) => `::warning title=Dispatched run not found::Dispatched ${workflow} for ${sha}, but GitHub did not list the run yet; report-checks reports its result or a missing run.`;
