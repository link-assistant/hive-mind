#!/usr/bin/env node
// Issue #2891: which PR does the bot pick for the router #724/#725/#727/#728
// sessions? Replays the captured closedByPullRequestsReferences answers through
// the old rule (first linked PR) and the new one (the issue's own PR).
//   node experiments/issue-2891-session-pr-selection.mjs
import { readFileSync } from 'node:fs';
import { selectIssueOwnPullRequest } from '../src/session-monitor.lib.mjs';

const dataDir = new URL('../docs/case-studies/issue-2891/data/', import.meta.url);
const { repository } = JSON.parse(readFileSync(new URL('closing-references.json', dataDir))).data;
const planBody = JSON.parse(readFileSync(new URL('pr-721.json', dataDir))).body;

for (const issue of Object.values(repository)) {
  // GraphQL closing references carry no body; the plan PR's is the captured one.
  const linkedPRs = issue.closedByPullRequestsReferences.nodes.map(pr => ({ ...pr, body: pr.number === 721 ? planBody : `Fixes #${issue.number}` }));
  const ctx = { type: 'issue', owner: 'link-assistant', repo: 'router', number: issue.number };
  console.log(`#${issue.number}: old → ${linkedPRs[0].url}, new → ${selectIssueOwnPullRequest(linkedPRs, ctx, { verbose: process.argv.includes('--verbose') })}`);
}
