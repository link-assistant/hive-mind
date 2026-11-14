#!/usr/bin/env node
/**
 * Issue #4048 probe: find "ghost" workflow runs on a pull request (status
 * `queued`, zero jobs) and print the githubstatus.com incidents that overlap
 * them. This is how the case B evidence in
 * docs/case-studies/issue-4048/data/public-link-cli-pr175-ghost-runs.json was
 * collected.
 *
 * Usage:
 *   node experiments/issue-4048-probe-ghost-runs.mjs [owner/repo] [pr]
 *   node experiments/issue-4048-probe-ghost-runs.mjs link-foundation/link-cli 175
 *
 * Needs an authenticated `gh` CLI. Read-only: it never cancels or re-runs.
 */
import { execFileSync } from 'node:child_process';
import { findGhostQueuedRuns, formatDuration } from '../src/github-ci-stuck-runs.lib.mjs';
import { fetchProviderIncidents, fetchProviderStatus, formatProviderStatusSummary } from '../src/provider-status.lib.mjs';

const [repoArg = 'link-foundation/link-cli', prArg = '175'] = process.argv.slice(2);
const gh = args => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

const commits = gh(['api', `repos/${repoArg}/pulls/${prArg}/commits`, '--paginate', '--slurp']).flat();
console.log(`${repoArg}#${prArg}: ${commits.length} commits`);

const runs = [];
for (const commit of commits) {
  const page = gh(['api', `repos/${repoArg}/actions/runs?head_sha=${commit.sha}&per_page=100`]);
  for (const run of page.workflow_runs || []) {
    runs.push({ id: run.id, name: run.name, sha: commit.sha, status: run.status, event: run.event, html_url: run.html_url, createdAt: run.created_at, runStartedAt: run.run_started_at });
  }
}
const incomplete = runs.filter(run => run.status !== 'completed');
console.log(`${runs.length} workflow runs, ${incomplete.length} not completed`);

const ghosts = await findGhostQueuedRuns(incomplete, {
  minAgeMs: 30 * 60 * 1000,
  getJobsCount: async runId => gh(['api', `repos/${repoArg}/actions/runs/${runId}/jobs`]).total_count,
});
for (const run of ghosts) console.log(`  ghost: ${run.sha.slice(0, 7)} ${run.name} queued ${formatDuration(run.queuedForMs)} ${run.html_url}`);
console.log(`${ghosts.length} ghost run(s) (queued, zero jobs, older than 30m)`);

console.log(`GitHub now: ${formatProviderStatusSummary(await fetchProviderStatus('github')) || 'n/a'}`);
if (ghosts.length > 0) {
  const from = Math.min(...ghosts.map(run => Date.parse(run.runStartedAt || run.createdAt)));
  const { ok, incidents, error } = await fetchProviderIncidents('github', { from, to: Date.now() });
  if (!ok) console.log(`githubstatus.com incidents unavailable: ${error}`);
  for (const incident of incidents) console.log(`  incident: ${incident.createdAt} → ${incident.resolvedAt || 'unresolved'} [${incident.impact}] ${incident.name} ${incident.url || ''}`);
}
