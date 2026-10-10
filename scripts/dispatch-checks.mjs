#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { gh, ghJson } from './github-actions.lib.mjs';

if (process.env.TRIGGERS_WORKFLOWS === 'true') process.exit(0);
const ref = process.env.CHECKS_REF;
const repository = process.env.GITHUB_REPOSITORY;
if (!ref) throw new Error('dispatch-checks needs the pull request head branch');
const sha = (await ghJson(['api', `repos/${repository}/commits/${encodeURIComponent(ref)}`])).sha;
const workflows = (process.env.CHECKS_WORKFLOWS || '').split(/[\s,]+/).filter(Boolean);
const allowed = new Set(['release.yml', 'security.yml', 'links.yml', 'workflows.yml']);
for (const workflow of workflows) {
  if (!allowed.has(workflow)) throw new Error(`Unknown checks workflow: ${workflow}`);
  const started = Date.now() - 1000;
  await gh(['workflow', 'run', workflow, '--repo', repository, '--ref', ref, '-f', 'mode=checks']);
  let run;
  for (let attempt = 0; attempt < 24; attempt++) {
    const runs = await ghJson(['run', 'list', '--repo', repository, '--workflow', workflow, '--branch', ref, '--event', 'workflow_dispatch', '--limit', '20', '--json', 'url,headSha,createdAt']);
    run = runs.find(candidate => candidate.headSha === sha && Date.parse(candidate.createdAt) >= started);
    if (run) break;
    await sleep(5000);
  }
  if (!run) throw new Error(`Dispatched ${workflow}, but no run appeared for ${sha}`);
  console.log(`${workflow}: ${run.url}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- Dispatched checks [${workflow}](${run.url}) on \`${ref}\`.\n`);
}
