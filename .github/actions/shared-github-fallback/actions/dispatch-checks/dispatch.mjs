import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const github = async (endpoint, { method = 'GET', body } = {}) => {
  const response = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}/${endpoint}`, { method, headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error(`Check dispatch API failed: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
};

export async function dispatchChecks({ repository, ref, workflows, api = github, attempts = 30, sleep = delay }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !ref) throw new Error('repository and head ref are required');
  const head = await api(`repos/${repository}/git/ref/heads/${ref}`);
  const urls = [];
  for (const workflow of workflows.split(/[\s,]+/).filter(Boolean)) {
    if (!/^[\w.-]+\.ya?ml$/.test(workflow)) throw new Error('Check workflows must be workflow filenames');
    const root = `repos/${repository}/actions/workflows/${workflow}`;
    const previous = new Set((await api(`${root}/runs?per_page=100`)).workflow_runs.map(run => run.id));
    await api(`${root}/dispatches`, { method: 'POST', body: { ref, inputs: { mode: 'checks' } } });
    let matched;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const runs = (await api(`${root}/runs?per_page=100`)).workflow_runs;
      matched = runs.find(run => !previous.has(run.id) && run.event === 'workflow_dispatch' && run.head_branch === ref && run.head_sha === head.object.sha);
      if (matched) break;
      await sleep(2000);
    }
    if (!matched) throw new Error(`No dispatched run appeared for ${workflow} on ${ref}`);
    urls.push(matched.html_url);
  }
  return urls;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const urls = await dispatchChecks({ repository: process.env.GITHUB_REPOSITORY, ref: process.env.CHECK_REF, workflows: process.env.CHECK_WORKFLOWS });
  const summary = `Dispatched checks on ${process.env.CHECK_REF}:\n${urls.map(url => `- ${url}`).join('\n')}\n`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}
