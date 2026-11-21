#!/usr/bin/env node
/**
 * An enabled workflow is healthy only if eligible issues receive real attempts,
 * and those attempts do not keep failing the same way.
 */
import { ghApi, ghList } from './github-actions.lib.mjs';
import { DRAFT_STEP, eligibleIssues, evaluateDraftHealth, findRepeatedFailure, formatRepeatedFailureReport, isExecutedAttempt, runOutcomeFromAnnotations, trackingIssueSearchPhrase } from './formal-ai-draft-health.lib.mjs';
const repository = process.env.GITHUB_REPOSITORY;
const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
const issues = await ghList(`repos/${repository}/issues?state=all&since=${since}&per_page=100`);
const eligible = eligibleIssues(issues, since);
const pages = await ghApi(`repos/${repository}/actions/workflows/formal-ai-draft.yml/runs?created=%3E%3D${since}&per_page=100`, { paginate: true });
let attempts = 0;
const outcomes = [];
for (const run of pages.flatMap(page => page.workflow_runs)) {
  if (!['issues', 'workflow_dispatch'].includes(run.event)) continue;
  const pagesOfJobs = await ghApi(`repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`, { paginate: true });
  const jobs = pagesOfJobs.flatMap(page => page.jobs);
  if (isExecutedAttempt(run, jobs)) attempts++;
  const draftJob = jobs.find(job => job.steps?.some(step => step.name === DRAFT_STEP));
  const annotations = draftJob ? await ghList(`repos/${repository}/check-runs/${draftJob.id}/annotations?per_page=100`) : [];
  outcomes.push(runOutcomeFromAnnotations(run, annotations));
}
const { healthy, report } = evaluateDraftHealth({ eligible: eligible.length, attempts });
console.log(report);
if (!healthy) {
  console.error('Eligible issues received no draft attempt; inspect credentials and workflow decisions.');
  process.exitCode = 1;
}

const streak = findRepeatedFailure(outcomes);
if (streak) {
  const phrase = trackingIssueSearchPhrase(streak.key);
  let tracking = null;
  if (phrase) {
    const query = encodeURIComponent(`repo:${repository} is:issue is:open "${phrase.replace(/"/g, ' ')}"`);
    tracking = (await ghApi(`search/issues?q=${query}&per_page=1`).catch(() => null))?.items?.[0] ?? null;
  }
  console.error(formatRepeatedFailureReport(streak, tracking));
  process.exitCode = 1;
}
