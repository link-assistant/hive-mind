#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { cleanupStaleTestResources, cleanupTestRepositories } from './github-test-cleanup.lib.mjs';

const repository = process.env.GITHUB_REPOSITORY;
const layer = process.env.AUTOMATION_LAYER || 'default';
const dryRun = process.env.CLEANUP_DRY_RUN === 'true' || process.argv.includes('--dry-run');
const result = await cleanupStaleTestResources({ repository, dryRun });
await cleanupTestRepositories({ repository, layer, dryRun });
const summary = `GitHub credentials: layer ${layer}. ${dryRun ? 'Dry run' : 'Cleanup'}: ${result.branches.length} stale branches (${result.retainedBranches.length} retained by repository rules), ${result.issues.length} issues, ${result.pulls.length} pull requests.\n`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
