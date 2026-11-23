#!/usr/bin/env node
/**
 * Close stale task fixtures before removing their owned branches.
 *
 * CLEANUP_DRY_RUN=true            print the mutations instead of making them
 * CLEANUP_MAX_AGE_HOURS=24        age at which a fixture is stale
 * CLEANUP_TIME_BUDGET_MINUTES=10  stop cleanly and leave the rest for the next
 *                                 run, well before the 15-minute job timeout
 *                                 (issue #4025)
 * CLEANUP_VERBOSE=true            log every API call and its duration
 */
import { appendFileSync } from 'node:fs';
import { ghApi, ghList } from './github-actions.lib.mjs';
import { cleanupStaleFixtures } from './cleanup-task-fixtures.lib.mjs';
const repository = process.env.GITHUB_REPOSITORY;
if (!repository) throw new Error('GITHUB_REPOSITORY is required');
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
const budgetMinutes = Number(process.env.CLEANUP_TIME_BUDGET_MINUTES || 10);
const { errors } = await cleanupStaleFixtures({
  repository,
  api: ghApi,
  list: ghList,
  graphql: (query, variables) => ghApi('graphql', { method: 'POST', body: { query, variables } }),
  dryRun: process.env.CLEANUP_DRY_RUN === 'true',
  maxAgeHours: Number(process.env.CLEANUP_MAX_AGE_HOURS || 24),
  deadline: Date.now() + budgetMinutes * 60_000,
  verbose: process.env.CLEANUP_VERBOSE === 'true',
  appendSummary: text => summaryFile && appendFileSync(summaryFile, text),
});
if (errors.length) throw new Error(errors.join('\n'));
