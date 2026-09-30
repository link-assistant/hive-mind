#!/usr/bin/env node
/**
 * Real GitHub feedback detection, with repository or orphan-branch isolation.
 * @hive-mind-test-suite github-integration
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { githubApi } from '../scripts/github-api.lib.mjs';
import { createGithubTestFixture, cleanupGithubTestFixture } from '../scripts/github-test-resources.lib.mjs';
import { buildGitIdentityEnv } from '../scripts/formal-ai-draft.lib.mjs';

let fixture;
try {
  fixture = await createGithubTestFixture({ canCreateRepositories: process.env.AUTOMATION_CAN_CREATE_REPOSITORIES === 'true' });
  console.log(`GitHub integration fixture: ${fixture.prUrl} (layer ${process.env.AUTOMATION_LAYER || 'default'})`);
  const root = `repos/${fixture.repository}`;
  for (const body of ['First test comment for feedback lines testing', 'Second test comment to verify comment counting']) {
    await githubApi(`${root}/issues/${fixture.prNumber}/comments`, { method: 'POST', body: { body } });
  }
  // A new commit establishes the baseline between the first and new comments.
  const head = await githubApi(`${root}/git/ref/heads/${fixture.headBranch}`);
  const commit = await githubApi(`${root}/git/commits/${head.object.sha}`);
  const baseline = await githubApi(`${root}/git/commits`, { method: 'POST', body: { message: 'Feedback baseline', tree: commit.tree.sha, parents: [head.object.sha] } });
  await githubApi(`${root}/git/refs/heads/${fixture.headBranch}`, { method: 'PATCH', body: { sha: baseline.sha } });
  // GitHub timestamps are second-resolution; new feedback must be strictly
  // newer than the baseline even on a fast runner.
  await new Promise(resolve => setTimeout(resolve, 1100));
  for (const body of ['Third comment - this should be detected as NEW', 'Fourth comment - this should also be detected as NEW']) {
    await githubApi(`${root}/issues/${fixture.prNumber}/comments`, { method: 'POST', body: { body } });
  }

  const solve = fileURLToPath(new URL('../src/solve.mjs', import.meta.url));
  let output;
  try {
    output = execFileSync(process.execPath, [solve, fixture.prUrl, '--dry-run', '--verbose', '--skip-tool-connection-check'], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, ...buildGitIdentityEnv() },
    });
  } catch (error) {
    throw new Error(`solve dry run failed (${error.status}): ${error.stdout || error.stderr}`, { cause: error });
  }
  mkdirSync('experiments/issue-2323', { recursive: true });
  writeFileSync('experiments/issue-2323/feedback-integration.log', output);
  assert.match(output, /New comments on the pull request: 2\b/);
  const promptStart = output.indexOf('Issue to solve:');
  assert.ok(promptStart >= 0, 'solve prints its user prompt');
  assert.match(output.slice(promptStart), /New comments on the pull request: 2\b/, 'exactly the new feedback reaches the user prompt');
  console.log('Feedback integration assertions passed.');
} finally {
  if (fixture) await cleanupGithubTestFixture(fixture);
}
