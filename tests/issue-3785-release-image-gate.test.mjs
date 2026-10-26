/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

const workflow = await fs.readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const conditions = Object.fromEntries(
  ['docker-pr-check', 'release', 'instant-release'].map(name => {
    const block = workflow.split(`\n  ${name}:\n`)[1]?.split(/\n {2}[a-z][a-z-]*:\n/u)[0];
    const condition = block?.match(/^ {4}if: (.+(?:\n {6}.+)*)/mu)?.[1];
    assert.ok(condition, `missing ${name} condition`);
    return [
      name,
      condition
        .replace(/^\|\n/u, '')
        .replace(/^\$\{\{\s*|\s*\}\}$/gu, '')
        .trim(),
    ];
  })
);

function allowed(job, { event = 'push', ref = 'refs/heads/main', imageChanges = 'false', codeChanges = 'true', mode = 'checks', gate = 'success' } = {}) {
  const needs = Object.fromEntries(['changeset-check', 'test-compilation', 'lint', 'check-file-line-limits', 'test-suites', 'test-execution', 'memory-check-linux', 'validate-docs', 'version-check', 'helm-pr-check', 'release-preflight', 'docker-pr-check'].map(name => [name, { result: name === 'docker-pr-check' ? gate : 'success' }]));
  needs['detect-changes'] = { result: 'success', outputs: { 'docker-changed': imageChanges, 'workflow-changed': 'false', 'any-code-changed': codeChanges } };
  const inputs = { mode, release_mode: 'instant' };
  const expression = conditions[job]
    .replaceAll('needs.*.result', 'results')
    .replace(/needs\.([a-z][a-z-]*)/gu, 'needs["$1"]')
    .replace(/\.outputs\.([a-z][a-z-]*)/gu, '.outputs["$1"]');
  return vm.runInNewContext(expression, { needs, inputs, results: Object.values(needs).map(item => item.result), github: { ref, event_name: event, event: { inputs } }, contains: (list, item) => list.includes(item), cancelled: () => false }, { timeout: 100 });
}

test('packaged image checks run on main before source and test-only releases', () => {
  assert.equal(allowed('docker-pr-check', { imageChanges: 'true' }), true);
  assert.equal(allowed('docker-pr-check'), true, 'test-only releases still require packaged checks');
});

test('manual main release cannot skip image checks when change detection is empty', () => {
  assert.equal(allowed('docker-pr-check', { event: 'workflow_dispatch', mode: 'release', codeChanges: 'false' }), true);
});

test('PR image selection and docs-only main pushes retain their existing behavior', () => {
  assert.equal(allowed('docker-pr-check', { event: 'pull_request', ref: 'refs/pull/1/merge', imageChanges: 'true' }), true);
  assert.equal(allowed('docker-pr-check', { event: 'pull_request', ref: 'refs/pull/1/merge' }), false);
  assert.equal(allowed('docker-pr-check', { codeChanges: 'false' }), false);
});

for (const job of ['release', 'instant-release']) {
  test(`${job} refuses skipped, cancelled and failed packaged checks`, () => {
    const event = job === 'release' ? 'push' : 'workflow_dispatch';
    assert.equal(allowed(job, { event, mode: 'release' }), true);
    for (const gate of ['skipped', 'cancelled', 'failure']) assert.equal(allowed(job, { event, mode: 'release', gate }), false, gate);
  });
}
