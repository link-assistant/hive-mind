/**
 * Issue #3356: the example workflow for repositories without a running bot
 * runs the published `close-linked-issues` command on merged pull requests.
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('the close-linked-issues example workflow runs the packaged command on merged pull requests only', () => {
  const workflow = read('examples/workflows/close-linked-issues.yml');
  const { bin } = JSON.parse(read('package.json'));
  assert.equal(bin['close-linked-issues'], './src/close-linked-issues.mjs');
  assert.match(workflow, /types: \[closed\]/);
  assert.match(workflow, /if: github\.event\.pull_request\.merged == true/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /close-linked-issues --pr "\$PR_URL"/);
  const runLines = workflow.split('\n').filter(line => line.trim().startsWith('run:'));
  assert.doesNotMatch(runLines.join('\n'), /\$\{\{/, 'event data reaches the shell only through env');
});
