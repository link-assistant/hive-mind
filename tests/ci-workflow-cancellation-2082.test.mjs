/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2082, findings F13 and F14.
 *
 * F13 — `always()` in a job's `if:`. `always()` is true even when the run has
 * been cancelled, so the job runs on regardless. release.yml documents this at
 * the top of the file ("Docker jobs use !cancelled() instead of always() ...
 * Using always() prevents workflow cancellation entirely", from the #1274 and
 * #1278 case studies) but applied it only to the Docker jobs. Nine other jobs
 * still used `always()`, five of them without a `!cancelled()` alongside it.
 *
 * F14 — the concurrency policy was inverted:
 *
 *     cancel-in-progress: ${{ github.ref == 'refs/heads/main' }}
 *
 * That cancels in-progress runs on main — the one branch that publishes — and
 * queues them everywhere else. A release cancelled between `npm publish` and the
 * `git push` of the version bump leaves the registry ahead of the repository.
 * That is not hypothetical: it is the same split-brain state findings F4 and F5
 * were about, reached by a different route. Superseded PR runs are the ones
 * worth cancelling; nothing is published from them.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2082
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { findJobs, findJobsUsingAlways, inspectConcurrency } from '../scripts/workflow-lint.lib.mjs';

// --- Reading a job's condition -------------------------------------------

{
  // Both spellings of `if:` must be understood, or the check silently passes.
  const yaml = `jobs:
  inline:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    if: always() && github.ref == 'refs/heads/main'
    steps:
      - run: echo hi
  block:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    if: |
      always() &&
      !contains(needs.*.result, 'failure')
    steps:
      - run: echo hi
  clean:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    if: |
      !cancelled() &&
      !contains(needs.*.result, 'failure')
    steps:
      - run: echo hi
`;

  const jobs = findJobs(yaml);
  assert.equal(jobs.length, 3, 'a multi-line `if:` does not swallow the jobs that follow it');
  assert.match(jobs[1].condition, /always\(\) && !contains/, 'a block-scalar condition is flattened into one inspectable string');
  assert.match(jobs[2].condition, /^!cancelled\(\)/, 'a block-scalar condition without always() is read correctly');

  assert.deepEqual(
    findJobsUsingAlways(yaml).map(job => job.name),
    ['inline', 'block'],
    'always() is found in both an inline and a block-scalar condition'
  );
}

// --- The concurrency policy ----------------------------------------------

{
  const inverted = `concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: \${{ github.ref == 'refs/heads/main' }}
`;
  assert.equal(inspectConcurrency(inverted).cancelsReleaseBranch, true, 'cancelling on `== refs/heads/main` is detected — this is the state that shipped');

  const correct = `concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: \${{ github.ref != 'refs/heads/main' }}
`;
  assert.equal(inspectConcurrency(correct).cancelsReleaseBranch, false, 'cancelling everything except main leaves releases alone');

  assert.equal(inspectConcurrency('concurrency:\n  group: x\n  cancel-in-progress: true\n').cancelsReleaseBranch, true, 'an unconditional true cancels main too');
  assert.equal(inspectConcurrency('on: push\n').hasConcurrency, false, 'a workflow with no concurrency block is reported as such');
}

// --- The workflows in this repository ------------------------------------

{
  const workflowDir = path.join(process.cwd(), '.github', 'workflows');
  const files = readdirSync(workflowDir).filter(file => file.endsWith('.yml') || file.endsWith('.yaml'));

  assert.ok(files.length > 0, 'workflow files are found — an empty glob would make this test vacuous');

  const offenders = [];
  let jobCount = 0;
  for (const file of files) {
    const yaml = readFileSync(path.join(workflowDir, file), 'utf8');
    jobCount += findJobs(yaml).length;
    for (const job of findJobsUsingAlways(yaml)) {
      offenders.push(`${file}:${job.line} job "${job.name}"`);
    }

    const concurrency = inspectConcurrency(yaml);
    if (concurrency.hasConcurrency) {
      assert.equal(concurrency.cancelsReleaseBranch, false, `${file}: cancel-in-progress must not cancel runs on main — a release interrupted between \`npm publish\` and the version-bump push leaves npm ahead of the repository (got: ${concurrency.cancelInProgress})`);
    }
  }

  assert.ok(jobCount > 1, 'jobs are actually parsed — a parser that finds nothing would pass vacuously');
  assert.deepEqual(offenders, [], `use !cancelled() instead of always() so the job stops when the run is cancelled.\nOffending jobs:\n  ${offenders.join('\n  ')}`);
}

console.log('ci-workflow-cancellation-2082.test.mjs: all assertions passed');
