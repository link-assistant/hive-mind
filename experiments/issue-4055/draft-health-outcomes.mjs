#!/usr/bin/env node
/**
 * Replays scripts/formal-ai-draft-health.mjs and prints every outcome it feeds
 * to findRepeatedFailure, newest first, so a missed streak can be explained.
 * Usage: GITHUB_REPOSITORY=owner/repo node experiments/issue-4055/draft-health-outcomes.mjs [untilIso]
 */
import { ghApi, ghList } from '../../scripts/github-actions.lib.mjs';
import { DRAFT_STEP, findRepeatedFailure, runOutcomeFromAnnotations } from '../../scripts/formal-ai-draft-health.lib.mjs';
const repository = process.env.GITHUB_REPOSITORY || 'link-assistant/hive-mind';
const until = process.argv[2] ? new Date(process.argv[2]) : new Date();
const since = new Date(until.getTime() - 7 * 24 * 3600_000).toISOString();
const pages = await ghApi(`repos/${repository}/actions/workflows/formal-ai-draft.yml/runs?created=%3E%3D${since}&per_page=100`, { paginate: true });
const outcomes = [];
for (const run of pages.flatMap(page => page.workflow_runs)) {
  if (!['issues', 'workflow_dispatch'].includes(run.event) || new Date(run.created_at) > until) continue;
  const jobs = (await ghApi(`repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`, { paginate: true })).flatMap(page => page.jobs);
  const draftJob = jobs.find(job => job.steps?.some(step => step.name === DRAFT_STEP));
  const annotations = draftJob ? await ghList(`repos/${repository}/check-runs/${draftJob.id}/annotations?per_page=100`) : [];
  const outcome = runOutcomeFromAnnotations(run, annotations);
  outcomes.push(outcome);
}
outcomes.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
for (const o of outcomes) console.log([o.createdAt, o.conclusion, o.decisionCode, (o.firstError || '').slice(0, 90), o.url].join('\t'));
console.log('streak:', JSON.stringify(findRepeatedFailure(outcomes)));
