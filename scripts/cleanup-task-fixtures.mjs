#!/usr/bin/env node
/**
 * Recover unfinalized task issues and remove stale owned branches.
 *
 * CLEANUP_REPOSITORIES (comma separated) sweeps other task repositories the
 * token can write to, such as a consumer that runs the row runner itself;
 * this repository is always swept. CLEANUP_DRY_RUN=true only reports.
 */
import { appendFileSync } from 'node:fs';
import { gh, ghApi, ghList } from './github-actions.lib.mjs';
import { cleanupStaleFixtures } from './cleanup-task-fixtures.lib.mjs';
const repositories = [...new Set([process.env.GITHUB_REPOSITORY, ...(process.env.CLEANUP_REPOSITORIES || '').split(',')].map(repository => repository?.trim()).filter(Boolean))];
if (!repositories.length) throw new Error('GITHUB_REPOSITORY or CLEANUP_REPOSITORIES is required');
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
const errors = [];
for (const repository of repositories) {
  const result = await cleanupStaleFixtures({
    repository,
    api: ghApi,
    list: ghList,
    // Job logs are plain text; a missing or expired log proves nothing.
    readJobLog: (owner, jobId) => gh(['api', '--allow-escape-sequences', `repos/${owner}/actions/jobs/${jobId}/logs`]),
    dryRun: process.env.CLEANUP_DRY_RUN === 'true',
    maxAgeHours: Number(process.env.CLEANUP_MAX_AGE_HOURS || 24),
    appendSummary: text => summaryFile && appendFileSync(summaryFile, text),
  });
  errors.push(...result.errors.map(error => `${repository}: ${error}`));
  if (summaryFile && (result.finalized.length || result.preserved.length)) {
    const rows = [...result.finalized.map(issue => `| #${issue.number} | finalized \`${issue.outcome}\` | ${issue.proof} |`), ...result.preserved.map(issue => `| #${issue.number} | preserved (${issue.state}) | ${issue.reason} |`)];
    appendFileSync(summaryFile, `### Task issues in ${repository}\n\n| Issue | Action | Proof |\n|---|---|---|\n${rows.join('\n')}\n\n`);
  }
}
if (errors.length) throw new Error(errors.join('\n'));
