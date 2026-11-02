#!/usr/bin/env node
/**
 * An enabled workflow is healthy only if eligible issues receive real attempts,
 * and those attempts do not keep failing the same way.
 */
import { ghApi, ghList } from './github-actions.lib.mjs';
import { eligibleIssues, evaluateDraftHealth, findRepeatedFailure, formatRepeatedFailureReport, isExecutedAttempt, isRecordingJob, runOutcomeFromAnnotations, trackingIssueSearchPhrase } from './formal-ai-draft-health.lib.mjs';
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
  // Admission, the binary and the attempt each annotate their own job (#3909).
  const annotations = [];
  for (const job of jobs.filter(isRecordingJob)) annotations.push(...(await ghList(`repos/${repository}/check-runs/${job.id}/annotations?per_page=100`)));
  const outcome = runOutcomeFromAnnotations(run, annotations);
  if (isExecutedAttempt(run, jobs, outcome)) attempts++;
  outcomes.push(outcome);
}
const { healthy, report } = evaluateDraftHealth({ eligible: eligible.length, attempts });
console.log(report);
const endedBeforeSolve = outcomes.filter(outcome => outcome.attemptOutcome);
if (endedBeforeSolve.length) console.log(`${endedBeforeSolve.length} attempts ended before solve (deferred or identity mismatch); no model ran on them: ${endedBeforeSolve.map(outcome => outcome.url).join(' ')}`);
if (!healthy) {
  console.error('Eligible issues received no executed draft attempt; inspect credentials, workflow decisions and deferred attempts (a missing Formal AI binary or Hive Mind image, #3909).');
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
