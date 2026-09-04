#!/usr/bin/env node
/**
 * CI integrity contracts for issue #2150.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/release.yml', 'utf8').replaceAll('\r\n', '\n');
const cleanupWorkflow = readFileSync('.github/workflows/cleanup-test-repos.yml', 'utf8').replaceAll('\r\n', '\n');
const securityWorkflow = readFileSync('.github/workflows/security.yml', 'utf8').replaceAll('\r\n', '\n');
const verifyLogScript = readFileSync('scripts/verify-log-file-contents.sh', 'utf8').replaceAll('\r\n', '\n');

const listWorkflowJobs = source => {
  const jobsBody = source.slice(source.indexOf('\njobs:\n'));
  return Array.from(jobsBody.matchAll(/^ {2}([a-zA-Z0-9_-]+):\s*$/gm), match => match[1]);
};

const getJobBlock = (source, jobName) => {
  const lines = source.split('\n');
  const start = lines.findIndex(line => line === `  ${jobName}:`);
  const end = lines.findIndex((line, index) => index > start && /^ {2}[a-zA-Z0-9_-]+:\s*$/.test(line));
  return start < 0 ? '' : lines.slice(start, end < 0 ? lines.length : end).join('\n');
};

const listNeededJobs = jobBlock => {
  const lines = jobBlock.split('\n');
  const start = lines.findIndex(line => line === '    needs:');
  const needed = [];
  for (const line of lines.slice(start + 1)) {
    const match = line.match(/^ {6}- ([a-zA-Z0-9_-]+)$/);
    if (!match) break;
    needed.push(match[1]);
  }
  return needed;
};

const jobs = listWorkflowJobs(workflow);
const gate = getJobBlock(workflow, 'pipeline-status');

assert.ok(jobs.length > 10, 'release workflow jobs were parsed');
assert.match(gate, / {4}if: always\(\)/, 'terminal status gate must run after failures and cancellations');
assert.match(gate, /NEEDS_JSON: \$\{\{ toJSON\(needs\) \}\}/, 'terminal gate receives every dependency result');
assert.deepEqual(listNeededJobs(gate).sort(), jobs.filter(job => job !== 'pipeline-status').sort(), 'terminal gate observes every other release job');

// Issue #2198: the top-level default used to be `read-all`, which zizmor
// flags as excessive-permissions -- it also grants read access to actions,
// packages and security events. Every workflow now declares the narrowest
// default that still allows checkout, and any job needing more writes its
// own `permissions:` block.
for (const [name, source] of [
  ['release', workflow],
  ['cleanup', cleanupWorkflow],
  ['security', securityWorkflow],
]) {
  assert.doesNotMatch(source, /uses: actions\/(?:checkout|setup-node)@v5/, `${name} workflow uses Node 24-native action releases`);
  assert.match(source, /GIT_CONFIG_KEY_0:\s*init\.defaultBranch/, `${name} workflow suppresses Git's obsolete default-branch warning`);
  assert.doesNotMatch(source, /^permissions: read-all$/m, `${name} workflow does not default to blanket read-all permissions`);
  assert.match(source, /^permissions:\n {2}contents: read$/m, `${name} workflow defaults to least-privilege read permissions`);
}

assert.match(securityWorkflow, /uses: github\/codeql-action\/analyze@v4/, 'CodeQL analyzes source and workflow code');
assert.match(securityWorkflow, /uses: actions\/dependency-review-action@v5/, 'dependency changes receive a high-severity gate');
assert.match(securityWorkflow, /fail-on-severity: high/, 'high-severity dependency findings fail review');
assert.match(securityWorkflow, /schedule:\n\s+- cron:/, 'security scanning also runs on a schedule');

assert.doesNotMatch(workflow, /timeout [^\n]+\|\| (?:true|echo)/, 'CLI smoke-test failures are never swallowed');
assert.match(verifyLogScript, /https:\/\/example\.com\/not-a-github-repository/, 'log smoke test uses a deterministic non-GitHub fixture');
assert.match(verifyLogScript, /SOLVE_STATUS" -ne 1/, "log smoke test requires the fixture's exact failure status");
assert.match(verifyLogScript, /Not a GitHub URL/, 'log smoke test requires the expected terminal validation reason');
assert.doesNotMatch(verifyLogScript, /SOLVE_STATUS" -ne 124/, 'log smoke test cannot accept a timeout as success');

const runGate = (needs, isMain = false) =>
  spawnSync('bash', ['scripts/check-pipeline-status.sh'], {
    encoding: 'utf8',
    env: { ...process.env, NEEDS_JSON: JSON.stringify(needs), IS_MAIN: String(isMain) },
  });

let result = runGate({ lint: { result: 'success' }, release: { result: 'skipped' } });
assert.equal(result.status, 0, result.stderr);

result = runGate({ lint: { result: 'failure' } });
assert.equal(result.status, 1, 'failed jobs fail the terminal gate on every ref');
assert.match(result.stdout, /Failing jobs: lint/);

result = runGate({ release: { result: 'cancelled' } }, true);
assert.equal(result.status, 1, 'timeout cancellation fails the terminal gate on main');
assert.match(result.stdout, /cancelled jobs on main: release/i);

result = runGate({ test: { result: 'cancelled' } });
assert.equal(result.status, 0, 'superseded PR cancellations remain non-fatal');
assert.match(result.stdout, /::warning::Cancelled jobs: test/);

console.log('ci-integrity-2150.test.mjs: all assertions passed');
