#!/usr/bin/env node
/** Close stale task fixtures before removing their owned branches. */
import { appendFileSync } from 'node:fs';
import { ghApi, ghList } from './github-actions.lib.mjs';
import { cleanupStaleFixtures } from './cleanup-task-fixtures.lib.mjs';
const repository = process.env.GITHUB_REPOSITORY;
if (!repository) throw new Error('GITHUB_REPOSITORY is required');
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
const { errors } = await cleanupStaleFixtures({
  repository,
  api: ghApi,
  list: ghList,
  dryRun: process.env.CLEANUP_DRY_RUN === 'true',
  maxAgeHours: Number(process.env.CLEANUP_MAX_AGE_HOURS || 24),
  appendSummary: text => summaryFile && appendFileSync(summaryFile, text),
});
if (errors.length) throw new Error(errors.join('\n'));
