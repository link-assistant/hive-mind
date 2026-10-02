import { setTimeout as sleep } from 'node:timers/promises';
import { ghApi, gh } from './github-actions.lib.mjs';

export function matchingWorkflowRuns(pages, { sha, workflows }) {
  return pages.flatMap(page => page.workflow_runs || []).filter(run => run.head_sha === sha && run.event === 'pull_request' && workflows.includes((run.path || '').split('@')[0]));
}

/** A missing run is evidence, never a successful check. Default-token tasks can use act. */
export async function verifyGeneratedWorkflow({ repository, pullRequest, workflows, layer = 'default', timeoutMs = 30 * 60_000, discoveryMs = 60_000, api = ghApi, runGh = gh, runAct, sleepImpl = sleep, now = Date.now }) {
  const deadline = now() + timeoutMs;
  const discoveryDeadline = now() + discoveryMs;
  const approval = [];
  const attempted = new Set();
  let runs;
  let fallbackReason = '';
  for (;;) {
    const pages = await api(`repos/${repository}/actions/runs?head_sha=${pullRequest.headRefOid}&event=pull_request&per_page=100`, { paginate: true });
    // Ignore a superseded rerun of the same generated workflow.
    const matching = matchingWorkflowRuns(pages, { sha: pullRequest.headRefOid, workflows });
    runs = workflows.map(workflow => matching.filter(run => run.path.split('@')[0] === workflow).sort((a, b) => b.id - a.id)[0]).filter(Boolean);
    if (runs.length === workflows.length && runs.every(run => run.status === 'completed' && run.conclusion !== 'action_required')) break;
    if (layer === 'default') {
      for (const run of runs.filter(run => ['waiting', 'action_required'].includes(run.status) || run.conclusion === 'action_required')) {
        if (attempted.has(run.id)) continue;
        attempted.add(run.id);
        try {
          await api(`repos/${repository}/actions/runs/${run.id}/approve`, { method: 'POST' });
          approval.push({ runId: run.id, outcome: 'approved' });
        } catch (error) {
          approval.push({ runId: run.id, outcome: 'refused', error: error.message });
          fallbackReason = `Approval refused for run ${run.id}`;
        }
      }
      if (fallbackReason) break;
      if (runs.length === 0 && now() >= discoveryDeadline) {
        fallbackReason = 'No generated pull_request run was created; approval endpoint cannot be tested without a run ID';
        break;
      }
    }
    if (now() >= deadline) {
      fallbackReason = 'Generated workflow did not complete before the verification deadline';
      break;
    }
    await sleepImpl(10_000);
  }
  if (fallbackReason && layer === 'default') {
    const local = await runAct();
    return { mode: 'act', approval, fallbackReason, runs: runs.map(run => ({ id: run.id, url: run.html_url, conclusion: run.conclusion })), workflowLog: local.stdout, checks: [{ name: 'Generated workflow (act)', status: 'COMPLETED', conclusion: local.code === 0 ? 'SUCCESS' : 'FAILURE' }] };
  }
  let workflowLog = '';
  for (const run of runs.filter(run => run.status === 'completed')) workflowLog += await runGh(['run', 'view', String(run.id), '--repo', repository, '--log']);
  const checks = runs.map(run => ({ name: run.name, status: run.status === 'completed' ? 'COMPLETED' : 'IN_PROGRESS', conclusion: (run.conclusion || '').toUpperCase() }));
  if (fallbackReason || runs.length !== workflows.length) checks.push({ name: 'Generated workflow missing or timed out', status: 'COMPLETED', conclusion: 'FAILURE' });
  return { mode: approval.some(item => item.outcome === 'approved') ? 'approved-actions' : 'actions', approval, fallbackReason, runs: runs.map(run => ({ id: run.id, url: run.html_url, conclusion: run.conclusion })), workflowLog, checks };
}
