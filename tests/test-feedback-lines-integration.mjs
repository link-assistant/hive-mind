#!/usr/bin/env node
/**
 * @hive-mind-test-suite github-integration
 * Exercise solve's prompt against real comments without repository-creation permissions.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { gh, ghApi } from '../scripts/github-actions.lib.mjs';
import { createBranchFixture, cleanupBranchFixture, fixtureBranch } from '../scripts/task-fixture.lib.mjs';

const execute = promisify(execFile);
let repository = process.env.GITHUB_REPOSITORY || 'link-assistant/hive-mind';
let disposableRepository = false;
const baseBranch = fixtureBranch({ kind: 'integration', runId: randomUUID(), tool: 'feedback', model: 'lines' });
let fixture;
let directory;
let testError;
let errors = [];
try {
  if (process.env.AUTOMATION_CAN_CREATE_REPOSITORIES === 'true') {
    repository = `${repository.split('/')[0]}/test-feedback-lines-${randomUUID()}`;
    await gh(['repo', 'create', repository, '--public', '--add-readme']);
    disposableRepository = true;
  }
  fixture = await createBranchFixture({
    repository,
    baseBranch,
    readme: '# Feedback test\n',
    title: 'Test feedback lines',
    body: 'Integration fixture for issue #168.',
    onResource: partial => {
      fixture = partial;
    },
  });
  const commit = async (parent, text) => {
    const blob = await ghApi(`repos/${repository}/git/blobs`, { method: 'POST', body: { content: text, encoding: 'utf-8' } });
    const tree = await ghApi(`repos/${repository}/git/trees`, { method: 'POST', body: { tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: blob.sha }] } });
    return ghApi(`repos/${repository}/git/commits`, { method: 'POST', body: { message: 'Feedback fixture update', tree: tree.sha, parents: [parent] } });
  };
  const initial = await ghApi(`repos/${repository}/git/ref/heads/${baseBranch}`);
  const head = `${baseBranch}-head`;
  const first = await commit(initial.object.sha, '# Feedback test\nFirst update\n');
  await ghApi(`repos/${repository}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${head}`, sha: first.sha } });
  fixture.branches.push(head);
  const pr = await ghApi(`repos/${repository}/pulls`, { method: 'POST', body: { title: `issue-${fixture.issueNumber}: feedback test`, body: `Fixes #${fixture.issueNumber}`, base: baseBranch, head } });
  fixture.pullRequestNumber = pr.number;
  const comment = body => ghApi(`repos/${repository}/issues/${pr.number}/comments`, { method: 'POST', body: { body } });
  await comment('First old comment');
  await comment('Second old comment');
  // GitHub timestamps have one-second precision; separate both sides of the baseline.
  await sleep(2000);
  const baseline = await commit(first.sha, '# Feedback test\nBaseline update\n');
  await ghApi(`repos/${repository}/git/refs/heads/${head}`, { method: 'PATCH', body: { sha: baseline.sha } });
  await sleep(2000);
  await comment('Third comment, new after baseline');
  await comment('Fourth comment, new after baseline');
  directory = await mkdtemp(join(tmpdir(), 'hive-feedback-'));
  await gh(['repo', 'clone', repository, directory, '--', '--branch', head, '--single-branch', '--depth', '2']);
  await execute('git', ['-C', directory, 'config', 'user.name', 'Hive Mind integration']);
  await execute('git', ['-C', directory, 'config', 'user.email', 'hive-mind-integration@users.noreply.github.com']);
  const solve = new URL('../src/solve.mjs', import.meta.url).pathname;
  let output;
  try {
    const result = await execute(process.execPath, [solve, pr.html_url, '--base-branch', baseBranch, '--dry-run', '--verbose', '--skip-tool-connection-check'], { cwd: directory, env: process.env, maxBuffer: 64 * 1024 * 1024 });
    output = result.stdout + result.stderr;
  } catch (error) {
    output = (error.stdout || '') + (error.stderr || '');
    if (!output.includes('Issue to solve:')) throw error;
  }
  const report = join(process.env.RUNNER_TEMP || tmpdir(), 'feedback-lines-integration.log');
  await writeFile(report, output);
  const prompt = output.slice(output.indexOf('Issue to solve:'));
  assert.match(prompt, /New comments on the pull request: 2\b/);
  console.log(`Feedback integration passed: ${pr.html_url}; log: ${report}`);
} catch (error) {
  testError = error;
  console.error('Feedback integration failure before cleanup:', error);
} finally {
  if (fixture && process.env.E2E_KEEP !== 'true') {
    errors = await cleanupBranchFixture(fixture);
  }
  if (disposableRepository && process.env.AUTOMATION_CAN_DELETE_REPOSITORIES === 'true' && process.env.E2E_KEEP !== 'true') {
    try {
      await gh(['repo', 'delete', repository, '--yes']);
      errors = []; // Deleting the repository also removes its fixture resources.
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (directory) await rm(directory, { recursive: true, force: true });
}
if (testError) throw new AggregateError([testError, ...errors.map(message => new Error(message))], 'Feedback integration failed; cleanup errors are included', { cause: testError });
assert.deepEqual(errors, [], 'All owned integration resources must be cleaned');
