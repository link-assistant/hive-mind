/** Execute an e2e-only workflow when GITHUB_TOKEN cannot approve its run. */
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, sep } from 'node:path';
import { githubApi } from './github-api.lib.mjs';

export async function runGeneratedWorkflow({ api = githubApi, repository, pullRequest, files, runs = [], run, log = console.log } = {}) {
  const waiting = runs.filter(item => ['waiting', 'action_required'].includes(item.status) || item.conclusion === 'action_required');
  let approved = 0;
  for (const item of waiting) {
    try {
      await api(`repos/${repository}/actions/runs/${item.id}/approve`, { method: 'POST' });
      approved++;
    } catch (error) {
      log(`Run ${item.id} approval refused: ${error.message}; using act.`);
    }
  }
  if (waiting.length > 0 && approved === waiting.length) return { method: 'approved' };
  const workflow = files.filter(file => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file));
  if (workflow.length !== 1) throw new Error('the generated e2e answer must contain exactly one workflow');
  const work = mkdtempSync(join(tmpdir(), 'hive-e2e-workflow-'));
  try {
    const tree = await api(`repos/${repository}/git/trees/${pullRequest.headRefOid}?recursive=1`);
    if (tree.truncated) throw new Error('generated e2e tree was truncated');
    for (const entry of tree.tree.filter(entry => entry.type === 'blob')) {
      const target = resolve(work, entry.path);
      if (!target.startsWith(`${work}${sep}`) || !['100644', '100755'].includes(entry.mode)) throw new Error(`unsupported e2e fixture path: ${entry.path}`);
      const blob = await api(`repos/${repository}/git/blobs/${entry.sha}`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, Buffer.from(blob.content, 'base64'));
      if (entry.mode === '100755') chmodSync(target, 0o755);
    }
    const event = await api(`repos/${repository}/pulls/${pullRequest.number}`);
    const eventPath = join(work, 'event.json');
    writeFileSync(eventPath, JSON.stringify({ action: 'synchronize', number: pullRequest.number, pull_request: event, repository: event.base?.repo }));
    const result = await run('act', ['pull_request', '-W', join(work, workflow[0]), '--directory', work, '--eventpath', eventPath, '--container-architecture', 'linux/amd64', '--secret', 'GITHUB_TOKEN', '--platform', 'ubuntu-latest=catthehacker/ubuntu:act-latest', '--platform', 'ubuntu-24.04=catthehacker/ubuntu:act-latest', '--platform', 'ubuntu-22.04=catthehacker/ubuntu:act-22.04'], { capture: true, env: { ...process.env, GITHUB_TOKEN: process.env.GH_TOKEN } });
    return { ...result, method: 'act' };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
