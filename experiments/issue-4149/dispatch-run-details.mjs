#!/usr/bin/env node
/**
 * Issue #4149, F2: does the workflow dispatch endpoint return the created run?
 *
 * dispatch-checks used to find the dispatched run in a filtered `gh run list`,
 * which stayed empty for 2 minutes in run 45618587462 although run
 * 45622194807 had been created 3 seconds after the dispatch. With
 * `return_run_details: true` the endpoint answers 200 with workflow_run_id,
 * run_url and html_url (older GHES answers 204 with no body).
 *
 * Dry run by default: prints the request. --dispatch really dispatches
 * (needs write access) and prints the response and what the run listing sees.
 *
 * Usage: node experiments/issue-4149/dispatch-run-details.mjs <owner/repo> <workflow.yml> <ref> [--dispatch]
 */
import { ghApi } from '../../scripts/github-actions.lib.mjs';
import { dispatchRequestBody, dispatchedRunUrl } from '../../scripts/dispatch-checks.lib.mjs';

const [repository, workflow, ref, flag] = process.argv.slice(2);
if (!repository || !workflow || !ref) {
  console.error('Usage: dispatch-run-details.mjs <owner/repo> <workflow.yml> <ref> [--dispatch]');
  process.exit(2);
}
const endpoint = `repos/${repository}/actions/workflows/${workflow}/dispatches`;
console.log(`POST ${endpoint}\n${JSON.stringify(dispatchRequestBody(ref))}`);
if (flag !== '--dispatch') process.exit(0);

const started = Date.now();
const response = await ghApi(endpoint, { method: 'POST', body: dispatchRequestBody(ref) });
console.log(`response after ${Date.now() - started} ms: ${JSON.stringify(response)}`);
console.log(`run from response: ${dispatchedRunUrl(response) || '(none: 204)'}`);
const listing = await ghApi(`repos/${repository}/actions/runs?event=workflow_dispatch&branch=${encodeURIComponent(ref)}&per_page=5`);
console.log(`listing right after the dispatch: ${(listing?.workflow_runs || []).map(run => run.id).join(', ') || '(empty)'}`);
