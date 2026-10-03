#!/usr/bin/env node
/** An enabled workflow is healthy only if eligible issues receive real attempts. */
import { ghApi, ghList } from './github-actions.lib.mjs';
import { eligibleIssues, evaluateDraftHealth, isExecutedAttempt } from './formal-ai-draft-health.lib.mjs';
const repository = process.env.GITHUB_REPOSITORY;
const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
const issues = await ghList(`repos/${repository}/issues?state=all&since=${since}&per_page=100`);
const eligible = eligibleIssues(issues, since);
const pages = await ghApi(`repos/${repository}/actions/workflows/formal-ai-draft.yml/runs?created=%3E%3D${since}&per_page=100`, { paginate: true });
let attempts = 0;
for (const run of pages.flatMap(page => page.workflow_runs)) {
  if (!['issues', 'workflow_dispatch'].includes(run.event)) continue;
  const jobs = await ghApi(`repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`, { paginate: true });
  if (
    isExecutedAttempt(
      run,
      jobs.flatMap(page => page.jobs)
    )
  )
    attempts++;
}
const { healthy, report } = evaluateDraftHealth({ eligible: eligible.length, attempts });
console.log(report);
if (!healthy) {
  console.error('Eligible issues received no draft attempt; inspect credentials and workflow decisions.');
  process.exitCode = 1;
}
