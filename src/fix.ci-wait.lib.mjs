/**
 * Wait for the default branch CI/CD before `/fix` starts `/solve` (issue #3326).
 *
 * `/fix` creates its issue as soon as the repository was inspected, so the user
 * gets the link right away. Starting the AI work while the default branch is
 * still being built, however, makes the solver reason about runs that are about
 * to change, and a fix branch created from a moving default branch. `/fix` now
 * waits until no Actions run is pending on the default branch (bounded by a
 * timeout), reporting every poll through `[HIVE-MIND FIX]` markers so the
 * Telegram reply can show a separate "waiting for CI/CD" status.
 */

import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { dedupeRunsByWorkflow } from './fix.ci-cd.lib.mjs';
import { getActiveWorkflows, getBranchRunsSnapshot, runCommand } from './fix.github.lib.mjs';
import { writeSanitizedPublicationFile } from './token-sanitization.lib.mjs';

/** Same "not finished yet" statuses `github-branch-ci-health.lib.mjs` uses. */
export const FIX_CI_PENDING_STATUSES = Object.freeze(['in_progress', 'queued', 'waiting', 'requested', 'pending']);
export const FIX_CI_WAIT_POLL_INTERVAL_MS = 30 * 1000;
/** Consecutive failed polls after which the state is reported as unknown. */
export const FIX_CI_WAIT_MAX_FAILED_POLLS = 3;

export function isPendingRun(run) {
  return FIX_CI_PENDING_STATUSES.includes(run?.status);
}

/** Pending runs of active workflows, newest first, as `{ id, name, status, html_url }`. */
export function selectPendingRuns(runs, activeWorkflowIds = null) {
  const list = Array.isArray(runs) ? runs : [];
  return list
    .filter(isPendingRun)
    .filter(run => !activeWorkflowIds || activeWorkflowIds.size === 0 || run.workflow_id == null || activeWorkflowIds.has(run.workflow_id))
    .map(run => ({ id: run.id ?? null, name: run.name || (run.workflow_id != null ? `workflow ${run.workflow_id}` : 'workflow'), status: run.status, html_url: run.html_url || null }));
}

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Poll the default branch until no Actions run is pending.
 *
 * Resolves (never rejects) with `{ outcome, pending, runs, polls, waitedMs }`:
 * - `idle`     nothing was pending on the first poll (no wait at all);
 * - `finished` runs were pending and have all completed;
 * - `timeout`  runs were still pending after `timeoutMs`;
 * - `unknown`  the runs could not be listed `maxFailedPolls` times in a row.
 *
 * `onProgress` is called after every poll that still has pending runs.
 */
export async function waitForDefaultBranchCi({ repository, branch, run = runCommand, warn = message => console.warn(message), timeoutMs, intervalMs = FIX_CI_WAIT_POLL_INTERVAL_MS, maxFailedPolls = FIX_CI_WAIT_MAX_FAILED_POLLS, sleep = defaultSleep, now = Date.now, onProgress = null, verbose = false, log = message => console.log(message) }) {
  const startedAt = now();
  if (!branch) return { outcome: 'unknown', pending: [], runs: [], polls: 0, waitedMs: 0 };
  const activeWorkflows = await getActiveWorkflows(repository, run, warn);
  const activeWorkflowIds = Array.isArray(activeWorkflows) ? new Set(activeWorkflows.map(workflow => workflow.id)) : null;
  let polls = 0;
  let failedPolls = 0;
  let sawPending = false;
  let lastRuns = [];
  let lastPending = [];

  for (;;) {
    polls += 1;
    const runs = await getBranchRunsSnapshot(repository, branch, run, warn);
    const waitedMs = now() - startedAt;
    if (runs === null) {
      failedPolls += 1;
      if (verbose) log(`[VERBOSE] [fix-ci-wait] poll ${polls}: could not list runs (${failedPolls}/${maxFailedPolls} consecutive failures)`);
      if (failedPolls >= maxFailedPolls) return { outcome: 'unknown', pending: lastPending, runs: lastRuns, polls, waitedMs };
    } else {
      failedPolls = 0;
      lastRuns = runs;
      lastPending = selectPendingRuns(runs, activeWorkflowIds);
      if (verbose) log(`[VERBOSE] [fix-ci-wait] poll ${polls}: ${runs.length} run(s) on ${branch}, ${lastPending.length} pending${lastPending.length ? `: ${lastPending.map(item => `${item.name}=${item.status}`).join(', ')}` : ''}`);
      if (lastPending.length === 0) return { outcome: sawPending ? 'finished' : 'idle', pending: [], runs, polls, waitedMs };
      sawPending = true;
      await onProgress?.({ pending: lastPending, waitedMs, polls });
    }
    if (waitedMs >= timeoutMs) return { outcome: 'timeout', pending: lastPending, runs: lastRuns, polls, waitedMs };
    await sleep(Math.max(0, Math.min(intervalMs, timeoutMs - waitedMs)));
  }
}

/**
 * Markdown comment for the created issue with the CI/CD results the wait
 * ended with. The issue body was generated while those runs were still going,
 * so without it the solver would only see their stale "in progress" state.
 */
export function buildCiWaitResultComment({ branch, result }) {
  const latest = dedupeRunsByWorkflow((result?.runs || []).filter(run => run?.status === 'completed' || isPendingRun(run)));
  const lines = [];
  if (result?.outcome === 'timeout') {
    lines.push(`## CI/CD on \`${branch}\` was still running when work started`, '', `\`/fix\` waited ${Math.round((result.waitedMs || 0) / 60000)} minute(s) for the default branch CI/CD, then started the task anyway. Re-check these runs before relying on them:`);
  } else {
    lines.push(`## CI/CD on \`${branch}\` finished before work started`, '', 'The runs listed in the issue description were still in progress when it was created. Their latest results:');
  }
  lines.push('');
  if (latest.length === 0) lines.push('_No runs found._');
  for (const run of latest) {
    const state = run.status === 'completed' ? run.conclusion || 'completed' : run.status;
    const name = run.name || 'workflow';
    lines.push(`- ${run.html_url ? `[${name}](${run.html_url})` : name}: \`${state}\`${run.head_sha ? ` at \`${String(run.head_sha).slice(0, 7)}\`` : ''}`);
  }
  return lines.join('\n');
}

/** Best effort: a failed comment never blocks starting `/solve`. */
export async function commentCiWaitResult({ issueUrl, branch, result, run = runCommand, warn = message => console.warn(message) }) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-mind-fix-ci-wait-'));
  try {
    const bodyFile = path.join(tempDir, 'comment.md');
    await writeSanitizedPublicationFile(bodyFile, buildCiWaitResultComment({ branch, result }));
    const commented = await run('gh', ['issue', 'comment', issueUrl, '--body-file', bodyFile]);
    if (commented?.code !== 0) {
      warn(`⚠️  Could not comment CI/CD results on ${issueUrl}: ${`${commented?.stderr || ''}${commented?.stdout || ''}`.trim() || `exit code ${commented?.code}`}`);
      return false;
    }
    return true;
  } catch (error) {
    warn(`⚠️  Could not comment CI/CD results on ${issueUrl}: ${error?.message || error}`);
    return false;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
