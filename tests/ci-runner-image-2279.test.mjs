/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for the runner-image warning found while validating
 * issue #2279. GitHub announced that `ubuntu-latest` will move from Ubuntu
 * 24.04 to 26.04 beginning 2026-10-19. Active workflows must name the intended
 * image explicitly so the CI environment does not change without review.
 *
 * @see https://github.com/actions/runner-images/issues/14748
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const workflowsDirectory = '.github/workflows';
const findings = [];

for (const name of readdirSync(workflowsDirectory)
  .filter(file => /\.ya?ml$/.test(file))
  .sort()) {
  const path = join(workflowsDirectory, name);
  const lines = readFileSync(path, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (line.includes('ubuntu-latest')) findings.push(`${path}:${index + 1}: ${line.trim()}`);
  });
}

assert.deepEqual(findings, [], `active workflows must pin Ubuntu 24.04 instead of the migrating ubuntu-latest alias:\n${findings.join('\n')}`);

console.log('ci-runner-image-2279.test.mjs: all assertions passed');
