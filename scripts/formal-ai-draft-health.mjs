#!/usr/bin/env node
/** An enabled workflow is healthy only if eligible issues receive real attempts. */
import { ghApi, ghList } from './github-actions.lib.mjs';
import { decideDraft } from './formal-ai-draft.lib.mjs';
const repository = process.env.GITHUB_REPOSITORY;
const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
const issues = await ghList(`repos/${repository}/issues?state=all&since=${since}&per_page=100`);
const eligible = issues.filter(issue => issue.created_at >= since && decideDraft({ action: 'opened', issue: { ...issue, labels: issue.labels.filter(label => label.name !== 'formal-ai-draft') } }).run);
const pages = await ghApi(`repos/${repository}/actions/workflows/formal-ai-draft.yml/runs?created=%3E%3D${since}&per_page=100`, { paginate: true });
let attempts = 0;
for (const run of pages.flatMap(page => page.workflow_runs)) {
  if (!['issues', 'workflow_dispatch'].includes(run.event)) continue;
  const jobs = await ghApi(`repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`, { paginate: true });
  if (jobs.flatMap(page => page.jobs).some(job => job.steps?.some(step => step.name === 'Open the Formal AI draft' && step.started_at && step.conclusion !== 'skipped'))) attempts++;
}
const report = `Formal AI draft health (7 days): ${eligible.length} eligible issues, ${attempts} executed attempts.`;
console.log(report);
if (eligible.length && !attempts) {
  console.error('Eligible issues received no draft attempt; inspect credentials and workflow decisions.');
  process.exitCode = 1;
}
