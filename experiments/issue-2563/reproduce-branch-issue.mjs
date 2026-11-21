#!/usr/bin/env node
/* global console */
// Issue #2563: which issue does solve pick for link-foundation/command-stream#206,
// and does the pre-merge issue-link gate pass? Uses only APIs present before and
// after the fix, so it can be run against both versions (offline, mocked GitHub).
import { checkIssueLinksBeforeMerge } from '../../src/issue-link-verification.lib.mjs';
import { resolveSolveMode } from '../../src/solve.mode.lib.mjs';
import { extractLinkedIssueNumber } from '../../src/github-linking.lib.mjs';

const owner = 'link-foundation';
const repo = 'command-stream';
const branch = 'issue-320-b2913f5b1c99';
const body = 'Fixes #205. Unblocks [link-assistant/agent#320](https://github.com/link-assistant/agent/issues/320).';
const responses = {
  'repos/link-foundation/command-stream/pulls/206': { body, head: { sha: 'b'.repeat(40), ref: branch }, base: { ref: 'main' } },
  'repos/link-foundation/command-stream': { default_branch: 'main' },
  'repos/link-foundation/command-stream/issues/205': { number: 205, body: '' },
  'repos/link-foundation/command-stream/issues/205/sub_issues': [[]],
  graphql: [{ data: { repository: { pullRequest: { closingIssuesReferences: { nodes: [{ number: 205, repository: { nameWithOwner: `${owner}/${repo}` } }] } } } } }],
};
const run = async args => {
  if (!(args[1] in responses)) throw Object.assign(new Error(`Command failed: gh api ${args[1]}`), { stderr: 'gh: Not Found (HTTP 404)' });
  return { code: 0, stdout: JSON.stringify(responses[args[1]]), stderr: '' };
};

const { issueNumber } = await resolveSolveMode({
  argv: {},
  owner,
  repo,
  urlNumber: 206,
  issueUrl: `https://github.com/${owner}/${repo}/pull/206`,
  isIssueUrl: false,
  isPrUrl: true,
  log: async message => console.log(`  log: ${message}`),
  safeExit: async () => {},
  reportError: console.error,
  cleanErrorMessage: e => e.message,
  githubLib: { ghPrView: async () => ({ code: 0, data: { headRefName: branch, body, headRepositoryOwner: { login: owner } } }) },
  processAutoContinueForIssue: async () => ({ isContinueMode: false }),
  handleMaintainerForkAccess: async () => {},
  extractLinkedIssueNumber, // only read by the pre-fix version
});
const { blocker } = await checkIssueLinksBeforeMerge({ owner, repo, prNumber: 206, issueNumber, run });
console.log(`issue selected by solve: #${issueNumber}`);
console.log(`pre-merge issue-link blocker: ${blocker ? `${blocker.reason} (${blocker.details.join('; ')})` : 'none'}`);
