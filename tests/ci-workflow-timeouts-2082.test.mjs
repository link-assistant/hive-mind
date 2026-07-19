/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2082, finding F6.
 *
 * A GitHub Actions job without `timeout-minutes` inherits the default limit of
 * 360 minutes. A job that hangs — waiting on a prompt, a dead network socket, a
 * runaway test — therefore burns six hours of runner time before it is killed,
 * and reports as a generic failure that looks nothing like a hang. 21 of the 25
 * jobs in this repository had no timeout.
 *
 * docs/CI-CD-BEST-PRACTICES.md requires an explicit timeout on every job.
 * Nothing off the shelf enforces this: the zizmor request (zizmorcore/zizmor#1023)
 * and the actionlint request (rhysd/actionlint#49) are both still open. So this
 * test is the enforcement.
 *
 * Note the caveat that makes a naive version of this check wrong: a job that
 * calls a reusable workflow with `uses:` does NOT support `timeout-minutes` —
 * the timeout must be set inside the called workflow. Demanding one there would
 * replace a false negative with a false positive.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2082
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { findJobs, findJobsMissingTimeout } from '../scripts/workflow-lint.lib.mjs';

// --- The scanner ----------------------------------------------------------

{
  const yaml = `name: Example
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - run: echo build
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo test
`;

  const jobs = findJobs(yaml);
  assert.deepEqual(
    jobs.map(job => job.name),
    ['build', 'test'],
    'every job is found'
  );
  assert.equal(jobs[0].timeoutMinutes, 10, 'an explicit timeout is read');
  assert.equal(jobs[1].timeoutMinutes, null, 'a missing timeout is reported as null');
  assert.equal(jobs[1].line, 9, 'the job is reported at its own line so the message is actionable');

  assert.deepEqual(
    findJobsMissingTimeout(yaml).map(job => job.name),
    ['test'],
    'only the job without a timeout is reported'
  );
}

{
  // The false-positive trap: `timeout-minutes` is not valid on a reusable-workflow
  // caller, so requiring it there would be a bug in this check.
  const yaml = `jobs:
  call:
    uses: ./.github/workflows/other.yml
    secrets: inherit
`;
  assert.deepEqual(findJobsMissingTimeout(yaml), [], 'a job that calls a reusable workflow is exempt — timeout-minutes is not supported there');
  assert.equal(findJobs(yaml)[0].reusable, true, 'the caller is identified as reusable');
}

{
  // A `uses:` on a *step* is an action, not a reusable workflow: the job still
  // needs a timeout. Getting this wrong would silently exempt almost everything.
  const yaml = `jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - run: echo hi
`;
  assert.deepEqual(
    findJobsMissingTimeout(yaml).map(job => job.name),
    ['build'],
    'a step-level `uses:` must not exempt the job'
  );
  assert.equal(findJobs(yaml)[0].reusable, false, 'a job whose steps use actions is not a reusable-workflow caller');
}

{
  // `jobs:` keys must not be confused with other top-level mappings.
  const yaml = `on:
  push:
    branches: [main]
env:
  FOO: bar
jobs:
  only:
    runs-on: ubuntu-latest
    timeout-minutes: 5
`;
  assert.deepEqual(
    findJobs(yaml).map(job => job.name),
    ['only'],
    'keys under `on:` and `env:` are not mistaken for jobs'
  );
}

// --- Every job in this repository has a timeout ---------------------------

{
  const workflowDir = path.join(process.cwd(), '.github', 'workflows');
  const files = readdirSync(workflowDir).filter(file => file.endsWith('.yml') || file.endsWith('.yaml'));

  assert.ok(files.length > 0, 'workflow files are found — an empty glob would make this test vacuous');

  const offenders = [];
  let jobCount = 0;
  for (const file of files) {
    const yaml = readFileSync(path.join(workflowDir, file), 'utf8');
    jobCount += findJobs(yaml).length;
    for (const job of findJobsMissingTimeout(yaml)) {
      offenders.push(`${file}:${job.line} job "${job.name}"`);
    }
  }

  assert.ok(jobCount > 1, 'jobs are actually parsed — a parser that finds nothing would pass vacuously');
  assert.deepEqual(offenders, [], `every job must set timeout-minutes (see docs/CI-CD-BEST-PRACTICES.md).\nMissing on:\n  ${offenders.join('\n  ')}`);
}

console.log('ci-workflow-timeouts-2082.test.mjs: all assertions passed');
