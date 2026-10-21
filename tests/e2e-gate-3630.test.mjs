/**
 * Issue #3630: real GitHub E2E runs only after every other check of the pull
 * request passed, is part of the pipeline status, never runs for a fork, and
 * after a merge runs once for the merged source from the completed checks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const matrix = readFileSync(new URL('../.github/workflows/e2e-hello-world-matrix.yml', import.meta.url), 'utf8');

/** Top-level job blocks of a workflow, by id. */
function jobs(workflow) {
  const body = workflow.slice(workflow.indexOf('\njobs:\n') + 7);
  const blocks = {};
  let current = null;
  for (const line of body.split('\n')) {
    const match = line.match(/^ {2}([a-z0-9-]+):\s*$/);
    if (match) blocks[(current = match[1])] = '';
    else if (current) blocks[current] += `${line}\n`;
  }
  return blocks;
}

const needsOf = block => {
  const inline = block.match(/^ {4}needs: \[([^\]]*)\]/m);
  if (inline) return inline[1].split(',').map(name => name.trim());
  const single = block.match(/^ {4}needs: ([a-z0-9-]+)\s*$/m);
  if (single) return [single[1]];
  const list = block.match(/^ {4}needs:\n((?: {6}- [a-z0-9-]+\n)+)/m);
  return list ? list[1].match(/(?<=- )[a-z0-9-]+/g) : [];
};

// Jobs that publish after a merge or a dispatch; they never run on a pull request.
const DELIVERY_JOB = /^(release|instant-release|changeset-pr|docker-publish.*|helm-release.*)$/;

test('the real E2E gate needs every other pull request check', () => {
  const all = jobs(release);
  assert.ok(all['real-e2e'], 'release.yml has a real-e2e job');
  const checks = Object.keys(all).filter(name => !DELIVERY_JOB.test(name) && !['real-e2e', 'pipeline-status'].includes(name));
  assert.deepEqual(needsOf(all['real-e2e']).sort(), checks.sort());
  const condition = all['real-e2e'].match(/^ {4}if: \|\n((?: {6}.*\n)+)/m)[1];
  for (const clause of ["!contains(needs.*.result, 'failure')", "!contains(needs.*.result, 'cancelled')", '!cancelled()', "github.event_name == 'pull_request'", 'github.event.pull_request.head.repo.full_name == github.repository']) assert.ok(condition.includes(clause), `real-e2e runs only when ${clause}`);
  assert.match(all['real-e2e'], /uses: \.\/\.github\/workflows\/e2e-hello-world-matrix\.yml/);
  assert.match(all['real-e2e'], /scope: pull-request\n\s+pull_request: \$\{\{ github\.event\.pull_request\.number \}\}\n\s+source_sha: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
});

test('the pipeline status includes the real E2E gate', () => {
  assert.ok(needsOf(jobs(release)['pipeline-status']).includes('real-e2e'));
});

test('the matrix is callable with an explicit scope and runs once per merged source', () => {
  for (const input of ['scope', 'pull_request', 'source_sha']) assert.match(matrix, new RegExp(`workflow_call:[\\s\\S]*?\\n {6}${input}:\\n {8}type: `));
  assert.match(matrix, /workflow_run:[^\n]*\n\s+workflows: \['Checks and release'\]\n\s+types: \[completed\]\n\s+branches: \[main\]/);
  assert.doesNotMatch(matrix, /^ {2}(push|pull_request):/m, 'the matrix is never triggered by a push or pull request directly');
  // The finalize step runs on success, failure and cancellation, after the evidence upload.
  const upload = matrix.indexOf('- name: Upload links, approval evidence, assertions and logs');
  const finalize = matrix.indexOf('- name: Finalize the task with its outcome');
  assert.ok(upload > 0 && finalize > upload);
  assert.match(matrix.slice(finalize, finalize + 200), /if: always\(\) && steps\.plan\.outputs\.action == 'run'/);
  assert.match(matrix, /E2E_JOB_STATUS: \$\{\{ job\.status \}\}/);
  assert.match(matrix, /E2E_DEFER_FINALIZE: 'true'/);
});
