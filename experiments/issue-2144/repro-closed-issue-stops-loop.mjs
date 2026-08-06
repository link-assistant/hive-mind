#!/usr/bin/env node

/**
 * Reproduction: issue #2144 — a closed linked issue stopped the mergeable loop.
 *
 * Replays the exact GitHub state observed in the incident log
 * (docs/case-studies/issue-2144/data/runs/original-run.log.txt, lines 11419-11422):
 *
 *   - repository link-assistant/formal-ai            → reachable
 *   - pull request #927                              → open, mergeable, clean
 *   - head branch issue-905-84e37855d352             → present
 *   - base branch main                               → present
 *   - linked issue #905                              → closed (2026-08-05T00:16:20Z)
 *
 * Before the fix `checkGitHubTerminalState` answered `terminal: true` with
 * reason `issue_closed`, which made `--auto-restart-until-mergeable` print
 * "❌ GITHUB TARGET UNAVAILABLE" and exit 0 without posting a single comment.
 *
 * After the fix the same state is non-terminal and carries a merge blocker, so
 * the loop keeps working and only `--auto-merge` is held back.
 *
 * Usage: node experiments/issue-2144/repro-closed-issue-stops-loop.mjs
 */

import { checkGitHubTerminalState } from '../../src/github-terminal-state.lib.mjs';
import { buildAutoMergeBlockedComment, buildAutomationStopComment } from '../../src/automation-stop-reporting.lib.mjs';

const out = value => ({ toString: () => (typeof value === 'string' ? value : JSON.stringify(value)) });

const OWNER = 'link-assistant';
const REPO = 'formal-ai';
const PR_NUMBER = 927;
const ISSUE_NUMBER = 905;

const responses = [
  { includes: `repos/${OWNER}/${REPO} --jq`, stdout: { full_name: `${OWNER}/${REPO}`, default_branch: 'main' } },
  {
    includes: `repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}`,
    stdout: {
      number: PR_NUMBER,
      state: 'open',
      merged: false,
      mergeable: true,
      mergeable_state: 'clean',
      head: { ref: 'issue-905-84e37855d352', repo: { full_name: `${OWNER}/${REPO}` } },
      base: { ref: 'main', repo: { full_name: `${OWNER}/${REPO}` } },
    },
  },
  { includes: `repos/${OWNER}/${REPO}/branches/issue-905-84e37855d352`, stdout: { name: 'issue-905-84e37855d352' } },
  { includes: `repos/${OWNER}/${REPO}/branches/main`, stdout: { name: 'main' } },
  {
    includes: `repos/${OWNER}/${REPO}/issues/${ISSUE_NUMBER}`,
    stdout: { number: ISSUE_NUMBER, state: 'closed', closed_at: '2026-08-05T00:16:20Z' },
  },
];

const calls = [];
const runner = async (strings, ...values) => {
  const command = strings.reduce((acc, part, index) => `${acc}${part}${index < values.length ? String(values[index]) : ''}`, '');
  calls.push(command);
  const response = responses.find(entry => command.includes(entry.includes));
  if (!response) throw new Error(`Unexpected command: ${command}`);
  return { code: 0, stdout: out(response.stdout), stderr: out('') };
};

const result = await checkGitHubTerminalState({
  owner: OWNER,
  repo: REPO,
  issueNumber: ISSUE_NUMBER,
  prNumber: PR_NUMBER,
  commandRunner: runner,
});

console.log('GitHub probes issued:');
for (const call of calls) console.log(`  $ ${call.trim()}`);

console.log('\nTerminal state result:');
console.log(JSON.stringify({ terminal: result.terminal, reason: result.reason, mergeBlockers: result.mergeBlockers }, null, 2));

const failures = [];
if (result.terminal !== false) failures.push('regression: a closed linked issue still stops the mergeable loop');
if (result.mergeBlockers?.length !== 1) failures.push('regression: the closed issue is not reported as a merge blocker');
if (result.mergeBlockers?.[0]?.reason !== 'issue_closed') failures.push(`unexpected blocker reason: ${result.mergeBlockers?.[0]?.reason}`);

console.log('\nComment that --auto-merge now posts instead of stopping silently:');
console.log('--------------------------------------------------------------------------------');
console.log(buildAutoMergeBlockedComment({ blockers: result.mergeBlockers, issueNumber: ISSUE_NUMBER }));
console.log('--------------------------------------------------------------------------------');

console.log('\nComment that a real stop (a closed pull request) now posts:');
console.log('--------------------------------------------------------------------------------');
console.log(
  buildAutomationStopComment({
    reason: 'pull_request_closed',
    mode: 'auto-restart-until-mergeable',
    message: `Pull request #${PR_NUMBER} in ${OWNER}/${REPO} is closed without being merged.`,
    details: [],
  })
);
console.log('--------------------------------------------------------------------------------');

if (failures.length > 0) {
  console.error(`\n❌ ${failures.length} check(s) failed:`);
  for (const failure of failures) console.error(`   - ${failure}`);
  process.exit(1);
}

console.log('\n✅ Closed linked issue keeps the mergeable loop running and only holds back --auto-merge.');
