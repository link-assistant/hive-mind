#!/usr/bin/env node
/** Daily seven-day activity report for Formal AI drafts (issue #2323). */
import { appendFileSync } from 'node:fs';
import { githubList } from './github-api.lib.mjs';
import { assessDraftActivity } from './draft-activity.lib.mjs';

const repository = process.env.GITHUB_REPOSITORY;
if (!repository) throw new Error('GITHUB_REPOSITORY is required');
const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
const root = `repos/${repository}`;
const issues = await githubList(`${root}/issues?state=all&since=${since}&per_page=100`);
const runs = await githubList(`${root}/actions/workflows/formal-ai-draft.yml/runs?created=${encodeURIComponent(`>=${since}`)}&per_page=100`, 'workflow_runs');
const jobsByRun = {};
for (const run of runs) jobsByRun[run.id] = await githubList(`${root}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`, 'jobs');
const report = assessDraftActivity({ issues, runs, jobsByRun, since });
const summary = [`## Formal AI draft activity (last 7 days)`, '', `Eligible issues opened: ${report.eligibleIssues.length}. Executed draft runs: ${report.executed.length}.`, ...report.executed.map(run => `- [Run ${run.id}](${run.html_url}): ${run.conclusion || run.status}`), '', report.ok ? 'Draft activity check passed.' : 'ERROR: issues were opened, but no draft attempt executed. Inspect the Formal AI Draft workflow.', ''].join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
if (!report.ok) process.exitCode = 1;
