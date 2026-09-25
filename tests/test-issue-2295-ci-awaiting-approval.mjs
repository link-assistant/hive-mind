#!/usr/bin/env node

/**
 * Regression tests for issue #2295 (root cause A).
 *
 * paranjko/external-test-lab#177 is a fork PR. Its `pull_request` workflows
 * ("Net deployment runbook", "Build status-site preview") were held for
 * maintainer approval: status=completed, conclusion=action_required, zero jobs,
 * no check-runs. A `pull_request_target` workflow ("Publish status-site
 * preview") ran and passed, so the combined CI status was "success" and
 * hive-mind posted "✅ Ready to merge — All CI checks have passed" although no
 * CI job had executed on the PR's code.
 *
 * The fixtures below are the workflow runs hive-mind saw during session 3
 * (2026-09-25, see docs/case-studies/issue-2295/data/logs). The runs became
 * `failure` only when the PR was closed at 2026-09-25T15:45:55Z.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2295
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { buildCiStatusLine, buildMergeReadinessComment, CI_AWAITING_APPROVAL_MARKER, findNonExecutedWorkflowRuns, getLatestRunPerWorkflow, getRunsAwaitingApproval } from '../src/ci-run-approval.lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`PASS: ${testName}`);
    testsPassed++;
  } else {
    console.log(`FAIL: ${testName}`);
    if (details) {
      console.log(`   Details: ${details}`);
    }
    testsFailed++;
  }
}

console.log('Testing issue #2295 CI runs awaiting fork approval');
console.log('='.repeat(70));

const RUNS_URL = 'https://github.com/paranjko/external-test-lab/actions/runs';
const run = (id, name, event, conclusion, createdAt, workflowId) => ({ id, name, event, status: 'completed', conclusion, created_at: createdAt, workflow_id: workflowId, html_url: `${RUNS_URL}/${id}` });

// Head f367f6f4 at 2026-09-25T03:59 (session 3, log line ~17553).
const headF367 = [run(36092527187, 'Net deployment runbook', 'pull_request', 'action_required', '2026-09-25T03:58:35Z', 1), run(36092524876, 'Publish status-site preview', 'pull_request_target', 'success', '2026-09-25T03:58:32Z', 2)];

// Head 633608e2 at 2026-09-25T03:44: three runbook runs, all awaiting approval.
const head6336 = [run(36091562242, 'Net deployment runbook', 'pull_request', 'action_required', '2026-09-25T03:44:11Z', 1), run(36090545301, 'Publish status-site preview', 'pull_request_target', 'success', '2026-09-25T03:29:13Z', 2), run(36043433032, 'Net deployment runbook', 'pull_request', 'action_required', '2026-09-24T18:45:17Z', 1), run(36041471897, 'Net deployment runbook', 'pull_request', 'action_required', '2026-09-24T18:28:27Z', 1), run(36041468961, 'Publish status-site preview', 'pull_request_target', 'success', '2026-09-24T18:28:25Z', 2)];

// 1. Detection on the real fixtures.
{
  const nonExecuted = findNonExecutedWorkflowRuns(headF367);
  assert(nonExecuted.length === 1 && nonExecuted[0].name === 'Net deployment runbook', 'f367f6f4: runbook run is detected as not executed', JSON.stringify(nonExecuted));
  assert(nonExecuted[0].url === `${RUNS_URL}/36092527187`, 'f367f6f4: link points to the held run');
  assert(getRunsAwaitingApproval(nonExecuted).length === 1, 'f367f6f4: run is awaiting approval');
}
{
  const nonExecuted = findNonExecutedWorkflowRuns(head6336);
  assert(nonExecuted.length === 1 && nonExecuted[0].url === `${RUNS_URL}/36091562242`, '633608e2: only the newest runbook run is reported', JSON.stringify(nonExecuted));
  assert(getLatestRunPerWorkflow(head6336).length === 2, '633608e2: one latest run per workflow/event');
}

// 2. A maintainer approved the newest run: older held runs must not block.
{
  const approved = [run(4, 'Net deployment runbook', 'pull_request', 'success', '2026-09-25T05:00:00Z', 1), ...head6336];
  assert(findNonExecutedWorkflowRuns(approved).length === 0, 'approved newest run clears the approval state');
}

// 3. Runs without created_at fall back to API order (newest first).
{
  const noDates = head6336.map(({ created_at: _createdAt, ...rest }) => rest);
  assert(findNonExecutedWorkflowRuns(noDates)[0]?.url === `${RUNS_URL}/36091562242`, 'without dates the first listed run is treated as newest');
}

// 4. Normal and edge cases.
assert(findNonExecutedWorkflowRuns([run(1, 'CI', 'pull_request', 'success', '2026-01-01T00:00:00Z', 1)]).length === 0, 'successful run is not reported');
assert(findNonExecutedWorkflowRuns([run(1, 'CI', 'pull_request', 'skipped', '2026-01-01T00:00:00Z', 1)]).length === 0, 'skipped run is a deliberate no-op, not reported');
assert(findNonExecutedWorkflowRuns([{ ...run(1, 'CI', 'pull_request', null, null, 1), status: 'in_progress' }]).length === 0, 'in-progress run is not reported');
assert(findNonExecutedWorkflowRuns(null).length === 0, 'null input is safe');
{
  const stale = findNonExecutedWorkflowRuns([run(1, 'CI', 'pull_request', 'stale', '2026-01-01T00:00:00Z', 1)]);
  assert(stale.length === 1 && getRunsAwaitingApproval(stale).length === 0, 'stale run is reported but is not awaiting approval');
}

// 5. Published wording.
{
  const nonExecuted = findNonExecutedWorkflowRuns(headF367);
  const ciLine = buildCiStatusLine({ nonExecutedWorkflowRuns: nonExecuted });
  assert(!ciLine.includes('All CI checks have passed'), 'CI line never claims that all checks passed', ciLine);
  assert(ciLine.includes('action_required') && ciLine.includes('Net deployment runbook'), 'CI line names the held workflow', ciLine);

  const comment = buildMergeReadinessComment({ readyMarker: 'Ready to merge', ciLine, nonExecutedWorkflowRuns: nonExecuted });
  assert(comment.awaitingApproval === true, 'comment reports awaiting approval');
  assert(comment.heading === `## ⏸️ ${CI_AWAITING_APPROVAL_MARKER}`, 'comment heading is not "Ready to merge"', comment.heading);
  assert(!comment.body.includes('Ready to merge') && !comment.body.includes('ready to be merged:'), 'comment body does not claim readiness', comment.body);
  assert(comment.body.includes(`${RUNS_URL}/36092527187`), 'comment links the held run');
}
{
  assert(buildCiStatusLine({}) === '- All CI checks have passed', 'executed CI keeps the old wording');
  assert(buildCiStatusLine({ noCiConfigured: true }) === '- No CI/CD checks are configured for this repository', 'no CI keeps the old wording');
  assert(buildCiStatusLine({ noCiTriggered: true, workflowRunConclusions: 'skipped' }) === '- CI workflows completed without executing (skipped)', 'not-triggered keeps the old wording');
  const ready = buildMergeReadinessComment({ readyMarker: 'Ready to merge', ciLine: '- All CI checks have passed' });
  assert(ready.heading === '## ✅ Ready to merge' && ready.body.includes('This pull request is now ready to be merged:\n- All CI checks have passed\n- No merge conflicts\n- No pending changes'), 'executed CI keeps the "Ready to merge" comment');
}

// 6. Source-level pins: the watch loop must use the helpers and not auto-merge.
{
  const helpers = await fs.readFile(path.join(repoRoot, 'src/solve.auto-merge-helpers.lib.mjs'), 'utf8');
  const loop = await fs.readFile(path.join(repoRoot, 'src/solve.auto-merge.lib.mjs'), 'utf8');
  assert(/nonExecutedWorkflowRuns = findNonExecutedWorkflowRuns\(workflowRuns\)/.test(helpers), 'getMergeBlockers checks executed runs on the "success" path');
  assert(/return \{ blockers, ciStatus, noCiConfigured: false, noCiTriggered: false, noWorkflowRunsForCommit, nonExecutedWorkflowRuns \}/.test(helpers), 'getMergeBlockers returns nonExecutedWorkflowRuns');
  assert(/if \(isAutoMerge && !ciAwaitingApproval\)/.test(loop), 'auto-merge is skipped while CI awaits approval');
  assert(!/'- All CI checks have passed'/.test(loop), 'watch loop no longer hard-codes "All CI checks have passed"');
  assert(/buildMergeReadinessComment\(/.test(loop), 'watch loop builds the readiness comment with the helper');
}

console.log('='.repeat(70));
console.log(`Passed: ${testsPassed}, Failed: ${testsFailed}`);
if (testsFailed > 0) {
  process.exit(1);
}
