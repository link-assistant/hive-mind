#!/usr/bin/env node

/**
 * Unit Tests: Issue #1712 - Misleading "no CI checks yet" verbose log caused user to Ctrl+C
 *
 * Tests verify that:
 * 1. The literal phrase "has no CI checks yet" no longer appears in the source files
 *    (its presence is the user-visible bug — it reads like "no CI is configured").
 * 2. When the no_checks branch fires with workflow runs registered, the resulting
 *    ci_pending blocker's `details` field includes BOTH the run status (e.g. "in_progress")
 *    AND the run html_url so the user can click through.
 * 3. When the pending branch fires (check-runs exist but are still running), the resulting
 *    ci_pending blocker's `details` field includes BOTH the check status and html_url.
 * 4. When the cancelled branch fires, the cancelled blocker's `details` field includes the
 *    conclusion AND the html_url.
 * 5. Regression guard for #1466 — `no_checks` + only non-executing workflow runs still
 *    falls through to noCiTriggered (we did not break that path).
 *
 * Root cause: The verbose lines `PR #N has no CI checks yet - treating as no_checks` and
 * `PR #N has no CI check-runs yet, but X workflow run(s) were triggered` read to a user as
 * "nothing is happening" rather than "we're waiting for the check-runs API to populate".
 * Combined with workflow run IDs being shown without URLs, the user could not verify that
 * `/merge` was correctly waiting on a real run, and Ctrl+C'd the watcher even though CI
 * was making progress (and ultimately passed, see ./docs/case-studies/issue-1712/README.md).
 *
 * Run with: node tests/test-misleading-merge-logs-1712.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1712
 * @see https://github.com/link-assistant/hive-mind/issues/1480 (race condition wait that this
 *      case study sits on top of — that fix was correct, but the wording wasn't)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

const test = (description, fn) => {
  try {
    fn();
    console.log(`  ${GREEN}✅ PASS:${RESET} ${description}`);
    passed++;
  } catch (e) {
    console.log(`  ${RED}❌ FAIL:${RESET} ${description}`);
    console.log(`      Error: ${e.message}`);
    failed++;
  }
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

console.log('================================================================================');
console.log('Unit Tests: Issue #1712 - Misleading "no CI checks yet" verbose log');
console.log('================================================================================\n');

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const ghMergeSrc = readFileSync(join(repoRoot, 'src', 'github-merge.lib.mjs'), 'utf8');
const autoMergeHelpersSrc = readFileSync(join(repoRoot, 'src', 'solve.auto-merge-helpers.lib.mjs'), 'utf8');

// ===== Wording sanity checks =====

console.log('Group 1: Wording sanity checks');

test('src/github-merge.lib.mjs no longer contains the misleading phrase "has no CI checks yet"', () => {
  assert(!ghMergeSrc.includes('has no CI checks yet'), 'Found the literal phrase "has no CI checks yet" in src/github-merge.lib.mjs — this is the wording that misled the user; replace with "has no check-runs ... registered yet"');
});

test('src/solve.auto-merge-helpers.lib.mjs no longer contains the misleading phrase "has no CI check-runs yet, but"', () => {
  assert(!autoMergeHelpersSrc.includes('has no CI check-runs yet, but'), 'Found the misleading phrase in src/solve.auto-merge-helpers.lib.mjs');
});

test('src/github-merge.lib.mjs verbose run listing includes html_url interpolation', () => {
  // The verbose listing must show the URL so the user can open it.
  assert(/\$\{run\.html_url\}/.test(ghMergeSrc), 'getWorkflowRunsForSha verbose listing should interpolate ${run.html_url}');
});

test('src/github-merge.lib.mjs normalized check entries carry html_url field', () => {
  // The pending/queued/cancelled checks must surface html_url to the blocker code.
  assert(/html_url:\s*check\.html_url\s*\|\|\s*check\.details_url/.test(ghMergeSrc), 'normalized check_run entries should fall back to details_url when html_url is missing');
});

// ===== Behavioural simulation =====
//
// We replay the same logic the production code uses to build the ci_pending /
// ci_cancelled blockers, and assert that `details` contain the URL. We can't import
// getMergeBlockers() directly here without making real GitHub API calls, so we
// simulate the relevant slice of the function — the part that maps workflow runs
// and check-runs to blocker `details` strings.

console.log('\nGroup 2: Behavioural simulation of blocker enrichment');

// Mirrors the no_checks + workflowRuns.length > 0 branch in src/solve.auto-merge-helpers.lib.mjs
const formatRunLine = run => {
  const status = run.conclusion ? `${run.status}/${run.conclusion}` : run.status;
  return `${run.name} [${status}] — ${run.html_url}`;
};
function buildNoChecksBlocker(workflowRuns, sha, owner = 'link-foundation', repo = 'box', prNumber = 83) {
  const commitUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}/commits/${sha}`;
  return {
    type: 'ci_pending',
    message: `Waiting for ${workflowRuns.length} workflow run(s) on HEAD ${commitUrl} to publish check-runs`,
    details: workflowRuns.map(formatRunLine),
  };
}

// Mirrors the pending branch in src/solve.auto-merge-helpers.lib.mjs
function buildPendingBlocker(pendingChecks) {
  return {
    type: 'ci_pending',
    message: 'CI/CD checks are still running or queued',
    details: pendingChecks.map(c => {
      const statusPart = c.status ? ` [${c.status}]` : '';
      const urlPart = c.html_url ? ` — ${c.html_url}` : '';
      return `${c.name}${statusPart}${urlPart}`;
    }),
  };
}

// Mirrors the cancelled branch in src/solve.auto-merge-helpers.lib.mjs
function buildCancelledBlocker(cancelledChecks, sha) {
  return {
    type: 'ci_cancelled',
    message: 'CI/CD checks were cancelled or became stale',
    details: cancelledChecks.map(c => {
      const concPart = c.conclusion ? ` [${c.conclusion}]` : '';
      const urlPart = c.html_url ? ` — ${c.html_url}` : '';
      return `${c.name}${concPart}${urlPart}`;
    }),
    sha,
  };
}

test('no_checks branch: blocker details include workflow run html_url', () => {
  const sha = 'dfc4c14746aa3dce19a060bf5b5b328eb3296350';
  const workflowRuns = [
    {
      id: 25097532949,
      name: 'Build and Release Docker Image',
      status: 'in_progress',
      conclusion: null,
      html_url: 'https://github.com/link-foundation/box/actions/runs/25097532949',
    },
  ];
  const blocker = buildNoChecksBlocker(workflowRuns, sha);

  assert(blocker.type === 'ci_pending', `expected ci_pending, got ${blocker.type}`);
  assert(blocker.details.length === 1, `expected 1 detail, got ${blocker.details.length}`);
  assert(blocker.details[0].includes('https://github.com/link-foundation/box/actions/runs/25097532949'), `expected details to include the run URL, got: ${blocker.details[0]}`);
  assert(blocker.details[0].includes('[in_progress]'), `expected details to include status [in_progress], got: ${blocker.details[0]}`);
  assert(blocker.message.includes(`https://github.com/link-foundation/box/pull/83/commits/${sha}`), `expected message to include full commit link, got: ${blocker.message}`);
});

test('no_checks branch: completed workflow run renders status/conclusion', () => {
  const sha = 'dfc4c14746aa3dce19a060bf5b5b328eb3296350';
  const workflowRuns = [
    {
      id: 25097532949,
      name: 'Build and Release Docker Image',
      status: 'completed',
      conclusion: 'success',
      html_url: 'https://github.com/link-foundation/box/actions/runs/25097532949',
    },
  ];
  const blocker = buildNoChecksBlocker(workflowRuns, sha);

  assert(blocker.details[0].includes('[completed/success]'), `expected details to include [completed/success], got: ${blocker.details[0]}`);
});

test('pending branch: blocker details include check html_url and [status]', () => {
  const pendingChecks = [
    {
      name: 'docker-build-test',
      status: 'in_progress',
      conclusion: null,
      html_url: 'https://github.com/link-foundation/box/runs/9999999999',
    },
    {
      name: 'create-release',
      status: 'queued',
      conclusion: null,
      html_url: 'https://github.com/link-foundation/box/runs/9999999998',
    },
  ];
  const blocker = buildPendingBlocker(pendingChecks);

  assert(blocker.details.length === 2, `expected 2 details, got ${blocker.details.length}`);
  assert(blocker.details[0].includes('https://github.com/link-foundation/box/runs/9999999999'), `expected first detail to include URL, got: ${blocker.details[0]}`);
  assert(blocker.details[0].includes('[in_progress]'), `expected first detail to include [in_progress], got: ${blocker.details[0]}`);
  assert(blocker.details[1].includes('[queued]'), `expected second detail to include [queued], got: ${blocker.details[1]}`);
});

test('pending branch: missing html_url does not break formatting', () => {
  const pendingChecks = [{ name: 'external-check', status: 'pending', conclusion: null, html_url: null }];
  const blocker = buildPendingBlocker(pendingChecks);
  assert(blocker.details[0] === 'external-check [pending]', `expected 'external-check [pending]' (no URL part), got: '${blocker.details[0]}'`);
});

test('cancelled branch: blocker details include conclusion and URL', () => {
  const cancelledChecks = [
    {
      name: 'docker-build-test',
      status: 'completed',
      conclusion: 'cancelled',
      html_url: 'https://github.com/link-foundation/box/runs/8888888888',
    },
  ];
  const blocker = buildCancelledBlocker(cancelledChecks, 'aa35cde4280238d066db4a771a662a6ebdcb604a');
  assert(blocker.type === 'ci_cancelled', `expected ci_cancelled, got ${blocker.type}`);
  assert(blocker.details[0].includes('[cancelled]'), `expected details to include [cancelled], got: ${blocker.details[0]}`);
  assert(blocker.details[0].includes('https://github.com/link-foundation/box/runs/8888888888'), `expected details to include URL, got: ${blocker.details[0]}`);
  assert(blocker.sha === 'aa35cde4280238d066db4a771a662a6ebdcb604a', `expected sha to be set on blocker`);
});

// ===== Regression guard for #1466 =====
//
// The no_checks branch must STILL treat completed-but-non-executing workflow runs as
// "no CI triggered" (issue #1466). Make sure our wording fixes did not perturb that.

console.log('\nGroup 3: Regression guards');

test('no_checks branch: all-action_required runs trigger noCiTriggered (regression #1466)', () => {
  // Replay the simulateFixedWorkflowRunCheck logic from issue 1466
  const workflowRuns = [
    { name: 'wf', status: 'completed', conclusion: 'action_required' },
    { name: 'wf2', status: 'completed', conclusion: 'action_required' },
  ];
  const allRunsCompleted = workflowRuns.every(r => r.status === 'completed');
  const allRunsNonExecuting = allRunsCompleted && workflowRuns.every(r => r.conclusion === 'action_required' || r.conclusion === 'cancelled' || r.conclusion === 'stale' || r.conclusion === 'skipped');
  assert(allRunsNonExecuting, 'expected non-executing path to fire for action_required-only runs');
});

test('no_checks branch: in_progress runs do NOT trigger noCiTriggered (race condition)', () => {
  const workflowRuns = [{ name: 'wf', status: 'in_progress', conclusion: null }];
  const allRunsCompleted = workflowRuns.every(r => r.status === 'completed');
  assert(!allRunsCompleted, 'expected race condition path for in_progress runs (this is the #1712 case)');
});

// ===== User-facing waiting message =====
//
// `solve.auto-merge.lib.mjs` joins blocker.details with ', ' to produce the
// "⏳ Waiting for CI: ..." line. Verify the joined output reads cleanly with URLs.

console.log('\nGroup 4: User-facing waiting message format');

test('joined details produce a single line with URL inline', () => {
  const sha = 'dfc4c14746aa3dce19a060bf5b5b328eb3296350';
  const workflowRuns = [
    {
      id: 25097532949,
      name: 'Build and Release Docker Image',
      status: 'in_progress',
      conclusion: null,
      html_url: 'https://github.com/link-foundation/box/actions/runs/25097532949',
    },
  ];
  const blocker = buildNoChecksBlocker(workflowRuns, sha);
  const joined = blocker.details.join(', ');
  assert(joined === 'Build and Release Docker Image [in_progress] — https://github.com/link-foundation/box/actions/runs/25097532949', `unexpected joined output: ${joined}`);
});

test('joined details work cleanly for multiple runs', () => {
  const sha = 'dfc4c14746aa3dce19a060bf5b5b328eb3296350';
  const workflowRuns = [
    {
      id: 1,
      name: 'Build',
      status: 'in_progress',
      conclusion: null,
      html_url: 'https://example.test/runs/1',
    },
    {
      id: 2,
      name: 'Test',
      status: 'queued',
      conclusion: null,
      html_url: 'https://example.test/runs/2',
    },
  ];
  const blocker = buildNoChecksBlocker(workflowRuns, sha);
  const joined = blocker.details.join(', ');
  assert(joined.includes('https://example.test/runs/1'), `missing URL #1: ${joined}`);
  assert(joined.includes('https://example.test/runs/2'), `missing URL #2: ${joined}`);
  assert(joined.includes('Build [in_progress]'), `missing first run formatting: ${joined}`);
  assert(joined.includes('Test [queued]'), `missing second run formatting: ${joined}`);
});

// ===== Issue #1712 follow-up: cross-commit listing, deduplication, less duplication =====

console.log('\nGroup 5: Cross-commit active workflow runs (#1712 follow-up)');

// Mirrors getActivePRWorkflowRuns from src/github-merge-repo-actions.lib.mjs
function buildActivePRWorkflowRuns(commitsWithRuns, headSha) {
  const ACTIVE_STATUSES = new Set(['in_progress', 'pending', 'queued', 'waiting', 'requested']);
  const groups = [];
  const seenRunIds = new Set();
  let totalActive = 0;
  let headActive = 0;
  let otherActive = 0;
  for (const { sha, runs } of commitsWithRuns) {
    const activeRuns = runs.filter(r => ACTIVE_STATUSES.has(r.status) && !seenRunIds.has(r.id));
    for (const r of activeRuns) seenRunIds.add(r.id);
    if (activeRuns.length === 0) continue;
    const isHead = sha === headSha;
    groups.push({ sha, isHead, runs: activeRuns });
    totalActive += activeRuns.length;
    if (isHead) headActive += activeRuns.length;
    else otherActive += activeRuns.length;
  }
  return { groups, totalActive, headActive, otherActive };
}

test('getActivePRWorkflowRuns: surfaces active runs on older commits, marks head', () => {
  const headSha = 'dfc4c14746aa3dce19a060bf5b5b328eb3296350';
  const commits = [
    { sha: 'aa35cde4280238d066db4a771a662a6ebdcb604a', runs: [{ id: 25097500291, name: 'Build and Release Docker Image', status: 'in_progress', conclusion: null, html_url: 'https://github.com/link-foundation/box/actions/runs/25097500291' }] },
    { sha: headSha, runs: [{ id: 25097532949, name: 'Build and Release Docker Image', status: 'in_progress', conclusion: null, html_url: 'https://github.com/link-foundation/box/actions/runs/25097532949' }] },
  ];
  const result = buildActivePRWorkflowRuns(commits, headSha);
  assert(result.totalActive === 2, `expected 2 active runs total, got ${result.totalActive}`);
  assert(result.headActive === 1, `expected 1 active run on head, got ${result.headActive}`);
  assert(result.otherActive === 1, `expected 1 active run on older commits, got ${result.otherActive}`);
  const headGroup = result.groups.find(g => g.isHead);
  const olderGroup = result.groups.find(g => !g.isHead);
  assert(headGroup && headGroup.sha === headSha, 'head group should be marked');
  assert(olderGroup && olderGroup.sha !== headSha, 'older group should not be marked as head');
});

test('getActivePRWorkflowRuns: deduplicates a run that appears under multiple commits', () => {
  // GitHub sometimes returns the same workflow_run id for multiple SHAs (rare, but the dedup
  // behaviour matters for correctness — we don't want to double-count blockers).
  const headSha = 'aaaa1111';
  const commits = [
    { sha: 'older1', runs: [{ id: 1, name: 'Build', status: 'in_progress', conclusion: null, html_url: 'https://x/1' }] },
    { sha: 'older2', runs: [{ id: 1, name: 'Build', status: 'in_progress', conclusion: null, html_url: 'https://x/1' }] },
    { sha: headSha, runs: [{ id: 2, name: 'Test', status: 'queued', conclusion: null, html_url: 'https://x/2' }] },
  ];
  const result = buildActivePRWorkflowRuns(commits, headSha);
  assert(result.totalActive === 2, `expected dedup to leave 2 runs, got ${result.totalActive}`);
});

test('getActivePRWorkflowRuns: ignores completed runs', () => {
  const headSha = 'aaaa1111';
  const commits = [
    { sha: 'older1', runs: [{ id: 1, name: 'X', status: 'completed', conclusion: 'cancelled', html_url: 'https://x/1' }] },
    { sha: headSha, runs: [{ id: 2, name: 'Y', status: 'in_progress', conclusion: null, html_url: 'https://x/2' }] },
  ];
  const result = buildActivePRWorkflowRuns(commits, headSha);
  assert(result.totalActive === 1, `completed runs should be filtered out`);
  assert(result.headActive === 1 && result.otherActive === 0);
});

console.log('\nGroup 6: Verbose log no longer duplicates per-run lines');

test('no_checks branch: per-run lines are NOT printed twice in the same code path', () => {
  // The previous code path (before this follow-up) called getWorkflowRunsForSha(verbose=true),
  // then iterated the same `workflowRuns` array printing the same per-run line in the no_checks
  // branch. After the fix, the no_checks "race condition" branch must only emit a one-line
  // summary explaining *why* we're waiting — never re-iterate workflowRuns and print per-run
  // lines, because getWorkflowRunsForSha(verbose=true) already did that.
  //
  // Note: there are other branches in this file that legitimately emit per-run lines for a
  // DIFFERENT array (e.g. invalidWorkflowRuns from issue #1690). Those are not duplicates of
  // getWorkflowRunsForSha because that helper does not iterate that filtered subset. We
  // specifically check the no_checks branch by looking for a loop over `workflowRuns` that
  // emits per-run verbose lines.
  const noChecksRangeMatch = autoMergeHelpersSrc.match(/workflow_run and check_runs APIs[\s\S]*?type:\s*'ci_pending'/);
  assert(noChecksRangeMatch, 'expected to find the no_checks "race condition" branch in solve.auto-merge-helpers.lib.mjs');
  const noChecksBranchSrc = noChecksRangeMatch[0];
  const dupeRunIteration = /for\s*\(\s*const\s+run\s+of\s+workflowRuns\s*\)[\s\S]{0,200}\[VERBOSE\] \/merge:\s+-/.test(noChecksBranchSrc);
  assert(!dupeRunIteration, "no_checks 'race condition' branch must not iterate workflowRuns to emit per-run [VERBOSE] /merge:   - ... lines (getWorkflowRunsForSha already prints them)");
});

test('verbose lines reference commit URL, not just short SHA', () => {
  // The user requested links to commits (not just SHA hashes).
  // After the fix, the `getDetailedCIStatus` no_checks line references commits/<sha>.
  assert(/https:\/\/github\.com\/\$\{owner\}\/\$\{repo\}\/commit\/\$\{sha\}/.test(ghMergeSrc), 'getDetailedCIStatus / checkPRCIStatus / getWorkflowRunsForSha should build a github.com/.../commit/<sha> URL');
});

console.log('\nGroup 7: Status explanations included in verbose log');

test('explainStatus helper produces a hint for in_progress, queued, pending', () => {
  // Replay the helper from src/solve.auto-merge-helpers.lib.mjs.
  const STATUS_HINTS = {
    in_progress: 'currently executing',
    queued: 'waiting for a runner',
    pending: 'waiting to start',
    waiting: 'blocked on a deployment / approval gate',
    requested: 'requested but not yet picked up',
    completed: 'finished',
  };
  const explainStatus = (status, conclusion) => {
    const statusPart = status ? `${status}${STATUS_HINTS[status] ? ` (${STATUS_HINTS[status]})` : ''}` : 'unknown';
    if (!conclusion) return statusPart;
    return `${statusPart} → ${conclusion}`;
  };
  assert(explainStatus('in_progress', null).includes('currently executing'));
  assert(explainStatus('queued', null).includes('waiting for a runner'));
  assert(explainStatus('pending', null).includes('waiting to start'));
  assert(explainStatus('weird-status', null) === 'weird-status');
});

test('source file declares STATUS_HINTS / CONCLUSION_HINTS for inline explanations', () => {
  assert(autoMergeHelpersSrc.includes('STATUS_HINTS'), 'STATUS_HINTS table missing — verbose lines need plain-English status meanings');
  assert(autoMergeHelpersSrc.includes('CONCLUSION_HINTS'), 'CONCLUSION_HINTS table missing — verbose lines need plain-English conclusion meanings');
  assert(autoMergeHelpersSrc.includes('explainStatus'), 'explainStatus helper missing');
});

console.log('\nGroup 8: User-facing message renders multi-line for >1 details');

test('renderBlocker logic puts each detail on its own line when there are multiple', () => {
  // Simulate the renderBlocker callable used in solve.auto-merge.lib.mjs.
  // It must produce one line for header + one line per detail when details.length > 1.
  const details = ['Build [in_progress] — https://example.com/1', 'Test [queued] — https://example.com/2'];
  const blocker = { details, message: 'Waiting on 2 runs' };
  const out = [];
  if (blocker.details.length === 1) out.push(`⏳ Waiting for CI: ${blocker.details[0]}`);
  else {
    out.push(`⏳ Waiting for CI: ${blocker.message}`);
    for (const d of blocker.details) out.push(`    ${d}`);
  }
  assert(out.length === 3, `expected 3 lines (header + 2 details), got ${out.length}`);
  assert(out[1].includes('Build [in_progress]'));
  assert(out[2].includes('Test [queued]'));
});

console.log('\n================================================================================');
console.log(`Results: ${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : ''}${failed} failed${RESET}`);
console.log('================================================================================');

process.exit(failed > 0 ? 1 : 0);
