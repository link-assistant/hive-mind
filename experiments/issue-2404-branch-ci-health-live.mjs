#!/usr/bin/env node
/**
 * Issue #2404 experiment: run the branch CI health check against the live repository.
 *
 *   node experiments/issue-2404-branch-ci-health-live.mjs [owner/repo] [branch-or-sha]
 *
 * Passing a SHA (e.g. 6702efe, the run-less 2.33.4 release bump that sat on top of the
 * failed cb3bb2d) replays what /merge saw at that point in time.
 */
import { checkBranchCIHealth } from '../src/github-merge-ci.lib.mjs';

const [slug = 'link-assistant/hive-mind', ref = 'main'] = process.argv.slice(2);
const [owner, repo] = slug.split('/');
const result = await checkBranchCIHealth(owner, repo, ref, {}, true);
console.log(JSON.stringify({ ...result, failedRuns: result.failedRuns.map(r => `${r.name}: ${r.conclusion} ${r.html_url}`), pendingRuns: result.pendingRuns.map(r => `${r.name}: ${r.status}`) }, null, 2));
