#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { ghApi } from './github-actions.lib.mjs';
import { ALLOWED_CHECK_WORKFLOWS, LOOKUP_ATTEMPTS, LOOKUP_INTERVAL_MS, dispatchRequestBody, dispatchedRunUrl, findDispatchedRun, missingRunWarning } from './dispatch-checks.lib.mjs';

if (process.env.TRIGGERS_WORKFLOWS === 'true') process.exit(0);
const ref = process.env.CHECKS_REF;
const repository = process.env.GITHUB_REPOSITORY;
// Verbose lookup output: DISPATCH_CHECKS_VERBOSE=true, or a re-run with debug logging.
const verbose = process.env.DISPATCH_CHECKS_VERBOSE === 'true' || process.env.RUNNER_DEBUG === '1';
if (!ref) throw new Error('dispatch-checks needs the pull request head branch');
const sha = (await ghApi(`repos/${repository}/commits/${encodeURIComponent(ref)}`)).sha;
const workflows = (process.env.CHECKS_WORKFLOWS || '').split(/[\s,]+/).filter(Boolean);
const allowed = new Set(ALLOWED_CHECK_WORKFLOWS);
for (const workflow of workflows) if (!allowed.has(workflow)) throw new Error(`Unknown checks workflow: ${workflow}`);

// Issue #4149: the run comes from the dispatch response; the run listing is a
// fallback that GitHub may fill in minutes later, so a miss is not an error.
const lookUpRun = async (workflow, started) => {
  for (let attempt = 0; attempt < LOOKUP_ATTEMPTS; attempt++) {
    const response = await ghApi(`repos/${repository}/actions/runs?head_sha=${sha}&event=workflow_dispatch&per_page=100`);
    const run = findDispatchedRun(response?.workflow_runs, { workflow, sha, started });
    if (verbose) console.log(`${workflow}: lookup ${attempt + 1}/${LOOKUP_ATTEMPTS} saw ${response?.workflow_runs?.length ?? 0} runs, match ${run?.html_url || 'none'}`);
    if (run) return run.html_url;
    await sleep(LOOKUP_INTERVAL_MS);
  }
  return '';
};

for (const workflow of workflows) {
  const started = Date.now() - 1000;
  const response = await ghApi(`repos/${repository}/actions/workflows/${workflow}/dispatches`, { method: 'POST', body: dispatchRequestBody(ref) });
  if (verbose) console.log(`${workflow}: dispatch response ${JSON.stringify(response)}`);
  const url = dispatchedRunUrl(response) || (await lookUpRun(workflow, started));
  if (!url) {
    console.log(missingRunWarning(workflow, sha));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- Dispatched checks ${workflow} on \`${ref}\`; the run was not listed yet.\n`);
    continue;
  }
  console.log(`${workflow}: ${url}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- Dispatched checks [${workflow}](${url}) on \`${ref}\`.\n`);
}
