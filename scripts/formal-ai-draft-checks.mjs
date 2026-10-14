#!/usr/bin/env node
/**
 * Post each check run the draft workflow dispatched as a commit status on the
 * draft's head SHA, and keep it current until every run has finished.
 *
 * Env: GITHUB_REPOSITORY, GH_TOKEN, CHECKS_REF (the head branch),
 * CHECKS_WORKFLOWS (the dispatched workflow files),
 * CHECKS_DEADLINE_MINUTES (how long to wait, default 80).
 *
 * @see scripts/formal-ai-draft-checks.lib.mjs
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { allRunsCompleted, commitStatusForRun, missingRunStatus, selectDispatchedRuns, statusKey } from './formal-ai-draft-checks.lib.mjs';
import { ghApi } from './github-actions.lib.mjs';

const env = process.env;
const repository = env.GITHUB_REPOSITORY;
const ref = (env.CHECKS_REF || '').trim();
if (!ref) throw new Error('formal-ai-draft-checks needs CHECKS_REF, the draft head branch');
const workflows = (env.CHECKS_WORKFLOWS || 'release.yml security.yml links.yml workflows.yml').split(/[\s,]+/).filter(Boolean);
const deadline = Date.now() + Number(env.CHECKS_DEADLINE_MINUTES || 80) * 60_000;
const POLL_MS = 30_000;

const { sha } = await ghApi(`repos/${repository}/commits/${encodeURIComponent(ref)}`);
console.log(`Reporting ${workflows.join(', ')} on ${ref} (${sha})`);

const posted = new Map();
const post = async status => {
  if (posted.get(status.context) === statusKey(status)) return;
  await ghApi(`repos/${repository}/statuses/${sha}`, { method: 'POST', body: status });
  posted.set(status.context, statusKey(status));
  console.log(`${status.context}: ${status.state} (${status.description})`);
};

let selected;
for (;;) {
  const response = await ghApi(`repos/${repository}/actions/runs?head_sha=${sha}&event=workflow_dispatch&per_page=100`);
  selected = selectDispatchedRuns(response?.workflow_runs || [], { sha, workflows });
  for (const entry of selected) if (entry.run) await post(commitStatusForRun(entry));
  if (allRunsCompleted(selected) || Date.now() >= deadline) break;
  await sleep(POLL_MS);
}

for (const { workflow, run } of selected) {
  if (!run) await post(missingRunStatus(workflow, `No dispatched ${workflow} run appeared for this commit`));
  else if (run.status !== 'completed') console.log(`${workflow} is still ${run.status}; its status stays pending until the next report: ${run.html_url}`);
}
