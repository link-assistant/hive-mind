#!/usr/bin/env node
/** Close stale task fixtures before removing their owned branches. */
import { ghApi, ghList } from './github-actions.lib.mjs';
const repository = process.env.GITHUB_REPOSITORY;
if (!repository) throw new Error('GITHUB_REPOSITORY is required');
const dryRun = process.env.CLEANUP_DRY_RUN === 'true';
const cutoff = Date.now() - Number(process.env.CLEANUP_MAX_AGE_HOURS || 24) * 3600_000;
const stale = date => new Date(date).getTime() < cutoff;
const errors = [];
const mutate = async (endpoint, options) => {
  console.log(`${dryRun ? 'Would' : 'Will'} ${options.method} ${endpoint}`);
  if (!dryRun) {
    try {
      await ghApi(endpoint, options);
    } catch (error) {
      errors.push(`${endpoint}: ${error.message}`);
    }
  }
};
const branches = await ghList(`repos/${repository}/branches?per_page=100`);
const owned = [];
for (const branch of branches.filter(branch => /^e2e\/(hello-world|integration)\//.test(branch.name))) {
  const commit = await ghApi(`repos/${repository}/commits/${branch.commit.sha}`);
  if (stale(commit.commit.committer.date)) owned.push(branch.name);
}
for (const pr of await ghList(`repos/${repository}/pulls?state=open&per_page=100`)) {
  if (owned.includes(pr.base.ref) || owned.includes(pr.head.ref)) {
    await mutate(`repos/${repository}/pulls/${pr.number}`, { method: 'PATCH', body: { state: 'closed' } });
    if (pr.head.repo?.full_name === repository && !owned.includes(pr.head.ref)) owned.push(pr.head.ref);
  }
}
for (const issue of await ghList(`repos/${repository}/issues?state=open&labels=e2e-task&per_page=100`)) {
  if (!issue.pull_request && stale(issue.created_at)) await mutate(`repos/${repository}/issues/${issue.number}`, { method: 'PATCH', body: { state: 'closed' } });
}
for (const branch of owned.reverse()) await mutate(`repos/${repository}/git/refs/heads/${branch}`, { method: 'DELETE' });
console.log(`Stale fixture branches: ${owned.length}`);
if (errors.length) throw new Error(errors.join('\n'));
