/**
 * Issue #4048: keep the auto-restart-until-mergeable loop from waiting
 * silently forever on CI signals that will never change.
 *
 * The loop calls this monitor when
 *  - the multi-mechanism CI consensus disagrees (no merge blockers, but the
 *    consensus check refuses to declare the PR mergeable), and
 *  - getMergeBlockers reports `ci_pending` while every check run passed
 *    (a workflow run on HEAD is not completed, but none of its jobs exist).
 *
 * It then
 *  1. logs *why* the mechanisms disagree (which checks, which runs);
 *  2. finds HEAD workflow runs stuck in `queued` with no jobs ("ghost" runs
 *     left behind by a GitHub Actions incident), checks githubstatus.com,
 *     logs the incidents that overlap the time they were queued and, only
 *     when GitHub reports no active Actions/Webhooks incident, cancels and
 *     re-runs them (bounded by HIVE_MIND_STUCK_RUN_RERUN_ATTEMPTS). Runs that
 *     started on their own are never touched;
 *  3. after HIVE_MIND_CONSENSUS_DISAGREE_NOTICE_CHECKS identical consecutive
 *     disagreements, posts one PR comment per HEAD commit explaining what is
 *     holding the merge, instead of polling silently for 12+ hours.
 */

import { stuckCiRuns } from './config.lib.mjs';
import { createGhostRunState, decideGhostRunAction, describeConsensusDisagreement, findGhostQueuedRuns, formatDuration, retriggerGhostRuns, rerunSettledGhostRuns } from './github-ci-stuck-runs.lib.mjs';
import { fetchProviderIncidents, fetchProviderStatus, formatProviderStatusSummary } from './provider-status.lib.mjs';
import { CI_WAIT_STUCK_MARKER } from './tool-comments.lib.mjs';

/**
 * Pure: the PR comment posted when the CI wait has been stuck for a while.
 */
export const buildStuckCiNoticeComment = ({ sha, reasons = [], checks, ghostRuns = [], githubStatusLine = '', incidents = [], ghostAction = null }) => {
  const lines = [`## ⚠️ ${CI_WAIT_STUCK_MARKER}`, '', `The pull request is not announced as ready to merge because the CI signals for \`${String(sha || '').substring(0, 7) || 'HEAD'}\` have not agreed for ${checks} consecutive checks:`, ''];
  for (const reason of reasons) lines.push(`- ${reason}`);
  if (ghostRuns.length > 0) {
    lines.push('', 'Workflow runs stuck in `queued` with no jobs (they never started):', '');
    for (const run of ghostRuns.slice(0, 10)) lines.push(`- [${run.name}](${run.html_url}) — queued for ${formatDuration(run.queuedForMs || 0)}`);
  }
  if (githubStatusLine) lines.push('', `GitHub status: ${githubStatusLine}`);
  if (incidents.length > 0) {
    lines.push('', 'GitHub incidents that overlap the wait:', '');
    for (const incident of incidents.slice(0, 5)) lines.push(`- [${incident.name}](${incident.url}) (${incident.impact}, ${incident.status})`);
  }
  if (ghostAction === 'exhausted') lines.push('', 'Automatic cancel + re-run of the stuck runs did not help. Please re-run or cancel them manually.');
  lines.push('', 'Monitoring continues; this comment is posted once per commit.');
  return lines.join('\n');
};

/** Identity of a disagreement that ignores durations, so the streak survives ticking clocks. */
const disagreementKey = (sha, mechanisms) =>
  [
    sha,
    ...Object.entries(mechanisms || {})
      .filter(([, value]) => value && !value.skipped && value.complete === false)
      .map(([name]) => name),
  ].join('|');

export const createStuckCiMonitor = ({ owner, repo, prNumber, log, formatAligned, verbose = false, $, postComment, getWorkflowRunsForSha, getWorkflowRunJobsCount, cancelWorkflowRun, rerunWorkflowRun, config = stuckCiRuns, now = () => Date.now(), statusDeps = {} }) => {
  const ghostState = createGhostRunState();
  const ghostMinAgeMs = config.queuedMinutes * 60 * 1000;
  const notifiedShas = new Set();
  let streak = { key: null, count: 0 };
  let lastGhostSummary = { key: null, githubStatusLine: '', incidents: [], action: null };

  const say = (icon, label, text, indent = 2) => log(formatAligned(icon, label, text, indent));

  const recoverGhostRuns = async ({ ghostRuns, headRuns }) => {
    for (const result of await rerunSettledGhostRuns({ state: ghostState, runs: headRuns, rerunWorkflowRun, owner, repo, verbose })) {
      await say(result.ok ? '🔁' : '⚠️', 'Stuck run re-run:', `${result.name} (${result.runId}) ${result.ok ? 'started' : `failed: ${result.error}`}`);
    }
    if (ghostRuns.length === 0) return null;
    for (const run of ghostRuns) await say('👻', 'Stuck in queued:', `${run.name} — no jobs for ${formatDuration(run.queuedForMs)} — ${run.html_url}`);
    const githubStatus = await fetchProviderStatus('github', statusDeps);
    const githubStatusLine = formatProviderStatusSummary(githubStatus);
    if (githubStatusLine) await say('🌐', 'GitHub status:', githubStatusLine);
    const key = ghostRuns.map(run => `${run.id}:${run.runStartedAt || run.createdAt}`).join(',');
    if (key !== lastGhostSummary.key) {
      const from = Math.min(...ghostRuns.map(run => new Date(run.runStartedAt || run.createdAt).getTime()).filter(Number.isFinite));
      const incidents = Number.isFinite(from) ? await fetchProviderIncidents('github', { ...statusDeps, from, to: now() }) : { ok: false, incidents: [] };
      lastGhostSummary = { key, githubStatusLine, incidents: incidents.incidents || [], action: null };
      for (const incident of lastGhostSummary.incidents) await say('📰', 'GitHub incident overlaps:', `${incident.name} (${incident.impact}, ${incident.status}) ${incident.createdAt} → ${incident.resolvedAt || 'unresolved'} ${incident.url || ''}`);
    }
    lastGhostSummary.githubStatusLine = githubStatusLine;
    const decision = decideGhostRunAction({ ghostRuns, githubStatus, attemptsByRun: ghostState.attemptsByRun, maxAttempts: config.rerunAttempts });
    lastGhostSummary.action = decision.action;
    if (decision.action === 'wait-for-github') {
      await say('⏳', 'Waiting for GitHub:', 'an incident is active; stuck runs will be re-triggered only after it is resolved and only if they still have not started');
    } else if (decision.action === 'wait-status-unknown') {
      await say('⏳', 'Not re-triggering yet:', `githubstatus.com is unreachable (${decision.error}); an outage cannot be ruled out`);
    } else if (decision.action === 'exhausted') {
      await say('⚠️', 'Stuck runs not recovered:', config.rerunAttempts > 0 ? `re-triggered ${config.rerunAttempts} time(s) already; leaving them for a human` : 'automatic re-trigger is disabled (HIVE_MIND_STUCK_RUN_RERUN_ATTEMPTS=0)');
    } else if (decision.action === 'retrigger') {
      for (const result of await retriggerGhostRuns({ runs: decision.runs, state: ghostState, cancelWorkflowRun, owner, repo, verbose })) {
        await say(result.ok ? '🔄' : '⚠️', 'Stuck run cancelled:', `${result.name} (${result.runId}) via ${result.step}${result.ok ? ' — it will be re-run once GitHub reports it completed' : ` failed: ${result.error}`}`);
      }
    }
    return decision;
  };

  const trackStreak = async ({ sha, mechanisms, reasons, ghostRuns }) => {
    const key = disagreementKey(sha, mechanisms);
    streak = key === streak.key ? { key, count: streak.count + 1 } : { key, count: 1 };
    const exhausted = lastGhostSummary.action === 'exhausted' && ghostRuns.length > 0;
    if (!sha || notifiedShas.has(sha) || !(config.disagreeNoticeChecks > 0) || (streak.count < config.disagreeNoticeChecks && !exhausted)) return;
    notifiedShas.add(sha);
    const body = buildStuckCiNoticeComment({ sha, reasons, checks: streak.count, ghostRuns, githubStatusLine: lastGhostSummary.githubStatusLine, incidents: lastGhostSummary.incidents, ghostAction: lastGhostSummary.action });
    try {
      await postComment({ $, owner, repo, targetNumber: prNumber, body });
      await say('💬', 'Posted CI wait notice:', `signals disagreed for ${streak.count} consecutive checks`);
    } catch (error) {
      await say('⚠️', 'Could not post CI wait notice:', error?.message || String(error));
    }
  };

  return {
    ghostMinAgeMs,
    /** Extra checkCIConsensus options: the PR merge state and ghost-run detection. */
    consensusOptions: ({ mergeStatus = null } = {}) => ({ mergeStatus, getWorkflowRunJobsCount, ghostMinAgeMs }),
    /** Consensus disagreed although getMergeBlockers found nothing. */
    async onDisagreement(consensus, { sha }) {
      const reasons = consensus.reasons?.length ? consensus.reasons : describeConsensusDisagreement(consensus.mechanisms);
      for (const reason of reasons) await say('', 'Reason:', reason, 4);
      for (const ghost of consensus.mechanisms?.allCommitsCI?.ignoredGhostRuns || []) {
        await say('', 'Ignored ghost run:', `${ghost.sha.substring(0, 7)} ${ghost.name} — queued with no jobs for ${formatDuration(ghost.queuedForMs)}`, 4);
      }
      const ghostRuns = consensus.mechanisms?.workflowRunsAPI?.ghostRuns || [];
      await recoverGhostRuns({ ghostRuns, headRuns: consensus.workflowRuns || [] });
      await trackStreak({ sha, mechanisms: consensus.mechanisms, reasons, ghostRuns });
    },
    /** Every check run passed, but a HEAD workflow run is still not completed. */
    async onPendingWorkflowRuns({ sha }) {
      if (!sha) return;
      const headRuns = await getWorkflowRunsForSha(owner, repo, sha, false);
      const incomplete = headRuns.filter(run => run.status !== 'completed');
      const ghostRuns = await findGhostQueuedRuns(incomplete, { minAgeMs: ghostMinAgeMs, getJobsCount: runId => getWorkflowRunJobsCount(owner, repo, runId, false), now: now() });
      if (ghostRuns.length === 0 && ghostState.awaitingRerun.size === 0) {
        streak = { key: null, count: 0 };
        return;
      }
      await recoverGhostRuns({ ghostRuns, headRuns });
      if (ghostRuns.length === 0) return;
      const mechanisms = { workflowRunsAPI: { complete: false, total: headRuns.length, inProgress: incomplete.length, ghostRuns } };
      await trackStreak({ sha, mechanisms, reasons: describeConsensusDisagreement(mechanisms), ghostRuns });
    },
    /** The consensus agreed or the loop moved on: start counting from zero. */
    reset() {
      streak = { key: null, count: 0 };
    },
    /** The consensus agreed: reset, and say why a non-passing check did not hold the merge. */
    async onAgreement(consensus) {
      streak = { key: null, count: 0 };
      const note = consensus?.mechanisms?.checkRunsAPI?.note;
      if (note) await say('ℹ️', 'CheckRuns:', note);
      for (const check of consensus?.mechanisms?.checkRunsAPI?.outOfBandChecks || []) await say('', 'Out-of-band:', `${check.name} (${check.conclusion || check.status}, ${check.event}) ${check.workflowRunUrl || ''}`.trim(), 4);
    },
    // Exposed for tests.
    get state() {
      return { ghostState, streak, notifiedShas, lastGhostSummary };
    },
  };
};

export default { createStuckCiMonitor, buildStuckCiNoticeComment };
