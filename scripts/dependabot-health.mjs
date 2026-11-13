#!/usr/bin/env node
/** Fails when an open Dependabot pull request keeps newer updates from being proposed (issue #4055). */
import { ghList } from './github-actions.lib.mjs';
import { findStuckDependabotPullRequests, formatStuckReport } from './dependabot-health.lib.mjs';

const repository = process.env.GITHUB_REPOSITORY;
const pulls = await ghList(`repos/${repository}/pulls?state=open&per_page=100`);
const stuck = findStuckDependabotPullRequests(pulls);
const own = pulls.filter(pull => pull.user?.login === 'dependabot[bot]').length;
console.log(`Dependabot health: ${own} open Dependabot pull request(s), ${stuck.length} stuck.`);
if (stuck.length) {
  console.error(formatStuckReport(stuck));
  for (const pull of stuck) console.log(`::error title=Stuck Dependabot pull request::#${pull.number} ${pull.reasons.join('; ')}`);
  process.exitCode = 1;
}
