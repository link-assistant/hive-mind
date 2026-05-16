#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #1698.
 *
 * New default tests should be added by marking the test file itself instead of
 * editing package.json or release.yml command chains.
 */

import { readFileSync } from 'node:fs';
import { describe, it, assert } from 'test-anywhere';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const releaseWorkflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

function extractWorkflowJob(workflow, jobName) {
  const pattern = new RegExp(`\\n  ${jobName}:\\n[\\s\\S]*?(?=\\n  [A-Za-z0-9_-]+:\\n|\\n$)`);
  const match = workflow.match(pattern);
  return match ? match[0] : '';
}

describe('issue #1698 stable test entrypoints', () => {
  it('keeps package.json test as a stable runner command', () => {
    const testScript = packageJson.scripts?.test ?? '';

    assert.ok(testScript.includes('scripts/run-tests.mjs'), 'npm test should delegate to the shared test runner');
    assert.ok(!/node\s+tests\//.test(testScript), 'npm test should not enumerate individual test files');
    assert.ok(!/&&\s*node\s+/.test(testScript), 'npm test should not be a chained command list');
  });

  it('keeps the CI test-suites job behind npm test', () => {
    const testSuitesJob = extractWorkflowJob(releaseWorkflow, 'test-suites');

    assert.ok(testSuitesJob, 'release.yml should define the test-suites job');
    assert.ok(testSuitesJob.includes('npm test'), 'test-suites should run npm test');
    assert.ok(!/node\s+tests\//.test(testSuitesJob), 'test-suites should not enumerate individual test files');
  });
});
