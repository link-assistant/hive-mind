/**
 * @hive-mind-test-suite default
 *
 * Issue #4048: "Our system stuck for long, and didn't announce `ready to merge`".
 *
 *  A. Out-of-band failure (private-repo PR, data redacted): a failed
 *     `workflow_dispatch` run on HEAD made the CheckRuns mechanism report
 *     `failure` forever while GitHub said the PR was CLEAN — 296 checks of
 *     "CI mechanisms DISAGREE".
 *  B. Ghost runs (link-foundation/link-cli PR 175, real data): 36 runs on three
 *     older commits stayed `queued` with zero jobs after the 2026-11-11 GitHub
 *     Actions incident — AllCommits waited for them for 88 checks.
 *  C. /stop: the watch loop kept starting new checks while the interrupt
 *     handler uploaded the log.
 *
 * Each "before" assertion reproduces the hang with the old call shape; each
 * "after" assertion is the fix.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCIConsensus, checkAllPRCommitsCI } from '../src/github-merge-repo-actions.lib.mjs';
import { decideGhostRunAction, describeConsensusDisagreement, findGhostQueuedRuns, partitionOutOfBandChecks, queuedForMs, retriggerGhostRuns, rerunSettledGhostRuns, createGhostRunState } from '../src/github-ci-stuck-runs.lib.mjs';
import { findIncidentsOverlapping, fetchProviderIncidents, parseStatuspageSummary, getProviderStatusPageUrl } from '../src/provider-status.lib.mjs';
import { buildStuckCiNoticeComment, createStuckCiMonitor } from '../src/solve.auto-merge-stuck-ci.lib.mjs';
import { CI_WAIT_STUCK_MARKER, isToolGeneratedComment, isToolStatusComment } from '../src/tool-comments.lib.mjs';
import { interruptibleSleep, isShutdownInProgress, markShutdownInProgress, parkIfShuttingDown, resetShutdownStateForTests } from '../src/interruptible-sleep.lib.mjs';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'case-studies', 'issue-4048', 'data');
const ghostEvidence = JSON.parse(readFileSync(join(dataDir, 'public-link-cli-pr175-ghost-runs.json'), 'utf8'));
const incidentEvidence = JSON.parse(readFileSync(join(dataDir, 'githubstatus-incidents-2026-11-10-to-13.json'), 'utf8'));

const CLEAN = { mergeable: true, mergeableState: 'MERGEABLE', mergeStateStatus: 'CLEAN' };
const quiet = { verbose: false };

// getWorkflowRunsForSha shape (src/github-merge.lib.mjs)
const toRun = raw => ({ id: raw.id, name: raw.name, status: raw.status, conclusion: raw.conclusion, html_url: raw.html_url, event: raw.event, checkSuiteId: raw.check_suite_id, createdAt: raw.created_at, runStartedAt: raw.run_started_at, updatedAt: raw.updated_at });

// ---------------------------------------------------------------- case A ---
const HEAD_A = 'a'.repeat(40);
const caseA = {
  ciStatus: {
    status: 'failure',
    sha: HEAD_A,
    hasPending: false,
    hasQueued: false,
    checks: [
      { name: 'test', status: 'completed', conclusion: 'success', checkSuiteId: 101 },
      { name: 'lint', status: 'completed', conclusion: 'success', checkSuiteId: 101 },
      { name: 'evals (manual)', status: 'completed', conclusion: 'failure', checkSuiteId: 202, html_url: 'https://github.com/owner/private-repo/actions/runs/2/job/1' },
    ],
  },
  runs: [
    { id: 1, name: 'CI', status: 'completed', conclusion: 'success', event: 'pull_request', checkSuiteId: 101 },
    { id: 2, name: 'Manual evals', status: 'completed', conclusion: 'failure', event: 'workflow_dispatch', checkSuiteId: 202, html_url: 'https://github.com/owner/private-repo/actions/runs/2' },
  ],
};
const caseADeps = {
  owner: 'owner',
  repo: 'private-repo',
  prNumber: 1,
  sha: HEAD_A,
  waitForAllRepoActionsFlag: false,
  ...quiet,
  getDetailedCIStatus: async () => caseA.ciStatus,
  getWorkflowRunsForSha: async () => caseA.runs,
  getCommitShas: async () => [HEAD_A],
};

test('case A before: the old call disagrees forever although GitHub says CLEAN', async () => {
  const consensus = await checkCIConsensus({ ...caseADeps, getDetailedCIStatus: async () => ({ ...caseA.ciStatus, checks: caseA.ciStatus.checks.map(({ checkSuiteId: _checkSuiteId, ...rest }) => rest) }) });
  assert.equal(consensus.allAgree, false);
  assert.match(consensus.reasons[0], /CheckRuns: failure — evals \(manual\) \(failure\)/);
});

test('case A after: a failed workflow_dispatch run on HEAD does not hold the merge', async () => {
  const consensus = await checkCIConsensus(caseADeps);
  assert.equal(consensus.allAgree, true);
  assert.equal(consensus.mechanisms.checkRunsAPI.outOfBandChecks.length, 1);
  assert.match(consensus.mechanisms.checkRunsAPI.note, /out-of-band workflow runs \(workflow_dispatch\)/);
});

test('case A after: CLEAN/MERGEABLE overrides a stale failure exactly like getMergeBlockers (#2031)', async () => {
  const unknownSuite = { ...caseA.ciStatus, checks: caseA.ciStatus.checks.map(check => ({ ...check, checkSuiteId: check.checkSuiteId === 202 ? 999 : check.checkSuiteId })) };
  assert.equal((await checkCIConsensus({ ...caseADeps, getDetailedCIStatus: async () => unknownSuite })).allAgree, false, 'no CLEAN state → still blocked');
  const consensus = await checkCIConsensus({ ...caseADeps, getDetailedCIStatus: async () => unknownSuite, mergeStatus: CLEAN });
  assert.equal(consensus.allAgree, true);
  assert.match(consensus.mechanisms.checkRunsAPI.note, /CLEAN\/MERGEABLE/);
  for (const mergeStatus of [
    { ...CLEAN, mergeStateStatus: 'UNSTABLE' },
    { ...CLEAN, mergeStateStatus: 'BLOCKED' },
  ]) {
    assert.equal((await checkCIConsensus({ ...caseADeps, getDetailedCIStatus: async () => unknownSuite, mergeStatus })).allAgree, false, mergeStatus.mergeStateStatus);
  }
  assert.equal((await checkCIConsensus({ ...caseADeps, getDetailedCIStatus: async () => ({ ...unknownSuite, hasQueued: true }), mergeStatus: CLEAN })).allAgree, false, 'queued checks keep blocking');
});

test('case A: a failing pull_request check is never treated as out-of-band', () => {
  const { outOfBand, relevant } = partitionOutOfBandChecks(
    [
      { name: 'test', conclusion: 'failure', checkSuiteId: 101 },
      { name: 'ext', conclusion: 'failure' },
    ],
    caseA.runs
  );
  assert.equal(outOfBand.length, 0);
  assert.deepEqual(
    relevant.map(check => check.name),
    ['test', 'ext']
  );
});

// ---------------------------------------------------------------- case B ---
const ghostRuns = ghostEvidence.runs.map(toRun);
const ghostShas = [...new Set(ghostRuns.map(run => run.id && ghostEvidence.runs.find(raw => raw.id === run.id).head_sha))];
const HEAD_B = ghostEvidence.headSha;
const headRunsB = [{ id: 9001, name: 'CI', status: 'completed', conclusion: 'success', event: 'pull_request', checkSuiteId: 1 }];
const STALL_TIME = Date.parse('2026-11-12T23:30:00Z'); // during the 88-check stall
const caseBDeps = {
  owner: 'link-foundation',
  repo: 'link-cli',
  prNumber: 175,
  sha: HEAD_B,
  waitForAllRepoActionsFlag: false,
  ...quiet,
  getDetailedCIStatus: async () => ({ status: 'success', checks: [], hasPending: false, hasQueued: false }),
  getWorkflowRunsForSha: async (_o, _r, sha) => (sha === HEAD_B ? headRunsB : ghostRuns.filter((_, index) => ghostEvidence.runs[index].head_sha === sha)),
  getCommitShas: async () => [...ghostShas, HEAD_B],
  now: STALL_TIME,
};

test('case B evidence: 36 runs on 3 older commits, all queued, never started', () => {
  assert.equal(ghostRuns.length, 36);
  assert.equal(ghostShas.length, 3);
  assert.ok(ghostRuns.every(run => run.status === 'queued' && run.runStartedAt === run.createdAt));
  assert.ok(Object.values(ghostEvidence.jobsTotalCountSampled).every(count => count === 0));
});

test('case B before: AllCommits waits forever for the ghost runs', async () => {
  const consensus = await checkCIConsensus(caseBDeps);
  assert.equal(consensus.allAgree, false);
  assert.deepEqual(consensus.mechanisms.allCommitsCI.pendingCommits, ['b12f92b', 'cc6008f', 'fd1065f']);
});

test('case B after: ghost runs on older commits are ignored and reported', async () => {
  const consensus = await checkCIConsensus({ ...caseBDeps, getWorkflowRunJobsCount: async () => 0, ghostMinAgeMs: 30 * 60 * 1000 });
  assert.equal(consensus.allAgree, true);
  assert.equal(consensus.mechanisms.allCommitsCI.ignoredGhostRuns.length, 36);
});

test('case B: runs that have jobs, are young, or whose job count is unknown keep blocking', async () => {
  const base = { ...caseBDeps, ghostMinAgeMs: 30 * 60 * 1000 };
  assert.equal((await checkCIConsensus({ ...base, getWorkflowRunJobsCount: async () => 3 })).allAgree, false, 'jobs exist → waiting for a runner');
  assert.equal((await checkCIConsensus({ ...base, getWorkflowRunJobsCount: async () => null })).allAgree, false, 'lookup failed');
  assert.equal((await checkCIConsensus({ ...base, getWorkflowRunJobsCount: async () => 0, now: Date.parse('2026-11-11T20:55:00Z') })).allAgree, false, 'too young');
});

test('case B: ghost runs on HEAD are never ignored, only reported for recovery', async () => {
  const headGhosts = ghostRuns.slice(0, 2);
  const consensus = await checkCIConsensus({ ...caseBDeps, getWorkflowRunsForSha: async () => headGhosts, getWorkflowRunJobsCount: async () => 0, ghostMinAgeMs: 60_000 });
  assert.equal(consensus.allAgree, false);
  assert.equal(consensus.mechanisms.workflowRunsAPI.ghostRuns.length, 2);
  assert.match(consensus.reasons.join('\n'), /2 stuck in queued with no jobs, oldest 26h 59m/);
});

test('checkAllPRCommitsCI keeps the old signature working', async () => {
  const result = await checkAllPRCommitsCI('o', 'r', 1, false, async () => [{ status: 'completed' }], { getCommitShas: async () => ['x'.repeat(40)] });
  assert.deepEqual(result.pendingCommits, []);
});

test('a re-run ghost is judged by its new attempt start, not its creation time', () => {
  assert.equal(queuedForMs({ createdAt: '2026-11-11T20:31:02Z', runStartedAt: '2026-11-12T23:20:00Z' }, STALL_TIME), 10 * 60 * 1000);
});

test('findGhostQueuedRuns ignores pending/waiting/in_progress runs', async () => {
  const runs = ['pending', 'waiting', 'in_progress', 'queued'].map((status, id) => ({ id, status, createdAt: '2026-11-11T20:00:00Z' }));
  const ghosts = await findGhostQueuedRuns(runs, { minAgeMs: 1, getJobsCount: async () => 0, now: STALL_TIME });
  assert.deepEqual(
    ghosts.map(run => run.status),
    ['queued']
  );
});

// --------------------------------------------------- GitHub status signals ---
test('githubstatus.com: the case B window overlaps the critical Actions incident', () => {
  const incidents = findIncidentsOverlapping(incidentEvidence, { tool: 'github', from: '2026-11-11T20:31:02Z', to: '2026-11-11T21:30:00Z' });
  assert.deepEqual(
    incidents.map(incident => incident.impact),
    ['critical']
  );
  assert.ok(incidents[0].components.includes('Actions'));
  assert.equal(findIncidentsOverlapping(incidentEvidence, { tool: 'github', from: '2026-11-11T20:27:00Z', to: '2026-11-11T20:30:00Z' }).length, 0, 'resolved minor Webhooks incident ends at 20:26');
  assert.ok(!findIncidentsOverlapping(incidentEvidence, { tool: 'github', from: '2026-11-13T00:00:00Z', to: '2026-11-13T23:00:00Z' }).some(incident => /Copilot/.test(incident.name)), 'Copilot-only incidents are not CI incidents');
});

test('githubstatus.com: summary with an active Actions incident means "wait for GitHub"', () => {
  assert.equal(getProviderStatusPageUrl('github'), 'https://www.githubstatus.com');
  const summary = { status: { indicator: 'major', description: 'Partial System Outage' }, components: [{ name: 'Actions', status: 'partial_outage' }], incidents: [{ name: 'Disruption with some GitHub services', status: 'investigating', impact: 'major', components: [{ name: 'Actions' }] }] };
  const status = parseStatuspageSummary(summary, { tool: 'github' });
  assert.equal(status.hasIssues, true);
  assert.equal(decideGhostRunAction({ ghostRuns: [{ id: 1 }], githubStatus: status }).action, 'wait-for-github');
  const copilotOnly = parseStatuspageSummary({ status: { indicator: 'minor' }, components: [{ name: 'Copilot', status: 'degraded_performance' }], incidents: [] }, { tool: 'github' });
  assert.equal(copilotOnly.hasIssues, false, 'unrelated products do not block recovery');
});

test('fetchProviderIncidents never throws and filters to the window', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => incidentEvidence });
  const result = await fetchProviderIncidents('github', { from: '2026-11-11T20:31:02Z', to: '2026-11-11T21:30:00Z', fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.incidents.length, 1);
  const failed = await fetchProviderIncidents('github', { from: 0, fetchImpl: async () => Promise.reject(new Error('offline')) });
  assert.deepEqual([failed.ok, failed.error], [false, 'offline']);
});

test('decideGhostRunAction: only re-trigger when GitHub is known healthy, and boundedly', () => {
  const runs = [{ id: 1 }, { id: 2 }];
  const healthy = { ok: true, hasIssues: false };
  assert.equal(decideGhostRunAction({ ghostRuns: [], githubStatus: healthy }).action, 'none');
  assert.equal(decideGhostRunAction({ ghostRuns: runs, githubStatus: { ok: false, error: 'HTTP 503' } }).action, 'wait-status-unknown');
  assert.equal(decideGhostRunAction({ ghostRuns: runs, githubStatus: { ok: false, error: 'disabled' } }).action, 'retrigger');
  assert.deepEqual(decideGhostRunAction({ ghostRuns: runs, githubStatus: healthy, attemptsByRun: new Map([['1', 2]]), maxAttempts: 2 }).runs, [{ id: 2 }]);
  assert.equal(
    decideGhostRunAction({
      ghostRuns: runs,
      githubStatus: healthy,
      attemptsByRun: new Map([
        ['1', 2],
        ['2', 2],
      ]),
      maxAttempts: 2,
    }).action,
    'exhausted'
  );
});

test('retrigger: cancel (force-cancel fallback), then re-run once completed', async () => {
  const calls = [];
  const state = createGhostRunState();
  const cancelWorkflowRun = async (_o, _r, id, { force }) => (calls.push(`${force ? 'force-cancel' : 'cancel'}:${id}`), { success: force || id === 1, forced: force });
  const results = await retriggerGhostRuns({
    runs: [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ],
    state,
    cancelWorkflowRun,
    owner: 'o',
    repo: 'r',
  });
  assert.deepEqual(calls, ['cancel:1', 'cancel:2', 'force-cancel:2']);
  assert.deepEqual(
    results.map(result => result.step),
    ['cancel', 'force-cancel']
  );
  const rerunWorkflowRun = async (_o, _r, id) => (calls.push(`rerun:${id}`), { success: true });
  await rerunSettledGhostRuns({
    state,
    runs: [
      { id: 1, status: 'completed' },
      { id: 2, status: 'queued' },
    ],
    rerunWorkflowRun,
    owner: 'o',
    repo: 'r',
  });
  assert.equal(calls.at(-1), 'rerun:1');
  assert.deepEqual([...state.awaitingRerun], ['2'], 'run 2 is re-run once GitHub reports it completed');
});

// ------------------------------------------------------- loop-side monitor ---
const statusDeps = health => ({
  fetchImpl: async url => ({ ok: true, json: async () => (url.endsWith('incidents.json') ? incidentEvidence : health) }),
  cacheMs: 0,
});
const healthy = { status: { indicator: 'none', description: 'All Systems Operational' }, components: [], incidents: [] };

const makeMonitor = (overrides = {}) => {
  const posted = [];
  const calls = [];
  const lines = [];
  const monitor = createStuckCiMonitor({
    owner: 'o',
    repo: 'r',
    prNumber: 7,
    log: async line => lines.push(line),
    formatAligned: (icon, label, text) => `${icon} ${label} ${text}`,
    postComment: async ({ body }) => posted.push(body),
    getWorkflowRunsForSha: async () => [],
    getWorkflowRunJobsCount: async () => 0,
    cancelWorkflowRun: async (_o, _r, id, { force }) => (calls.push(`${force ? 'force-cancel' : 'cancel'}:${id}`), { success: true, forced: force }),
    rerunWorkflowRun: async (_o, _r, id) => (calls.push(`rerun:${id}`), { success: true }),
    config: { queuedMinutes: 30, rerunAttempts: 1, disagreeNoticeChecks: 3 },
    statusDeps: statusDeps(healthy),
    now: () => STALL_TIME,
    ...overrides,
  });
  return { monitor, posted, calls, lines };
};

test('monitor: logs why consensus disagrees and posts one notice per commit after N checks', async () => {
  const { monitor, posted, lines } = makeMonitor();
  const consensus = await checkCIConsensus({ ...caseADeps, getDetailedCIStatus: async () => ({ ...caseA.ciStatus, checks: [{ name: 'test', conclusion: 'failure', status: 'completed' }] }) });
  for (let index = 0; index < 5; index++) await monitor.onDisagreement(consensus, { sha: HEAD_A });
  assert.ok(lines.some(line => /Reason: CheckRuns: failure — test \(failure\)/.test(line)));
  assert.equal(posted.length, 1);
  assert.match(posted[0], new RegExp(`## ⚠️ ${CI_WAIT_STUCK_MARKER}`));
  assert.match(posted[0], /for 3 consecutive checks/);
  assert.ok(isToolGeneratedComment(posted[0]) && isToolStatusComment(posted[0]), 'the notice must never be mistaken for human feedback');
});

test('monitor: HEAD ghost runs are cancelled and re-run when GitHub is healthy', async () => {
  const headGhost = { ...ghostRuns[0], id: 4242 };
  let headRuns = [headGhost];
  const { monitor, calls, lines } = makeMonitor({ getWorkflowRunsForSha: async () => headRuns });
  await monitor.onPendingWorkflowRuns({ sha: HEAD_B });
  assert.deepEqual(calls, ['cancel:4242']);
  assert.ok(
    lines.some(line => /GitHub incident overlaps: Impact across multiple GitHub products/.test(line)),
    'overlapping incidents are logged as evidence'
  );
  headRuns = [{ ...headGhost, status: 'completed', conclusion: 'cancelled' }];
  await monitor.onPendingWorkflowRuns({ sha: HEAD_B });
  assert.deepEqual(calls, ['cancel:4242', 'rerun:4242']);
});

test('monitor: HEAD ghost runs are left alone while GitHub reports an Actions incident', async () => {
  const outage = { status: { indicator: 'major' }, components: [{ name: 'Actions', status: 'major_outage' }], incidents: [] };
  const { monitor, calls, lines } = makeMonitor({ getWorkflowRunsForSha: async () => [ghostRuns[0]], statusDeps: statusDeps(outage) });
  await monitor.onPendingWorkflowRuns({ sha: HEAD_B });
  assert.deepEqual(calls, []);
  assert.ok(lines.some(line => /Waiting for GitHub/.test(line)));
});

test('monitor: exhausted re-trigger attempts post the notice right away', async () => {
  const { monitor, posted } = makeMonitor({ getWorkflowRunsForSha: async () => [ghostRuns[0]], config: { queuedMinutes: 30, rerunAttempts: 0, disagreeNoticeChecks: 15 } });
  await monitor.onPendingWorkflowRuns({ sha: HEAD_B });
  assert.equal(posted.length, 1);
  assert.match(posted[0], /Please re-run or cancel them manually/);
});

test('monitor: on agreement it resets the streak and names the ignored out-of-band check', async () => {
  const { monitor, lines } = makeMonitor();
  const disagreeing = { allAgree: false, reasons: ['CheckRuns: failure'], mechanisms: { checkRunsAPI: { complete: false, status: 'failure' } } };
  await monitor.onDisagreement(disagreeing, { sha: HEAD_A });
  assert.equal(monitor.state.streak.count, 1);
  await monitor.onAgreement(await checkCIConsensus(caseADeps));
  assert.equal(monitor.state.streak.count, 0);
  assert.ok(lines.some(line => /Out-of-band: evals \(manual\) \(failure, workflow_dispatch\) https:\/\/github.com\/owner\/private-repo\/actions\/runs\/2/.test(line)));
  assert.deepEqual(Object.keys(monitor.consensusOptions({ mergeStatus: CLEAN })).sort(), ['getWorkflowRunJobsCount', 'ghostMinAgeMs', 'mergeStatus']);
});

test('buildStuckCiNoticeComment lists every disagreeing mechanism', () => {
  const body = buildStuckCiNoticeComment({ sha: HEAD_B, reasons: describeConsensusDisagreement({ repoActions: { complete: false, count: 2 } }), checks: 15 });
  assert.match(body, /RepoActions: 2 active run\(s\)/);
});

// ---------------------------------------------------------------- case C ---
test('case C: once shutdown is in progress every sleep returns at once', async () => {
  resetShutdownStateForTests();
  assert.equal(isShutdownInProgress(), false);
  markShutdownInProgress('SIGTERM');
  const started = Date.now();
  assert.deepEqual(await interruptibleSleep(60_000), { interrupted: true });
  assert.ok(Date.now() - started < 1000);
  resetShutdownStateForTests();
  assert.deepEqual(await interruptibleSleep(1), { interrupted: false });
});

test('case C: parkIfShuttingDown returns at once normally and never returns during shutdown', async () => {
  resetShutdownStateForTests();
  const lines = [];
  await parkIfShuttingDown(async line => lines.push(line));
  assert.deepEqual(lines, []);
  markShutdownInProgress('SIGTERM');
  const parked = await Promise.race([parkIfShuttingDown(async line => lines.push(line), undefined, { park: () => new Promise(() => {}) }).then(() => 'returned'), new Promise(resolve => setTimeout(() => resolve('parked'), 50).unref())]);
  assert.equal(parked, 'parked');
  assert.match(lines[0], /SIGTERM received/);
  resetShutdownStateForTests();
});
