/**
 * @hive-mind-test-suite default
 *
 * Issue #4091 (criteria a and b): a HEAD workflow run that never starts must
 * not hold the --auto-restart-until-mergeable loop for hours.
 *
 * Incident: every check passed and the PR was CLEAN, but one HEAD run sat in
 * GitHub's concurrency queue (`pending`, 0 jobs). The loop polled it 135 times
 * over 5 hours, reported nothing and decided nothing.
 *
 * These tests drive the stuck-CI monitor the way the watch loop does (one call
 * per check, a check every 5 minutes) with a fake clock and fake GitHub calls.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStuckCiMonitor } from '../src/solve.auto-merge-stuck-ci.lib.mjs';
import { RUN_KINDS, buildUnstartedRunNoticeComment, classifyIncompleteRun, decideUnstartedRunWait, summarizeUnstartedRuns } from '../src/github-ci-unstarted-runs.lib.mjs';
import { STOP_REASONS, describeStopReason } from '../src/automation-stop-reporting.lib.mjs';
import { CI_WAIT_STUCK_MARKER, isToolGeneratedComment } from '../src/tool-comments.lib.mjs';
import { createWatchProgress } from '../src/solve.watch-progress.lib.mjs';
import { stuckCiRuns } from '../src/config.lib.mjs';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const HEAD = 'abcdef1234567890';
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const START = Date.parse('2026-11-19T02:00:00Z');
const CHECK_INTERVAL = 5 * MINUTE;

const run = overrides => ({ id: 101, name: 'W', status: 'pending', conclusion: null, html_url: 'https://github.com/o/r/actions/runs/101', event: 'pull_request', createdAt: new Date(START - 4 * HOUR).toISOString(), runStartedAt: null, ...overrides });

/** The watch loop's view: one onPendingWorkflowRuns call per check until it says stop. */
const simulateWatch = async ({ headRun, maxChecks = 200, config = {} }) => {
  let clock = START;
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
    getWorkflowRunsForSha: async () => [headRun],
    getWorkflowRunJobsCount: async () => 0,
    cancelWorkflowRun: async (_o, _r, id) => (calls.push(`cancel:${id}`), { success: true }),
    rerunWorkflowRun: async (_o, _r, id) => (calls.push(`rerun:${id}`), { success: true }),
    config: { queuedMinutes: 30, rerunAttempts: 1, disagreeNoticeChecks: 3, ...config },
    statusDeps: { fetchImpl: async () => ({ ok: true, json: async () => ({ status: { indicator: 'none' }, components: [], incidents: [] }) }), cacheMs: 0 },
    now: () => clock,
  });
  const decisions = [];
  const firstCheckLines = [];
  for (let check = 1; check <= maxChecks; check++) {
    const before = lines.length;
    const decision = await monitor.onPendingWorkflowRuns({ sha: HEAD });
    if (check === 1) firstCheckLines.push(...lines.slice(before));
    decisions.push({ check, at: clock, decision });
    if (decision.action === 'stop') break;
    clock += CHECK_INTERVAL;
  }
  return { decisions, posted, calls, lines, firstCheckLines, monitor, endedAt: clock };
};

test('classification: pending with 0 jobs is a concurrency queue, waiting/action_required is an approval', () => {
  assert.equal(classifyIncompleteRun({ status: 'pending' }, 0), RUN_KINDS.CONCURRENCY_QUEUE);
  assert.equal(classifyIncompleteRun({ status: 'pending' }, null), RUN_KINDS.CONCURRENCY_QUEUE);
  assert.equal(classifyIncompleteRun({ status: 'pending' }, 2), RUN_KINDS.RUNNING);
  assert.equal(classifyIncompleteRun({ status: 'waiting' }, 0), RUN_KINDS.APPROVAL);
  assert.equal(classifyIncompleteRun({ status: 'action_required' }, 0), RUN_KINDS.APPROVAL);
  assert.equal(classifyIncompleteRun({ status: 'queued' }, 0), RUN_KINDS.GHOST_QUEUED, '#4048 still owns ghost queued runs');
  assert.equal(classifyIncompleteRun({ status: 'in_progress' }, 3), RUN_KINDS.RUNNING);
});

test('(a) pending, 0 jobs, created 4h ago, all checks passed: logged, one notice, explicit stop far below 24h, never cancelled or re-run', async () => {
  const { decisions, posted, calls, firstCheckLines, endedAt } = await simulateWatch({ headRun: run() });

  // The first check says what the run is, how old it is and that it has no jobs.
  const runLine = firstCheckLines.find(line => line.includes('Run state:'));
  assert.ok(runLine, `first check logs the run state: ${JSON.stringify(firstCheckLines)}`);
  assert.match(runLine, /not started: held by a concurrency queue \(pending\)/);
  assert.match(runLine, /0 jobs/);
  assert.match(runLine, /waiting 4h/);
  assert.match(runLine, /created 2026-11-18T22:00:00Z/);

  // Exactly one PR notice, posted on the first check (the run is past the 30 min threshold).
  assert.equal(posted.length, 1, 'one notice per commit');
  assert.match(posted[0], new RegExp(`## ⚠️ ${CI_WAIT_STUCK_MARKER}`));
  assert.match(posted[0], /held by a `concurrency` group \(status `pending`, no jobs\)/);
  assert.match(posted[0], /not cancelled or re-run automatically/);
  assert.match(posted[0], /Monitoring continues until 2026-11-19T02:15:00Z/);
  assert.ok(isToolGeneratedComment(posted[0]), 'the notice is never mistaken for human feedback');

  // An explicit stop decision with a reason and a message.
  const last = decisions.at(-1).decision;
  assert.equal(last.action, 'stop');
  assert.equal(last.reason, 'ci_not_started');
  assert.match(last.message, /waited 4h 15m in a concurrency queue \(status `pending`, no jobs\) and never started/);
  assert.ok(last.details.some(line => /W — not started: held by a concurrency queue/.test(line)));
  assert.ok(Object.hasOwn(STOP_REASONS, 'ci_not_started'), 'the stop is reported with its own reason');
  assert.notEqual(describeStopReason('ci_not_started').title, describeStopReason('unknown').title);

  // Within a bound far below 24h (the incident ran for 5h): 15 minutes of grace after the notice.
  const elapsed = endedAt - START;
  assert.ok(elapsed <= 30 * MINUTE, `decided after ${elapsed / MINUTE} min`);
  assert.ok(elapsed < (24 * HOUR) / 10);

  // Never cancelled, never re-run.
  assert.deepEqual(calls, []);
});

test('(a) a run younger than the notice threshold is waited for first, then gets the notice and a stop at the configured limit', async () => {
  const { decisions, posted, calls } = await simulateWatch({ headRun: run({ createdAt: new Date(START - 5 * MINUTE).toISOString() }) });
  const noticeCheck = decisions.find(entry => entry.decision.stopAt && entry.at - START >= 25 * MINUTE);
  assert.ok(noticeCheck, 'the notice comes once the run is 30 minutes old');
  assert.equal(posted.length, 1);
  const stop = decisions.at(-1);
  assert.equal(stop.decision.action, 'stop');
  // pendingStopMinutes (120) measured from the run's creation.
  assert.ok(stop.at - (START - 5 * MINUTE) >= stuckCiRuns.pendingStopMinutes * MINUTE);
  assert.ok(stop.at - START < 3 * HOUR);
  assert.deepEqual(calls, []);
});

for (const status of ['waiting', 'action_required']) {
  test(`(b) ${status}: "Approval needed" notice and stop, never cancelled or re-run`, async () => {
    const { decisions, posted, calls, firstCheckLines } = await simulateWatch({ headRun: run({ status }) });
    const runLine = firstCheckLines.find(line => line.includes('Run state:'));
    assert.match(runLine, new RegExp(`not started: approval needed \\(${status}\\)`));
    assert.match(runLine, /0 jobs/);
    assert.equal(posted.length, 1);
    assert.match(posted[0], /\*\*Approval needed\.\*\*/);
    assert.match(posted[0], /A maintainer has to approve these runs/);
    const last = decisions.at(-1).decision;
    assert.equal(last.action, 'stop');
    assert.equal(last.reason, 'ci_approval_required');
    assert.match(last.message, /^Approval needed: /);
    assert.ok(Object.hasOwn(STOP_REASONS, 'ci_approval_required'));
    assert.match(summarizeUnstartedRuns(last.runs), new RegExp(`approval needed \\(${status}\\)`));
    assert.deepEqual(calls, []);
  });
}

test('a run that is really running (jobs > 0) or a mix with a running run keeps the plain wait', () => {
  const runs = [
    { status: 'pending', kind: RUN_KINDS.CONCURRENCY_QUEUE, ageMs: 5 * HOUR },
    { status: 'in_progress', kind: RUN_KINDS.RUNNING, ageMs: 5 * HOUR },
  ];
  assert.equal(decideUnstartedRunWait({ runs, config: stuckCiRuns, now: START }).action, 'none');
});

test('HIVE_MIND_STUCK_PENDING_RUN_STOP_MINUTES=0 keeps waiting after the notice (no stop limit)', () => {
  const runs = [{ status: 'pending', kind: RUN_KINDS.CONCURRENCY_QUEUE, ageMs: 10 * HOUR }];
  const config = { pendingNoticeMinutes: 30, pendingStopMinutes: 0, pendingStopGraceMinutes: 15 };
  assert.equal(decideUnstartedRunWait({ runs, config, now: START }).action, 'notice');
  assert.equal(decideUnstartedRunWait({ runs, noticePostedAt: START, config, now: START + 48 * HOUR }).action, 'wait');
});

test('the notice text without a stop limit', () => {
  const body = buildUnstartedRunNoticeComment({ sha: HEAD, runs: [], kind: RUN_KINDS.CONCURRENCY_QUEUE, ageMs: HOUR, stopAt: null });
  assert.match(body, /Monitoring continues; this comment is posted once per commit\./);
});

test('the watch progress marker carries the unstarted-run blocker and its stop time as the deadline', () => {
  const emitted = [];
  const progress = createWatchProgress({ watchStartedAt: START, watchTimeoutHours: 24, emit: event => (emitted.push(event), event) });
  progress.startCheck(1);
  progress.report({ unstarted: { kind: RUN_KINDS.APPROVAL, summary: 'W approval needed (waiting), 0 jobs, for 4h', stopAt: START + 15 * MINUTE } });
  assert.equal(emitted[0].blocker, 'checking');
  assert.equal(emitted[1].blocker, 'ci_approval_required');
  assert.equal(emitted[1].detail, 'W approval needed (waiting), 0 jobs, for 4h');
  assert.equal(emitted[1].deadline, new Date(START + 15 * MINUTE).toISOString(), 'the earlier of the watch timeout and the stop time');
});

test('wiring: the watch loop reports the stop decision and passes quietProbe to the metadata check', () => {
  const src = readFileSync(join(srcDir, 'solve.auto-merge.lib.mjs'), 'utf8');
  assert.match(src, /stuckCiMonitor\.onPendingWorkflowRuns\(/);
  assert.match(src, /unstarted\?\.action === 'stop'[\s\S]{0,300}stopWatch\(unstarted\.reason, unstarted\.message, unstarted\.details\)/);
  assert.match(src, /checkForIssueMetadataChanges\([\s\S]{0,200}quietProbe\(\$\)/, '(g) the metadata probe stays quiet');
  assert.match(src, /`Check #\$\{iteration\}:`, currentTime\.toISOString\(\)/, '(g) check lines use ISO-8601 UTC');
  const monitorSrc = readFileSync(join(srcDir, 'solve.auto-merge-stuck-ci.lib.mjs'), 'utf8');
  const unstartedBlock = monitorSrc.slice(monitorSrc.indexOf('const handleUnstartedRuns'), monitorSrc.indexOf('return {', monitorSrc.indexOf('const handleUnstartedRuns')));
  assert.doesNotMatch(unstartedBlock, /cancelWorkflowRun|rerunWorkflowRun/, 'the unstarted-run path never cancels or re-runs');
});
