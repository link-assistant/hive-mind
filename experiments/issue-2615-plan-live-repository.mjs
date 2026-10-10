#!/usr/bin/env node
// Issue #2615: fetch live relations of every open issue of a repository and print hive's plan.
// Usage: node experiments/issue-2615-plan-live-repository.mjs link-assistant/calculator
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createIssueRelationsFetcher, planIssueQueue, describeWaitReasons } from '../src/hive.issue-relations.lib.mjs';

const execFileAsync = promisify(execFile);
const repo = process.argv[2] || 'link-assistant/calculator';
const { stdout } = await execFileAsync('gh', ['issue', 'list', '--repo', repo, '--state', 'open', '--limit', '1000', '--json', 'url']);
const urls = JSON.parse(stdout).map(issue => issue.url);
let queries = 0;
const fetchIssueRelations = createIssueRelationsFetcher({
  execGraphQL: query => {
    queries++;
    return execFileAsync('gh', ['api', 'graphql', '-f', `query=${query}`], { maxBuffer: 64 * 1024 * 1024 });
  },
  log: async message => console.log(message),
});
const relations = await fetchIssueRelations(urls);
const plan = planIssueQueue(urls, relations);
console.log(`${urls.length} open issues, ${relations.size} relation records, ${queries} GraphQL queries`);
for (const entry of plan.ready) console.log(`READY   ${entry.url} (critical path ${entry.criticalPath}, unblocks ${entry.unblocks})`);
for (const entry of plan.waiting) console.log(`WAITING ${entry.url}: ${describeWaitReasons(entry.url, entry.reasons)}`);
if (plan.cycles.length) console.log('CYCLES', plan.cycles);
