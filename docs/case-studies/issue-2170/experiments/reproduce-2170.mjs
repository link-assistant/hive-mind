#!/usr/bin/env node
/**
 * Minimal offline reproduction of issue #2170.
 *
 * The crash needs no GitHub access at all: it is fully determined by the state
 * `--auto-continue` returns when it resumes a leftover branch that has no pull
 * request (`isContinueMode: true`, `prNumber: null`), fed into the continue
 * mode block of src/solve.mjs.
 *
 * Run: node docs/case-studies/issue-2170/experiments/reproduce-2170.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2170
 */

import { buildGitHubPullRequestUrl, buildGitHubPullRequestUrlOrNull } from '../../../../src/github-url-parser.lib.mjs';

// Exactly what processAutoContinueForIssue() returned for the failing run.
const autoContinueResult = {
  isContinueMode: true,
  prNumber: null, // no pull request for the reused branch yet
  prBranch: 'issue-179-a1e31889c902',
  issueNumber: 179,
};
const owner = 'Payel-git-ol';
const repo = 'Octra';

console.log('auto-continue result:', autoContinueResult);

console.log('\n--- v2.12.5 behaviour (src/solve.mjs:542) ---');
try {
  const prUrl = buildGitHubPullRequestUrl({ owner, repo, number: autoContinueResult.prNumber });
  console.log('prUrl =', prUrl);
} catch (error) {
  console.log(`${error.name}: ${error.message}`);
  console.log('=> the whole solve run aborts right after branch checkout');
}

console.log('\n--- fixed behaviour ---');
const prUrl = buildGitHubPullRequestUrlOrNull({ owner, repo, number: autoContinueResult.prNumber });
console.log('prUrl =', prUrl, '=> handleAutoPrCreation() creates the pull request and fills it in');
